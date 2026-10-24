#!/usr/bin/env node
/**
 * 把 `src/assets/Miku/*.ani` 拆成「逐帧 PNG + 动画信息」。
 *
 * 为什么要拆：
 *   运行时的 ani-cursor.js 要先把整个 .ani 拉下来、在浏览器里解析 RIFF、把每帧
 *   转成 ico blob、用 canvas 缩放到 32×32、再拼出 @keyframes —— 光标要等这一整套
 *   做完才可用，而且每个 .ani 有 1~2.5 MB。
 *
 * 现在改成构建期一次算完，产物直接提交到仓库：
 *   - `public/miku-cursors/<cursor>/<frame>.png`：32×32 的帧图（首帧就是 0.png）
 *   - `src/libs/mikuCursor/cursors.generated.ts`：每帧时长、总时长、准星（hotspot）
 *
 * 帧图放在 public/ 而不是 src/assets/ 是刻意的：src 下的资源会被 Vite 打进模块图，
 * 146 张帧图会让 dev 启动时多出 146 个模块请求、build 时多出 146 个 chunk；
 * 而光标帧只需要「用到哪张取哪张」，放进 public 用带版本号的静态 URL 最合适。
 *
 * 前端只在启动时加载每只光标的**首帧**，空闲时再加载剩余帧并开始播放
 * （见 `src/libs/mikuCursor/index.ts`）。
 *
 * 用法：
 *   npm run cursors
 *
 * 说明：
 *   - 源 ANI 里每帧是 160×160 的 32bpp CUR（位图），且是 32×32 像素画按 5×5
 *     最近邻放大的，所以 5×5 盒式缩放能无损还原原始像素；
 *   - 这里全程只用 Node 内置模块（zlib）手写 PNG 编码，不引入图像库依赖。
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_DIR = path.join(ROOT, "src/assets/Miku");
const FRAMES_DIR = path.join(ROOT, "public/miku-cursors");
const META_FILE = path.join(ROOT, "src/libs/mikuCursor/cursors.generated.ts");

/** 输出帧的边长（与运行时 cursor 尺寸一致）。 */
const OUTPUT_SIZE = 32;

// ==============================================
// ANI / CUR 解析
// ==============================================

function fail(message) {
  throw new Error(message);
}

/**
 * 读取 RIFF/ACON 里的块。
 * 返回 `{ anih, seq, rate, frames }`，其中 frames 是 `icon` 子块（.cur 文件字节）。
 */
function readAni(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "ACON") {
    fail("不是 ANI（RIFF/ACON）文件");
  }

  const chunks = {};
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;

    if (id === "LIST" && buf.toString("ascii", dataStart, dataStart + 4) === "fram") {
      const frames = [];
      const listEnd = dataStart + size;
      let cursor = dataStart + 4;
      while (cursor + 8 <= listEnd) {
        const subId = buf.toString("ascii", cursor, cursor + 4);
        const subSize = buf.readUInt32LE(cursor + 4);
        if (subId === "icon") {
          frames.push(buf.subarray(cursor + 8, cursor + 8 + subSize));
        }
        cursor += 8 + subSize + (subSize & 1);
      }
      chunks.frames = frames;
    } else if (!chunks[id]) {
      chunks[id] = buf.subarray(dataStart, dataStart + size);
    }

    offset += 8 + size + (size & 1);
  }

  if (!chunks.anih) fail("缺少 anih 块");
  if (!chunks.frames?.length) fail("缺少 LIST/fram 帧数据");
  return chunks;
}

function readU32List(chunk) {
  const list = [];
  for (let offset = 0; offset + 4 <= chunk.length; offset += 4) {
    list.push(chunk.readUInt32LE(offset));
  }
  return list;
}

/**
 * 把 ANI 解析成播放序列。
 *
 * 与 ani-cursor.js 的算法保持一致（同一份素材必须得到同样的节奏）：
 *   - 有 `seq ` 时按 seq 给出的帧号播放，否则按 0..nFrames-1 顺序播放；
 *   - 每步时长 = `rate` 里的 jiffy 数（1/60 秒），没有 `rate` 时用 anih 的默认值；
 *   - 没有 `seq ` 时，步数取 anih.nFrames。
 */
function readSteps(chunks) {
  const anih = chunks.anih;
  const listedFrames = chunks.frames.length;
  const declaredSteps = anih.readUInt32LE(8);
  const defaultRate = anih.readUInt32LE(28);

  const seq = chunks.seq ? readU32List(chunks.seq) : [];
  const rate = chunks.rate ? readU32List(chunks.rate) : [];
  const stepCount = seq.length || Math.min(declaredSteps || listedFrames, listedFrames);

  const steps = [];
  for (let i = 0; i < stepCount; i += 1) {
    const frame = seq[i] ?? i;
    if (frame >= listedFrames) fail(`seq 引用了不存在的帧 ${frame}（共 ${listedFrames} 帧）`);
    const jiffies = rate[i] ?? defaultRate ?? 6;
    steps.push({ frame, duration: (jiffies * 1000) / 60 });
  }

  if (!steps.length) fail("解析不出任何动画步");
  return steps;
}

/**
 * 把一个 .cur（CUR/ICO 容器）解码成 RGBA 像素（正向行序）。
 *
 * 只支持这些素材实际使用的格式：32bpp 未压缩 DIB。透明通道全为 0 时回退到
 * AND mask（老式图标只画 mask、alpha 全 0 的情况，浏览器也是这么兜底的）。
 */
function decodeCur(cur) {
  const type = cur.readUInt16LE(2);
  if (type !== 2 && type !== 1) fail(`不是 CUR/ICO 容器（type=${type}）`);

  const count = cur.readUInt16LE(4);
  if (!count) fail("CUR 里没有图像");

  let pick = null;
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    const width = cur[entry] || 256;
    const height = cur[entry + 1] || 256;
    const bytes = cur.readUInt32LE(entry + 8);
    const offset = cur.readUInt32LE(entry + 12);
    if (!pick || width * height > pick.width * pick.height) {
      pick = {
        width,
        height,
        bytes,
        offset,
        // CUR 的 hotspot：素材作者定的准星位置（单位是图片像素）
        hotspot: [cur.readUInt16LE(entry + 4), cur.readUInt16LE(entry + 6)],
      };
    }
  }

  const headerSize = cur.readUInt32LE(pick.offset);
  const width = cur.readInt32LE(pick.offset + 4);
  const doubleHeight = cur.readInt32LE(pick.offset + 8);
  const bpp = cur.readUInt16LE(pick.offset + 14);
  const compression = cur.readUInt32LE(pick.offset + 16);
  const height = Math.abs(doubleHeight) / 2;

  if (!width || !height) fail(`帧尺寸无效：${width}×${doubleHeight}`);
  if (bpp !== 32) fail(`暂不支持 ${bpp}bpp 的帧`);
  if (compression !== 0) fail(`暂不支持压缩帧（compression=${compression}）`);

  const pixels = Buffer.alloc(width * height * 4);
  const dataStart = pick.offset + headerSize;
  const maskStart = dataStart + width * height * 4;
  const maskRowBytes = Math.ceil(width / 32) * 4;
  let hasAlpha = false;

  for (let y = 0; y < height; y += 1) {
    const srcRow = dataStart + (height - 1 - y) * width * 4;
    for (let x = 0; x < width; x += 1) {
      const src = srcRow + x * 4;
      const dst = (y * width + x) * 4;
      pixels[dst] = cur[src + 2]; // B -> R
      pixels[dst + 1] = cur[src + 1];
      pixels[dst + 2] = cur[src];
      const alpha = cur[src + 3];
      pixels[dst + 3] = alpha;
      if (alpha !== 0) hasAlpha = true;
    }
  }

  if (!hasAlpha) {
    // alpha 全 0：用 AND mask（1 = 透明）
    for (let y = 0; y < height; y += 1) {
      const maskRow = maskStart + (height - 1 - y) * maskRowBytes;
      for (let x = 0; x < width; x += 1) {
        const bit = (cur[maskRow + (x >> 3)] >> (7 - (x & 7))) & 1;
        pixels[(y * width + x) * 4 + 3] = bit ? 0 : 255;
      }
    }
  }

  return { width, height, pixels, hotspot: pick.hotspot };
}

/**
 * 盒式缩放（按预乘 alpha 平均，避免透明边缘发黑）。
 *
 * 这批素材都是 32×32 按 5×5 放大的，5×5 块内颜色完全一致，所以结果是无损的；
 * 换成非整数倍也能得到干净的边缘。
 */
function downscale({ width, height, pixels }, outWidth, outHeight) {
  const out = Buffer.alloc(outWidth * outHeight * 4);
  const scaleX = width / outWidth;
  const scaleY = height / outHeight;

  for (let y = 0; y < outHeight; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.min(height, Math.ceil((y + 1) * scaleY));
    for (let x = 0; x < outWidth; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.min(width, Math.ceil((x + 1) * scaleX));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const p = (sy * width + sx) * 4;
          const alpha = pixels[p + 3] / 255;
          r += pixels[p] * alpha;
          g += pixels[p + 1] * alpha;
          b += pixels[p + 2] * alpha;
          a += pixels[p + 3];
          n += 1;
        }
      }
      if (!n) continue;
      const dst = (y * outWidth + x) * 4;
      if (a > 0) {
        out[dst] = Math.round((r / a) * 255);
        out[dst + 1] = Math.round((g / a) * 255);
        out[dst + 2] = Math.round((b / a) * 255);
        out[dst + 3] = Math.round(a / n);
      }
    }
  }

  return out;
}

// ==============================================
// 最小 PNG 编码（RGBA / 8bit）
// ==============================================

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ==============================================
// 主流程
// ==============================================

/** 文件名 -> 产物目录名 / 运行时 key：`Normal Select.ani` -> `normal-select`。 */
function toSlug(fileName) {
  return fileName
    .replace(/\.ani$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function main() {
  const files = readdirSync(ASSET_DIR)
    .filter((name) => name.toLowerCase().endsWith(".ani"))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) fail(`${ASSET_DIR} 下没有 .ani 文件`);

  rmSync(FRAMES_DIR, { recursive: true, force: true });
  mkdirSync(FRAMES_DIR, { recursive: true });

  const hash = createHash("sha1");
  const cursors = [];
  let pngCount = 0;
  let byteCount = 0;

  for (const fileName of files) {
    const slug = toSlug(fileName);
    const buf = readFileSync(path.join(ASSET_DIR, fileName));
    const chunks = readAni(buf);
    const steps = readSteps(chunks);

    const dir = path.join(FRAMES_DIR, slug);
    mkdirSync(dir, { recursive: true });

    // 准星：直接用素材每帧 CUR 头里的 hotspot，按「输出尺寸 / 原始尺寸」缩放。
    // 手写热点会和素材对不上（比如 Link 的 hotspot 是 0,0，手写成 8,0 就整体偏右）。
    const firstFrame = decodeCur(chunks.frames[steps[0].frame]);
    const hotspotScale = OUTPUT_SIZE / firstFrame.width;
    const toHotspot = (value) => Math.max(0, Math.min(OUTPUT_SIZE - 1, Math.round(value * hotspotScale)));
    const hotspot = [toHotspot(firstFrame.hotspot[0]), toHotspot(firstFrame.hotspot[1])];

    /** 同一帧可能被 seq 重复引用，只落一份文件。 */
    const frameFiles = new Map();
    for (const step of steps) {
      if (frameFiles.has(step.frame)) continue;
      const frame = decodeCur(chunks.frames[step.frame]);
      if (frame.hotspot[0] !== firstFrame.hotspot[0] || frame.hotspot[1] !== firstFrame.hotspot[1]) {
        console.warn(`  ⚠ ${fileName} 第 ${step.frame} 帧的 hotspot 与首帧不一致，已按首帧处理`);
      }
      const pixels = frame.width === OUTPUT_SIZE && frame.height === OUTPUT_SIZE
        ? frame.pixels
        : downscale(frame, OUTPUT_SIZE, OUTPUT_SIZE);
      const png = encodePng(pixels, OUTPUT_SIZE, OUTPUT_SIZE);
      const relative = `${slug}/${step.frame}.png`;
      writeFileSync(path.join(dir, `${step.frame}.png`), png);
      hash.update(relative);
      hash.update(png);
      frameFiles.set(step.frame, relative);
      pngCount += 1;
      byteCount += png.length;
    }

    const totalDuration = steps.reduce((sum, step) => sum + step.duration, 0);
    cursors.push({
      key: slug,
      source: fileName,
      hotspot,
      steps: steps.map((step) => ({
        file: frameFiles.get(step.frame),
        duration: step.duration,
      })),
      totalDuration,
    });

    console.log(
      `  ${fileName} -> ${slug}/ （${frameFiles.size} 帧，${steps.length} 步，` +
        `${Math.round(totalDuration)}ms）`,
    );
  }

  // 时长只保留 3 位小数；总时长用取整后的步长相加，
  // 保证运行时按 duration/total 算出的百分比与各步严格对应。
  const metaEntries = cursors
    .map((cursor) => {
      const steps = cursor.steps.map((step) => ({
        file: step.file,
        duration: Math.round(step.duration * 1000) / 1000,
      }));
      const totalDuration = Math.round(steps.reduce((sum, step) => sum + step.duration, 0) * 1000) / 1000;
      return { ...cursor, steps, totalDuration };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  // 帧图内容 + 时长一起参与版本号：重新生成后 URL 一定会变，静态缓存自动失效。
  hash.update(JSON.stringify(metaEntries));
  const version = hash.digest("hex").slice(0, 10);

  const body = metaEntries
    .map((cursor) => {
      const steps = cursor.steps
        .map((step) => `      { file: "${step.file}", duration: ${step.duration} },`)
        .join("\n");
      return `  "${cursor.key}": {
    source: ${JSON.stringify(cursor.source)},
    width: ${OUTPUT_SIZE},
    height: ${OUTPUT_SIZE},
    hotspot: [${cursor.hotspot[0]}, ${cursor.hotspot[1]}],
    steps: [
${steps}
    ],
    totalDuration: ${cursor.totalDuration},
  },`;
    })
    .join("\n");

  const meta = `/**
 * ⚠️ 由 \`scripts/build-miku-cursors.mjs\` 生成，请勿手改。
 * 重新生成：\`npm run cursors\`
 *
 * 每只光标的动画信息：帧图（相对 \`public/miku-cursors\`）、每帧停留时长、准星。
 * 帧图尺寸统一为 32×32；\`steps[0]\` 是首帧（启动时只加载它）。
 * 准星来自素材每帧 CUR 头里的 hotspot，按「32 / 原始尺寸」缩放，不要手写。
 *
 * 帧图内容版本号同时用作缓存戳：运行时 URL 形如
 * \`/miku-cursors/link/0.png?v=<MIKU_CURSOR_VERSION>\`。
 */

/** 帧图内容版本（重新生成后变化，用于给静态缓存加戳）。 */
export const MIKU_CURSOR_VERSION = "${version}";

export interface MikuCursorStep {
  /** 帧图路径，相对 \`public/miku-cursors\` */
  file: string;
  /** 该帧停留时长（毫秒） */
  duration: number;
}

export interface MikuCursorAnimation {
  /** 源 \`.ani\` 文件名 */
  source: string;
  width: number;
  height: number;
  /** 准星（热点）：素材 CUR 里的 hotspot，已换算到输出尺寸 */
  hotspot: readonly [number, number];
  steps: readonly MikuCursorStep[];
  /** 一轮动画总时长（毫秒） */
  totalDuration: number;
}

export const MIKU_CURSORS = {
${body}
} satisfies Record<string, MikuCursorAnimation>;

export type MikuCursorKey = keyof typeof MIKU_CURSORS;
`;

  writeFileSync(META_FILE, meta);

  const kb = (byteCount / 1024).toFixed(1);
  console.log(
    `\n已生成 ${pngCount} 张帧图（${kb} KB）-> ${path.relative(ROOT, FRAMES_DIR)}`,
  );
  console.log(`已生成动画信息 -> ${path.relative(ROOT, META_FILE)}`);
  console.log(`共 ${metaEntries.length} 只光标。`);
}

main();
