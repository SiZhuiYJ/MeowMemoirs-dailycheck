import { defineStore } from "pinia";
import { ref, computed } from "vue";

/**
 * uni-app 主题系统（与 web 端保持同一套「单色风格」）
 *
 * 设计目标：
 * 1. 用户只选**一个种子色**（默认 #e3c0df，与 web DEFAULT_THEME 一致），
 *    其余强调色 / 浅底 / 深色动作按钮 / 外发光全部由它按同一套 HSL 规则推导，
 *    界面整体是「中性灰 + 单一强调色」的单色风格，不再有绿 / 蓝 / 黄混用。
 * 2. 日间 / 夜间两套色阶，默认日间（与 web 默认一致），可在设置页切换。
 * 3. 所有颜色都写成具体的 hex / rgba CSS 变量（不用 color-mix），
 *    兼容微信小程序与 H5 的 CSS 变量支持范围。
 *
 * 导出方式：`themeStyle` 绑定到页面根节点（:style），变量会向下继承；
 * 中性色同时写在 App.vue 的 `page` 选择器上作为兜底。
 *
 * 推导算法与 web/src/composables/theme-palette.ts 完全一致，
 * 改这里时请同步 web 端，避免两端色阶漂移。
 */

export type ThemeMode = "light" | "dark";

/** 快捷种子色（与 web THEME_COLOR_PRESETS 一致，默认色排第一）。 */
export const PRESET_SEEDS = [
  "#e3c0df",
  "#b8d8f8",
  "#c8e6c9",
  "#ffe0b2",
  "#d1c4e9",
  "#f8bbd0",
  "#80cbc4",
  "#cfd8dc",
] as const;

export const DEFAULT_SEED = "#e3c0df";

const STORAGE_SEED = "theme_seed";
const STORAGE_MODE = "theme_mode";

const WHITE = "#ffffff";
const DARK_SURFACE = "#020617";
const INK = "#2b1428";

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface HslColor {
  h: number;
  s: number;
  l: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** 接受 #rgb / #rrggbb，统一返回小写 #rrggbb；非法输入返回 null。 */
export function normalizeHexColor(input: string): string | null {
  const value = (input || "").trim().replace(/^#/, "");
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
  const normalized = normalizeHexColor(hex) ?? DEFAULT_SEED;
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
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
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
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
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
function pickOnColor(background: string): string {
  return contrastRatio(background, WHITE) > contrastRatio(background, INK)
    ? WHITE
    : INK;
}

/** 深色动作按钮的字体色：白字达到 3:1 就用白色，否则回退深色字。 */
function pickActionOnColor(background: string): string {
  const whiteContrast = contrastRatio(background, WHITE);
  const inkContrast = contrastRatio(background, INK);
  if (whiteContrast >= 3) return WHITE;
  if (inkContrast >= 3) return INK;
  return whiteContrast >= inkContrast ? WHITE : INK;
}

export type ThemePalette = Record<string, string>;

/**
 * 由种子色生成一整套 CSS 变量（中性色 + 强调色 + 语义色 + 兼容别名）。
 * @param seed 种子色
 * @param mode 取哪一套明暗色阶
 */
export function buildThemePalette(seed: string, mode: ThemeMode): ThemePalette {
  const normalized = normalizeHexColor(seed) ?? DEFAULT_SEED;
  const rgb = hexToRgb(normalized);
  const hsl = rgbToHsl(rgb);
  const { h, s, l } = hsl;

  // —— 日间色阶（强调色压深，保证白底可读）——
  const lightStrong = hslToHex({ h, s: clamp(s * 0.84, 0.18, 0.7), l: 0.46 });
  const lightDeep = hslToHex({ h, s: clamp(s * 0.9, 0.18, 0.7), l: 0.35 });
  const lightMuted = hslToHex({ h, s: clamp(s * 0.66, 0.12, 0.55), l: 0.58 });
  const lightSoft = hslToHex({ h, s: clamp(s * 1.2, 0.2, 0.7), l: 0.94 });
  const lightSofter = hslToHex({ h, s: clamp(s * 1.05, 0.15, 0.65), l: 0.97 });
  const lightActionActive = hslToHex({
    h,
    s: clamp(s * 0.9, 0.2, 0.7),
    l: 0.3,
  });
  const lightPrimaryHover = hslToHex({ h, s, l: clamp(l - 0.08, 0.5, 0.9) });
  const lightPrimaryActive = hslToHex({ h, s, l: clamp(l - 0.14, 0.45, 0.85) });

  // —— 夜间色阶（强调色提亮，保证深底可读）——
  const darkStrong =
    l >= 0.7 ? normalized : hslToHex({ h, s: clamp(s, 0.15, 0.75), l: 0.72 });
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
  const darkAction = hslToHex({ h, s: clamp(s * 0.34, 0.08, 0.3), l: 0.44 });
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

  const outerGlow = `0 24px 70px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.24), 0 12px 30px rgba(17, 24, 39, 0.14)`;
  const outerGlowSoft = `0 12px 36px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18), 0 6px 16px rgba(17, 24, 39, 0.1)`;
  const outerGlowLighter = `0 6px 18px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14), 0 3px 8px rgba(17, 24, 39, 0.06)`;

  // —— 中性色：与 web 日 / 夜主题一一对应（灰蓝中性 + 单一强调色）——
  const neutral: Record<string, string> = isLight
    ? {
        "--bg-color": "#f3f4f6",
        "--bg-elevated": "#ffffff",
        "--surface-soft": "#f9fafb",
        "--border-color": "#e5e7eb",
        "--border-strong": "#d1d5db",
        "--divider-color": "#f3f4f6",
        "--text-color": "#111827",
        "--text-muted": "#6b7280",
        "--text-faint": "#9ca3af",
        "--mask-color": "rgba(17, 24, 39, 0.32)",
        "--card-shadow": outerGlowLighter,
        // 顶栏毛玻璃（与 web chat 顶部栏一致：半透明底 + 背景模糊）
        "--header-bg": "rgba(243, 244, 246, 0.52)",
        "--header-bg-fallback": "rgba(243, 244, 246, 0.78)",
        "--header-border": "rgba(17, 24, 39, 0.08)",
        // 遮罩层毛玻璃（打卡列表「未开始 / 已结束」卡片的蒙层）
        "--overlay-bg": "rgba(243, 244, 246, 0.4)",
        "--overlay-bg-fallback": "rgba(243, 244, 246, 0.78)",
      }
    : {
        "--bg-color": "#020617",
        "--bg-elevated": "#0f172a",
        "--surface-soft": "#111c2e",
        "--border-color": "rgba(148, 163, 184, 0.16)",
        "--border-strong": "#263449",
        "--divider-color": "rgba(148, 163, 184, 0.12)",
        "--text-color": "#e5e7eb",
        "--text-muted": "#9ca3af",
        "--text-faint": "#94a3b8",
        "--mask-color": "rgba(2, 6, 23, 0.62)",
        "--card-shadow": "0 10px 30px rgba(2, 6, 23, 0.45)",
        "--header-bg": "rgba(2, 6, 23, 0.55)",
        "--header-bg-fallback": "rgba(2, 6, 23, 0.8)",
        "--header-border": "rgba(148, 163, 184, 0.14)",
        "--overlay-bg": "rgba(2, 6, 23, 0.45)",
        "--overlay-bg-fallback": "rgba(2, 6, 23, 0.8)",
      };

  // —— 语义色：沿用 web 日历 / 提示的配色（成功绿、补签黄、漏签红）——
  const semantic: Record<string, string> = isLight
    ? {
        "--color-success": "#22c55e",
        "--color-success-soft": "rgba(34, 197, 94, 0.12)",
        "--color-success-text": "#15803d",
        "--color-warning": "#eab308",
        "--color-warning-soft": "rgba(234, 179, 8, 0.14)",
        "--color-warning-text": "#a16207",
        "--color-danger": "#ef4444",
        "--color-danger-soft": "rgba(239, 68, 68, 0.1)",
        "--color-danger-text": "#b91c1c",
        "--color-info": "#6b7280",
      }
    : {
        "--color-success": "#4ade80",
        "--color-success-soft": "rgba(74, 222, 128, 0.16)",
        "--color-success-text": "#86efac",
        "--color-warning": "#facc15",
        "--color-warning-soft": "rgba(250, 204, 21, 0.16)",
        "--color-warning-text": "#fde047",
        "--color-danger": "#f87171",
        "--color-danger-soft": "rgba(248, 113, 113, 0.16)",
        "--color-danger-text": "#fca5a5",
        "--color-info": "#94a3b8",
      };

  return {
    ...neutral,
    ...semantic,

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

    // —— 兼容旧代码的别名（uni-app 老页面用到这些名字）——
    "--theme-primary-light": soft,
    "--bg-soft": soft,
    "--accent-on": contrast,
    "--uni-color-primary": strong,
    "--uni-bg-color": neutral["--bg-color"]!,
    "--uni-text-color": neutral["--text-color"]!,
  };
}

export const useThemeStore = defineStore("theme", () => {
  const currentSeed = ref<string>(DEFAULT_SEED);
  /** 兼容旧设置页代码：单种子色时等价于 [seed]。 */
  const customColors = ref<string[]>([DEFAULT_SEED]);
  const isDark = ref(false);
  const mode = computed<ThemeMode>(() => (isDark.value ? "dark" : "light"));

  /** 当前模式下的完整 CSS 变量表，绑定到页面根节点 :style。 */
  const themeStyle = computed<ThemePalette>(() =>
    buildThemePalette(currentSeed.value, mode.value),
  );

  /** 兼容旧页面读取的四色数组（单色风格下是同一强调色的四档）。 */
  const currentColors = computed<string[]>(() => [
    themeStyle.value["--theme-color-strong"]!,
    themeStyle.value["--theme-color-muted"]!,
    themeStyle.value["--theme-color-soft"]!,
    themeStyle.value["--bg-color"]!,
  ]);

  function persist() {
    try {
      uni.setStorageSync(STORAGE_SEED, currentSeed.value);
      uni.setStorageSync(STORAGE_MODE, isDark.value ? "dark" : "light");
    } catch (e) {
      // 隐私模式 / 存储不可用时忽略
    }
  }

  /** 切换强调种子色（非法 hex 返回 false）。 */
  function setSeed(seed: string): boolean {
    const normalized = normalizeHexColor(seed);
    if (!normalized) return false;
    currentSeed.value = normalized;
    persist();
    updateNavBarColor();
    return true;
  }

  /** 切换日间 / 夜间。 */
  function setDarkMode(dark: boolean): void {
    isDark.value = !!dark;
    persist();
    updatePageBackground();
    updateNavBarColor();
  }

  function toggleDarkMode(): void {
    setDarkMode(!isDark.value);
  }

  /** 兼容旧设置页：setPalette([4 色]) → 取第一色作为种子。 */
  function setPalette(colors: string[]): void {
    if (Array.isArray(colors) && colors.length > 0) setSeed(colors[0]!);
  }

  /** 兼容旧设置页：自定义色数组 → 取第一色作为种子保存。 */
  function setCustomPalette(colors: string[]): void {
    if (Array.isArray(colors) && colors.length > 0) {
      const normalized = normalizeHexColor(colors[0]!) ?? DEFAULT_SEED;
      customColors.value = [normalized];
      try {
        uni.setStorageSync("custom_theme_seed", normalized);
      } catch (e) {
        // ignore
      }
    }
  }

  function initTheme(): void {
    try {
      const storedSeed = uni.getStorageSync(STORAGE_SEED);
      if (typeof storedSeed === "string" && normalizeHexColor(storedSeed)) {
        currentSeed.value = normalizeHexColor(storedSeed)!;
      }
      const storedMode = uni.getStorageSync(STORAGE_MODE);
      if (storedMode === "dark" || storedMode === "light") {
        isDark.value = storedMode === "dark";
      }
      const storedCustom = uni.getStorageSync("custom_theme_seed");
      if (typeof storedCustom === "string" && normalizeHexColor(storedCustom)) {
        customColors.value = [normalizeHexColor(storedCustom)!];
      }
    } catch (e) {
      // 忽略存储异常，使用默认主题
    }
    updatePageBackground();
    updateNavBarColor();
  }

  /** 同步系统页面底色（小程序用 setBackgroundColor，H5 写 document 兜底滚动区）。 */
  function updatePageBackground(): void {
    const bg = isDark.value ? "#020617" : "#f3f4f6";
    try {
      // @ts-ignore 小程序 / App 端支持；H5 端可能不存在该 API
      if (typeof uni.setBackgroundColor === "function") {
        uni.setBackgroundColor({
          backgroundColor: bg,
          backgroundColorTop: bg,
          backgroundColorBottom: bg,
        });
      }
    } catch (e) {
      // ignore
    }
    try {
      // @ts-ignore H5 兜底
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty("--bg-color", bg);
        if (document.body) document.body.style.backgroundColor = bg;
      }
    } catch (e) {
      // ignore
    }
  }

  function updateNavBarColor(): void {
    // 登录页导航栏保持固定浅色（与 web 登录页独立配色一致）
    try {
      const pages = getCurrentPages();
      if (
        pages.length > 0 &&
        pages[pages.length - 1]!.route === "pages/auth/index"
      ) {
        return;
      }
    } catch (e) {
      // ignore
    }

    const bg = isDark.value ? "#020617" : "#f3f4f6";
    try {
      uni.setNavigationBarColor({
        frontColor: isDark.value ? "#ffffff" : "#000000",
        backgroundColor: bg,
        animation: { duration: 250, timingFunc: "easeIn" },
        fail: (err) => {
          // 页面栈未就绪时会报 page not found，忽略即可
          if (err?.errMsg && !err.errMsg.includes("page not found")) {
            console.warn("Failed to set nav bar color", err);
          }
        },
      });
    } catch (e) {
      // ignore
    }
  }

  return {
    currentSeed,
    currentColors,
    customColors,
    isDark,
    mode,
    themeStyle,
    setSeed,
    setDarkMode,
    toggleDarkMode,
    setPalette,
    setCustomPalette,
    initTheme,
    updateNavBarColor,
    updatePageBackground,
    PRESET_SEEDS,
    DEFAULT_SEED,
  };
});
