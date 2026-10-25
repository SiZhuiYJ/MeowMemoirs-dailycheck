import { DEFAULT_THEME } from "@/config";

/**
 * 主题色 → 全局色阶。
 *
 * 用户只选一个种子色，其他颜色都从它的 HSL 推导：
 * - 日间：压深得到可读的强调色 / 动作按钮色；加白得到浅底。
 * - 夜间：提亮得到深色底上的强调色；动作按钮保持深色 + 白字。
 * - Element Plus 的 primary 色阶也一起生成，任意自定义色都能保持可读。
 *
 * 所有色值都是普通 hex / rgba，直接写进 <html> 的行内 CSS 变量，
 * 因此组件样式只需要引用变量，不需要在运行时重新计算。
 */

type ThemeMode = "light" | "dark";

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface HslColor {
  h: number;
  s: number;
  l: number;
}

export type ThemePalette = Record<string, string>;

const DARK_SURFACE = "#020617";
const INK = "#2b1428";
const WHITE = "#ffffff";
const BLACK = "#000000";

/** 下拉里的快捷色，默认色排第一。 */
export const THEME_COLOR_PRESETS = [
  DEFAULT_THEME,
  "#b8d8f8",
  "#c8e6c9",
  "#ffe0b2",
  "#d1c4e9",
  "#f8bbd0",
  "#80cbc4",
  "#cfd8dc",
] as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** 接受 #rgb / #rrggbb，统一返回小写 #rrggbb；非法输入返回 null。 */
export function normalizeHexColor(input: string): string | null {
  const value = input.trim().replace(/^#/, "");
  if (!/^[\da-f]{3}$|^[\da-f]{6}$/i.test(value)) return null;
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  return `#${full.toLowerCase()}`;
}

function hexToRgb(hex: string): RgbColor {
  const normalized = normalizeHexColor(hex) ?? DEFAULT_THEME;
  const value = normalized.slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: RgbColor): string {
  const part = (channel: number): string =>
    clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

function rgbToHsl({ r, g, b }: RgbColor): HslColor {
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

function hslToRgb({ h, s, l }: HslColor): RgbColor {
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
  return {
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
  };
}

function hslToHex(hsl: HslColor): string {
  return rgbToHex(hslToRgb(hsl));
}

function mixHex(base: string, mixWith: string, amount: number): string {
  const a = hexToRgb(base);
  const b = hexToRgb(mixWith);
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

function rgbaString(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channels = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (left, right) => right - left,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}

/** 根据背景色挑对比度更高的前景色（用于浅底 / 种子色背景，按 4.5:1 倾向）。 */
export function pickOnColor(background: string): string {
  return contrastRatio(background, WHITE) > contrastRatio(background, INK)
    ? WHITE
    : INK;
}

/**
 * 深色动作按钮的字体色。
 *
 * 动作按钮文字加粗、字号不大，优先用白字；只要白字对底色达到 3:1
 * （WCAG 大字号 / UI 组件的门槛）就用白色，否则回退到深色字。
 * 这样 #80cbc4 这类中等明度的主题色会得到白字，而浅黄等颜色仍会自动
 * 切回深色字，不需要为每个颜色手写例外。
 */
export function pickActionOnColor(background: string): string {
  const whiteContrast = contrastRatio(background, WHITE);
  const inkContrast = contrastRatio(background, INK);
  if (whiteContrast >= 3) return WHITE;
  if (inkContrast >= 3) return INK;
  return whiteContrast >= inkContrast ? WHITE : INK;
}

/**
 * 生成一整套主题变量。
 * @param seed 用户选择的种子色
 * @param mode 当前实际应使用的明暗色阶（聊天浅色面固定传 light）
 */
export function buildThemePalette(
  seed: string,
  mode: ThemeMode,
): ThemePalette {
  const normalized = normalizeHexColor(seed) ?? DEFAULT_THEME;
  const rgb = hexToRgb(normalized);
  const hsl = rgbToHsl(rgb);
  const { h, s, l } = hsl;

  // —— 日间色阶（聊天浅色面也用它） ——
  const lightStrong = hslToHex({
    h,
    s: clamp(s * 0.84, 0.18, 0.7),
    l: 0.46,
  });
  const lightDeep = hslToHex({
    h,
    s: clamp(s * 0.9, 0.18, 0.7),
    l: 0.35,
  });
  const lightMuted = hslToHex({
    h,
    s: clamp(s * 0.66, 0.12, 0.55),
    l: 0.58,
  });
  const lightSoft = hslToHex({
    h,
    s: clamp(s * 1.2, 0.2, 0.7),
    l: 0.94,
  });
  const lightSofter = hslToHex({
    h,
    s: clamp(s * 1.05, 0.15, 0.65),
    l: 0.97,
  });
  const lightActionActive = hslToHex({
    h,
    s: clamp(s * 0.9, 0.2, 0.7),
    l: 0.3,
  });
  const lightPrimaryHover = hslToHex({ h, s, l: clamp(l - 0.08, 0.5, 0.9) });
  const lightPrimaryActive = hslToHex({ h, s, l: clamp(l - 0.14, 0.45, 0.85) });

  // —— 夜间色阶 ——
  const darkStrong =
    l >= 0.7
      ? normalized
      : hslToHex({ h, s: clamp(s, 0.15, 0.75), l: 0.72 });
  const darkDeep = hslToHex({
    h,
    s: clamp(s * 0.95, 0.12, 0.75),
    l: clamp(l + 0.04, 0.7, 0.9),
  });
  const darkMuted = hslToHex({
    h,
    s: clamp(s * 0.6, 0.1, 0.55),
    l: clamp(l - 0.1, 0.55, 0.72),
  });
  const darkPrimaryHover = hslToHex({
    h,
    s: clamp(s, 0.1, 0.8),
    l: clamp(l + 0.04, 0.6, 0.92),
  });
  const darkPrimaryActive = hslToHex({
    h,
    s: clamp(s, 0.1, 0.8),
    l: clamp(l + 0.08, 0.65, 0.95),
  });
  const darkAction = hslToHex({
    h,
    s: clamp(s * 0.34, 0.08, 0.3),
    l: 0.44,
  });
  const darkActionHover = hslToHex({
    h,
    s: clamp(s * 0.34, 0.08, 0.3),
    l: 0.48,
  });
  const darkActionActive = hslToHex({
    h,
    s: clamp(s * 0.37, 0.08, 0.3),
    l: 0.37,
  });

  const isLight = mode === "light";
  const strong = isLight ? lightStrong : darkStrong;
  const deep = isLight ? lightDeep : darkDeep;
  const muted = isLight ? lightMuted : darkMuted;
  const soft = isLight ? lightSoft : rgbaString(normalized, 0.16);
  const softer = isLight ? lightSofter : rgbaString(normalized, 0.08);
  const primaryHover = isLight ? lightPrimaryHover : darkPrimaryHover;
  const primaryActive = isLight ? lightPrimaryActive : darkPrimaryActive;
  const actionBg = isLight ? lightStrong : darkAction;
  const actionHover = isLight ? lightDeep : darkActionHover;
  const actionActive = isLight ? lightActionActive : darkActionActive;
  const gradientStart = isLight ? actionBg : actionHover;
  const gradientEnd = isLight ? actionHover : actionActive;
  const contrast = pickOnColor(normalized);
  const actionContrast = pickActionOnColor(actionBg);

  // 主题色外发光：与主题色设置对话框原来的投影保持一致，
  // 抽成全局 token 后，普通弹窗 / 卡片 / 面板都复用同一套效果。
  const outerGlow = `0 24px 70px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.24), 0 12px 30px rgba(17, 24, 39, 0.14)`;
  const outerGlowSoft = `0 12px 36px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18), 0 6px 16px rgba(17, 24, 39, 0.1)`;
  const outerGlowLighter = `0 6px 18px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14), 0 3px 8px rgba(17, 24, 39, 0.06)`;

  const primary = strong;
  const lightMixBase = isLight ? WHITE : DARK_SURFACE;
  const darkMixBase = isLight ? BLACK : WHITE;

  const light = (amount: number): string =>
    mixHex(primary, lightMixBase, amount);

  return {
    "--theme-color": normalized,
    "--theme-color-rgb": `${rgb.r}, ${rgb.g}, ${rgb.b}`,
    "--theme-color-strong": strong,
    "--theme-color-deep": deep,
    "--theme-color-muted": muted,
    "--theme-color-soft": soft,
    "--theme-color-softer": softer,
    "--theme-color-contrast": contrast,
    "--theme-outer-glow": outerGlow,
    "--theme-outer-glow-soft": outerGlowSoft,
    "--theme-outer-glow-lighter": outerGlowLighter,
    // Element Plus 的弹窗 / 下拉 / 卡片统一使用主题色外发光
    "--el-box-shadow": outerGlow,
    "--el-box-shadow-light": outerGlowSoft,
    "--el-box-shadow-lighter": outerGlowLighter,
    "--el-box-shadow-dark": outerGlowSoft,
    "--theme-primary": strong,
    "--theme-primary-bg": normalized,
    "--theme-primary-hover": primaryHover,
    "--theme-primary-active": primaryActive,
    "--theme-action-bg": actionBg,
    "--theme-action-hover": actionHover,
    "--theme-action-active": actionActive,
    "--theme-action-contrast": actionContrast,
    "--theme-gradient-start": gradientStart,
    "--theme-gradient-end": gradientEnd,
    "--theme-gradient": `linear-gradient(135deg, ${gradientStart}, ${gradientEnd})`,
    "--accent-color": strong,
    "--accent-alt": normalized,
    // Element Plus 的 primary 色阶
    "--el-color-primary": primary,
    "--el-color-primary-light-3": light(0.3),
    "--el-color-primary-light-5": light(0.5),
    "--el-color-primary-light-7": light(0.7),
    "--el-color-primary-light-8": light(0.8),
    "--el-color-primary-light-9": light(0.9),
    "--el-color-primary-dark-2": mixHex(primary, darkMixBase, 0.2),
    // 聊天页固定浅色面：始终用日间的强调色 / 浅底
    "--chat-accent": lightStrong,
    "--chat-accent-soft": lightSoft,
  };
}
