// coverPalette.ts
// 从封面图里挑一个「好看的主题色」，而不是把整张图的平均色压暗成灰色。
//
// 旧实现的问题：
//   1. 直接对全图求平均 RGB，深色背景 / 黑边 / 灰阶像素会把结果拉成灰色；
//   2. 再把平均值向深蓝混合 60%、向黑色混合 90%，最后几乎只剩近黑色，
//      打开播放器就会看到「先一个颜色、又突然变成灰色」。
//
// 现在的做法：
//   1. 缩到 64×64 采样，跳过透明 / 过暗 / 过亮 / 低饱和（灰阶）像素；
//   2. 按色相分 24 个桶，权重 = 像素数 × 饱和度，挑最有存在感的色相；
//   3. 用该色相生成深、浅两档颜色，并给饱和度设下限，避免灰扑扑；
//   4. 整张图没有可用彩色（灰度图 / 纯透明）时返回 null，交给页面主题色兜底。

export interface CoverPalette {
    primary: string;
    secondary: string;
    text: string;
}

interface HslColor {
    h: number;
    s: number;
    l: number;
}

const SAMPLE_SIZE = 64;
const HUE_BUCKETS = 24;
const MIN_ALPHA = 16;
const MIN_LIGHTNESS = 0.06;
const MAX_LIGHTNESS = 0.94;
/** 饱和度低于该值视为灰阶像素，不参与主色统计 */
const MIN_CHROMA_SATURATION = 0.12;
/** 生成主题色时的饱和度下限，保证结果不发灰 */
const MIN_SEED_SATURATION = 0.38;

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

function rgbToHsl(r: number, g: number, b: number): HslColor {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    const l = (max + min) / 2;

    if (delta === 0) return { h: 0, s: 0, l };

    const s = delta / (1 - Math.abs(2 * l - 1));
    let h: number;
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
    return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = chroma * (1 - Math.abs((hp % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp < 1) [r, g, b] = [chroma, x, 0];
    else if (hp < 2) [r, g, b] = [x, chroma, 0];
    else if (hp < 3) [r, g, b] = [0, chroma, x];
    else if (hp < 4) [r, g, b] = [0, x, chroma];
    else if (hp < 5) [r, g, b] = [x, 0, chroma];
    else [r, g, b] = [chroma, 0, x];

    const m = l - chroma / 2;
    const toHex = (value: number) =>
        clamp(Math.round((value + m) * 255), 0, 255)
            .toString(16)
            .padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const loadImage = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        // blob / 同源图片不需要 CORS；远程图片靠服务端 CORS 才能读像素
        image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("封面图片加载失败"));
        image.src = url;
    });

export const extractCoverPalette = async (
    url: string
): Promise<CoverPalette | null> => {
    if (!url) return null;

    let image: HTMLImageElement;
    try {
        image = await loadImage(url);
    } catch {
        // 图片加载失败（不是图片 / 跨域 / 已失效），交给主题色
        return null;
    }

    const width = Math.min(
        SAMPLE_SIZE,
        image.naturalWidth || image.width || SAMPLE_SIZE
    );
    const height = Math.min(
        SAMPLE_SIZE,
        image.naturalHeight || image.height || SAMPLE_SIZE
    );
    if (!width || !height) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(image, 0, 0, width, height);

    let pixels: Uint8ClampedArray;
    try {
        pixels = ctx.getImageData(0, 0, width, height).data;
    } catch {
        // 跨域图片会污染画布，读不了像素
        return null;
    }

    return paletteFromPixels(pixels);
};

/**
 * 纯计算部分：从 RGBA 像素里提炼主题色。
 * 拆出来是为了能脱离 canvas / DOM 做单元验证。
 */
export const paletteFromPixels = (
    pixels: Uint8ClampedArray
): CoverPalette | null => {
    const buckets = Array.from({ length: HUE_BUCKETS }, () => ({
        weight: 0,
        r: 0,
        g: 0,
        b: 0,
    }));

    let totalPixels = 0;
    let colorfulPixels = 0;

    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]! < MIN_ALPHA) continue;
        totalPixels += 1;

        const r = pixels[i]!;
        const g = pixels[i + 1]!;
        const b = pixels[i + 2]!;
        const hsl = rgbToHsl(r, g, b);

        if (hsl.l < MIN_LIGHTNESS || hsl.l > MAX_LIGHTNESS) continue;
        if (hsl.s < MIN_CHROMA_SATURATION) continue;

        colorfulPixels += 1;
        const index = Math.min(
            HUE_BUCKETS - 1,
            Math.floor((hsl.h / 360) * HUE_BUCKETS)
        );
        const bucket = buckets[index]!;
        // 越鲜艳的像素权重越高，灰调像素不参与
        const weight = 0.35 + hsl.s * 0.65;
        bucket.weight += weight;
        bucket.r += r * weight;
        bucket.g += g * weight;
        bucket.b += b * weight;
    }

    // 彩色像素太少：灰度图 / 黑白封面，直接交给页面主题色
    if (!totalPixels || colorfulPixels < Math.max(24, totalPixels * 0.015)) {
        return null;
    }

    const best = buckets.reduce((acc, bucket) =>
        bucket.weight > acc.weight ? bucket : acc
    );
    if (best.weight <= 0) return null;

    const seed = rgbToHsl(
        best.r / best.weight,
        best.g / best.weight,
        best.b / best.weight
    );
    if (!Number.isFinite(seed.h) || !Number.isFinite(seed.s)) return null;

    const saturation = clamp(
        Math.max(seed.s, MIN_SEED_SATURATION),
        MIN_SEED_SATURATION,
        0.85
    );

    return {
        // 深色端保留色相，但不再一路压到黑色
        primary: hslToHex(seed.h, clamp(saturation * 0.95, 0.4, 0.85), 0.2),
        // 浅色端提亮，作为渐变终点和强调色
        secondary: hslToHex(seed.h, clamp(saturation * 0.75, 0.32, 0.72), 0.68),
        text: "#f8fafc",
    };
};

// 同一个音频地址重复打开时直接复用上次的调色板，
// 避免「先主题色 → 再变成封面色」的二次跳变。
const paletteCache = new Map<string, CoverPalette>();
const MAX_CACHE_ENTRIES = 100;

export const getCachedPalette = (key: string): CoverPalette | null =>
    paletteCache.get(key) ?? null;

export const setCachedPalette = (key: string, palette: CoverPalette) => {
    if (!key) return;
    if (paletteCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = paletteCache.keys().next().value;
        if (oldest !== undefined) paletteCache.delete(oldest);
    }
    paletteCache.set(key, palette);
};
