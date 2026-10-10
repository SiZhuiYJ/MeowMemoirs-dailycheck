/**
 * 将颜色转换为带透明度的 rgba 字符串
 * @param color 颜色值，支持 #RGB, #RRGGBB, rgb(r,g,b)
 * @param alpha 透明度 0~1
 * @returns rgba 字符串，如 "rgba(255,0,0,0.5)"
 */
export function toRgba(color: string, alpha: number): string {
  // 解析颜色，提取 r,g,b 分量
  const parseColor = (
    col: string,
  ): { r: number; g: number; b: number } | null => {
    // 处理 #RGB 和 #RRGGBB
    const hexMatch = col.match(/^#?([a-f\d]{3}|[a-f\d]{6})$/i);
    if (hexMatch && hexMatch[1]) {
      let hex = hexMatch[1];
      if (hex.length === 3) {
        hex = hex
          .split("")
          .map((c) => c + c)
          .join("");
      }
      const num = parseInt(hex, 16);
      return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255,
      };
    }
    // 处理 rgb(r,g,b)
    const rgbMatch = col.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
      return {
        r: parseInt(rgbMatch[1], 10),
        g: parseInt(rgbMatch[2], 10),
        b: parseInt(rgbMatch[3], 10),
      };
    }
    return null; // 不支持的格式
  };

  const rgb = parseColor(color);
  if (!rgb) {
    throw new Error("Invalid color format");
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}
/**
 * 将颜色加深指定比例
 * @param color 颜色值，支持 #RGB, #RRGGBB, rgb(r,g,b)
 * @param amount 加深比例 0~1，0 为不变，1 为纯黑
 * @returns 加深后的十六进制颜色，格式 '#RRGGBB'
 */
export function darkenColor(color: string, amount: number): string {
  // 解析颜色为 {r,g,b} 对象（复用之前定义的 parseColor 函数）
  const parseColor = (col: string): { r: number; g: number; b: number } => {
    const hexMatch = col.match(/^#?([a-f\d]{3}|[a-f\d]{6})$/i);
    if (hexMatch && hexMatch[1]) {
      let hex = hexMatch[1];
      if (hex.length === 3) {
        hex = hex
          .split("")
          .map((c) => c + c)
          .join("");
      }
      const num = parseInt(hex, 16);
      return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255,
      };
    }
    const rgbMatch = col.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
      return {
        r: parseInt(rgbMatch[1], 10),
        g: parseInt(rgbMatch[2], 10),
        b: parseInt(rgbMatch[3], 10),
      };
    }
    throw new Error("Invalid color format");
  };

  const { r, g, b } = parseColor(color);

  // RGB 转 HSL
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / d + 2;
        break;
      case bNorm:
        h = (rNorm - gNorm) / d + 4;
        break;
    }
    h /= 6;
  }

  // 加深：降低亮度 Lightness，确保不小于 0
  const newL = Math.max(0, l - amount * l); // 按比例降低，也可直接用 l - amount，但限制范围

  // HSL 转 RGB
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let rgb: [number, number, number];
  if (s === 0) {
    rgb = [newL, newL, newL];
  } else {
    const q = newL < 0.5 ? newL * (1 + s) : newL + s - newL * s;
    const p = 2 * newL - q;
    rgb = [
      hue2rgb(p, q, h + 1 / 3),
      hue2rgb(p, q, h),
      hue2rgb(p, q, h - 1 / 3),
    ];
  }

  // 转回 0-255 并格式化为十六进制
  const toHex = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}
