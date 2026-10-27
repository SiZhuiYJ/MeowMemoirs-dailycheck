/**
 * HEIC/HEIF 浏览器端解码支持。
 *
 * 背景：iPhone 相册默认输出 `.heic`（HEVC 编码的 HEIF 容器）。
 * Chrome / Firefox / 大部分 Android WebView 的 <img>、canvas、createImageBitmap
 * 都无法直接解码 HEIC，所以这些图片一旦进入 `convertToWebP` 就会在
 * 「测量尺寸 / 建 ImageBitmap」阶段失败，表现为选完图没反应或上传失败。
 *
 * 这里用 heic2any（libheif 的 WASM 版本）先把 HEIC 解成 JPEG，再交给原有的
 * canvas → WebP 流程。依赖是动态 import 的：只有真正选到 HEIC 时才下载，
 * 不影响普通 JPG/PNG 用户的首屏体积。
 *
 * 服务端也支持 HEIC（见 api/Infrastructure/HeicImageLoader.cs）。客户端转换
 * 只是为了预览和减轻上传体积；即使浏览器端解码失败，原文件仍可交给服务端兜底。
 */

const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const HEIC_EXTENSIONS = new Set(["heic", "heif", "hif"]);

/**
 * HEIF 的 major/compatible brand 白名单。
 *
 * 不包含 `mif1` / `msf1`：它们同样可能出现在 AVIF 里，而 AVIF 现代浏览器
 * 本来就能解码，误判成 HEIC 反而会走错解码器。iPhone 的 HEIC 通常带
 * `heic`（或 `heix`）brand，足以识别。
 */
const HEIC_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx",
  "heim", "heis", "hevm", "hevs",
]);

/** 同一个 File 可能被预览、缩略图、上传等流程多次使用，解码结果缓存起来。 */
const decodedCache = new WeakMap<Blob, Promise<Blob>>();

function getExtension(name?: string | null): string {
  if (!name) return "";
  const base = name.split(/[?#]/)[0] ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function isHeicFileName(name?: string | null): boolean {
  return HEIC_EXTENSIONS.has(getExtension(name));
}

/** 同步判断：MIME 或扩展名命中。用于选择文件后的快速分支。 */
export function isHeicFile(file: File): boolean {
  if (!file) return false;
  if (HEIC_MIME_TYPES.has((file.type || "").toLowerCase())) return true;
  return isHeicFileName(file.name);
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += String.fromCharCode(bytes[offset + i] ?? 0);
  }
  return result;
}

/** 通过文件头识别 HEIC（部分浏览器/系统给不出 MIME，甚至文件名也不带后缀）。 */
export async function isHeicBlob(blob: Blob): Promise<boolean> {
  if (!blob || blob.size < 12) return false;
  if (HEIC_MIME_TYPES.has((blob.type || "").toLowerCase())) return true;

  try {
    const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    if (head.length < 12) return false;
    // ISO BMFF: [size(4)][ftyp(4)][major brand(4)][minor version(4)][compatible brands...]
    if (readAscii(head, 4, 4) !== "ftyp") return false;
    if (HEIC_BRANDS.has(readAscii(head, 8, 4))) return true;

    for (let offset = 16; offset + 4 <= head.length; offset += 4) {
      if (HEIC_BRANDS.has(readAscii(head, offset, 4))) return true;
    }
  } catch {
    // Blob 读取失败按「不是 HEIC」处理，交给原来的解码路径报错
  }

  return false;
}

/**
 * 把 HEIC 解成 JPEG Blob。失败时清掉缓存，避免同一次选择里反复重试卡住。
 * 返回的 Blob 只用于本地预览/画布绘制，不会原样上传。
 */
export function decodeHeicToJpeg(blob: Blob): Promise<Blob> {
  const cached = decodedCache.get(blob);
  if (cached) return cached;

  const task = (async () => {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({
      blob,
      toType: "image/jpeg",
      quality: 0.92,
    });
    const output = Array.isArray(converted) ? converted[0] : converted;
    if (!output) throw new Error("HEIC 图片解码失败");
    return output;
  })().catch((error) => {
    decodedCache.delete(blob);
    console.warn("[image] HEIC 解码失败，交由服务端兜底", error);
    throw new Error("HEIC 图片解码失败，请改用 JPG/PNG 格式");
  });

  decodedCache.set(blob, task);
  return task;
}

/** 如果入参是 HEIC 就换成浏览器可解码的 JPEG，否则原样返回。 */
export async function toBrowserDecodableBlob(blob: Blob): Promise<Blob> {
  return (await isHeicBlob(blob)) ? decodeHeicToJpeg(blob) : blob;
}

/** 生成可直接给 <img>/<el-image> 使用的 HEIC 预览地址（调用方负责 revoke）。 */
export async function createHeicPreviewUrl(file: File): Promise<string> {
  return URL.createObjectURL(await decodeHeicToJpeg(file));
}
