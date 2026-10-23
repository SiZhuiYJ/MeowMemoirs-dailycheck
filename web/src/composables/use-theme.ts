import { computed, nextTick, readonly, ref } from "vue";
import { DEFAULT_THEME } from "@/config";

/**
 * 日间 / 夜间主题切换。
 *
 * 切换时不是「全局瞬间换色」，而是以视口中心为圆心扩散一圈环形波纹：
 * 新主题的画面从圆心向外揭开，波纹扫过的区域随之更新；波纹本身用
 * DEFAULT_THEME（默认 #e3c0df）描边 + 发光。
 *
 * 实现分两条路径：
 * 1. 浏览器支持 View Transitions API：把「旧主题画面」和「新主题画面」
 *    各拍一张快照，用 clip-path 圆形裁切动画揭开新快照，同时单独给
 *    波纹层做缩放动画。整页（文字、面板、背景）都会随波纹一起更新。
 * 2. 不支持时（或过渡被跳过）：给 <html> 临时加颜色 transition，
 *    再用同一套波纹元素做一枚扩散的环形光波。颜色仍然平滑过渡。
 *
 * 系统开启「减少动态效果」时，程序化 setTheme 默认直接生效；
 * 但顶栏按钮是用户主动点击的明确反馈，toggleTheme 会 force 播放波纹，
 * 避免出现「点了按钮却什么都没有」的瞬切。
 */

export type ThemeMode = "light" | "dark";

export interface SetThemeOptions {
  /** 传 false 可跳过动画（首屏初始化等场景）。 */
  animate?: boolean;
  /**
   * 强制播放动画（用户点击顶栏切换时使用）。
   * 系统开启「减少动态效果」时，程序化切换默认直接生效；
   * 但用户主动点击是一次明确的视觉反馈，不能静默变成瞬切。
   */
  force?: boolean;
}

/** localStorage 键名：index.html 首屏脚本与本文件两处必须一致。 */
const THEME_STORAGE_KEY = "theme";

/** 动画时长；CSS 侧通过 --theme-transition-duration 读取同一数值。 */
export const THEME_TRANSITION_MS = 720;
/** 降级动画的缓动；theme-transition.scss 的 --theme-transition-ease 必须一致。 */
const THEME_TRANSITION_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

const SWITCHING_CLASS = "theme-switching";
const COLOR_TRANSITION_CLASS = "theme-colors-transitioning";
const RIPPLE_LAYER_ID = "theme-ripple-layer";
const RIPPLE_LAYER_CLASS = "theme-ripple-ring";

const currentTheme = ref<ThemeMode>(readStoredTheme() ?? "light");
const isDark = computed(() => currentTheme.value === "dark");

let initialized = false;
let switching = false;
/** 动画过程中用户又点了切换：等当前动画结束再应用最终状态。 */
let queuedTheme: ThemeMode | null = null;

function readStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    // 隐私模式 / 禁用存储时照常使用默认主题
    return null;
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function supportsViewTransition(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function"
  );
}

/** #e3c0df -> "227, 192, 223"，供 rgba(var(--theme-color-rgb), α) 使用。 */
function hexToRgbChannels(hex: string): string {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int)) return "227, 192, 223";
  return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`;
}

/** 相对亮度（WCAG 2.x），用于给主题底自动挑白字 / 黑字。 */
function relativeLuminance(hex: string): number {
  const channels = hexToRgbChannels(hex)
    .split(",")
    .map((channel) => Number.parseInt(channel.trim(), 10) / 255)
    .map((channel) =>
      channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (left, right) => right - left,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}

/**
 * 根据背景色挑对比度更高的前景色。
 * 当前种子色 #e3c0df 会选深梅色；主题色变深时自动切到白色。
 */
function pickOnColor(background: string): string {
  return contrastRatio(background, "#ffffff") >
    contrastRatio(background, "#2b1428")
    ? "#ffffff"
    : "#2b1428";
}

/**
 * 把主题色写进 CSS 变量。
 * 颜色本身只在 config/index.ts 维护一份，样式表里的值只是首屏兜底。
 */
function applyThemeColorVariables(): void {
  const root = document.documentElement;
  root.style.setProperty("--theme-color", DEFAULT_THEME);
  root.style.setProperty("--theme-color-rgb", hexToRgbChannels(DEFAULT_THEME));
  // 浅色主题底上的文字色按对比度自动选白 / 深梅
  root.style.setProperty(
    "--theme-color-contrast",
    pickOnColor(DEFAULT_THEME),
  );
  root.style.setProperty(
    "--theme-transition-duration",
    `${THEME_TRANSITION_MS}ms`,
  );
}

function applyThemeAttributes(mode: ThemeMode): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", mode);
  // Element Plus 的暗色变量靠 .dark 类生效，和 data-theme 一起维护
  root.classList.toggle("dark", mode === "dark");
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 存不下也不影响本次切换
  }
  currentTheme.value = mode;
}

/**
 * 波纹层：一个铺满视口对角线的大圆，平时完全透明。
 * 支持 View Transition 时让它以 theme-ripple 命名参与快照，
 * 波纹由 ::view-transition-new(theme-ripple) 绘制；
 * 不支持时它就是真实的动画元素。
 */
function ensureRippleLayer(): HTMLElement {
  let layer = document.getElementById(RIPPLE_LAYER_ID);
  if (!layer) {
    layer = document.createElement("div");
    layer.id = RIPPLE_LAYER_ID;
    layer.className = RIPPLE_LAYER_CLASS;
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
  }
  const diagonal = Math.hypot(window.innerWidth, window.innerHeight);
  const radius = Math.ceil(diagonal / 2) + 32;
  layer.style.setProperty("--theme-ripple-diameter", `${radius * 2}px`);

  // circle() 的百分比半径参照「对角线 ÷ √2」。按同一个半径换算，
  // 整页揭开的圆边与圆环动画的半径就能始终重合。
  const referenceRadius = diagonal / Math.SQRT2;
  document.documentElement.style.setProperty(
    "--theme-ripple-end-radius",
    `${((radius / referenceRadius) * 100).toFixed(2)}%`,
  );
  return layer;
}

/** View Transitions 路径：新旧主题快照 + 圆形揭开，波纹由独立伪元素绘制。 */
async function runViewTransition(next: ThemeMode): Promise<void> {
  const root = document.documentElement;
  const layer = ensureRippleLayer();
  // 先加类：旧快照拍下时波纹层才会获得 view-transition-name
  root.classList.add(SWITCHING_CLASS);

  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(async () => {
      applyThemeAttributes(next);
      // 等 Vue 把按钮图标等响应式内容更新完，再拍新快照
      await nextTick();
    });
  } catch {
    // API 存在但此刻启动不了（例如已有别的过渡）：退回 DOM 波纹
    root.classList.remove(SWITCHING_CLASS);
    await runColorTransitionFallback(next);
    return;
  }

  try {
    await transition.finished;
  } catch {
    // 过渡被中途跳过（页面隐藏、被中断等）：主题已经写入，
    // 再补一枚环形波纹作为反馈，不能变成无提示的瞬切。
    applyThemeAttributes(next);
    root.classList.remove(SWITCHING_CLASS);
    await runColorTransitionFallback(next);
    return;
  }

  root.classList.remove(SWITCHING_CLASS);
  layer.classList.remove("is-rippling");
}

/** 降级路径：全局颜色 transition + 真实元素做的扩散波纹。 */
function runColorTransitionFallback(next: ThemeMode): Promise<void> {
  return new Promise((resolve) => {
    const root = document.documentElement;
    const layer = ensureRippleLayer();
    let settled = false;
    let timer = 0;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      root.classList.remove(COLOR_TRANSITION_CLASS);
      layer.classList.remove("is-rippling");
      resolve();
    };

    // 先挂 transition，再读一次布局，保证浏览器以旧颜色作为过渡起点
    root.classList.add(COLOR_TRANSITION_CLASS);
    void root.getBoundingClientRect();
    applyThemeAttributes(next);

    layer.classList.add("is-rippling");
    try {
      const animation = layer.animate(
        [
          { transform: "scale(0.02)", opacity: 0 },
          { opacity: 0.9, offset: 0.1 },
          { opacity: 0.55, offset: 0.62 },
          { transform: "scale(1)", opacity: 0 },
        ],
        {
          duration: THEME_TRANSITION_MS,
          easing: THEME_TRANSITION_EASE,
          fill: "both",
        },
      );
      animation.finished.then(finish, finish);
    } catch {
      // 没有 Web Animations 时至少保留颜色过渡
    }

    timer = window.setTimeout(finish, THEME_TRANSITION_MS + 80);
  });
}

function applyImmediately(next: ThemeMode): void {
  const root = document.documentElement;
  root.classList.remove(SWITCHING_CLASS, COLOR_TRANSITION_CLASS);
  applyThemeAttributes(next);
}

/**
 * 初始化主题。必须在 app.mount() 之前调用：
 * 否则页面会先按默认主题渲染一帧，再跳到用户保存的主题。
 */
export function initTheme(): void {
  if (initialized || typeof document === "undefined") return;
  initialized = true;
  applyThemeColorVariables();
  // 首帧就建好透明波纹层：切换时它已经参与过渲染，
  // 旧 / 新快照都能稳定拿到 theme-ripple 这个命名元素。
  ensureRippleLayer();

  // index.html 的首屏脚本已经按 localStorage 写过一次 data-theme；
  // 这里以同一份存储为准再做一次幂等校正，顺便把状态同步到 ref。
  const mode = readStoredTheme() ?? currentTheme.value;
  applyThemeAttributes(mode);
}

/**
 * 切换主题。返回 Promise 便于测试等待动画结束。
 * 动画进行中再次调用会合并为最终状态，不会叠加两层波纹。
 */
export function setTheme(
  next: ThemeMode,
  options: SetThemeOptions = {},
): Promise<void> {
  if (typeof document === "undefined") {
    currentTheme.value = next;
    return Promise.resolve();
  }

  const root = document.documentElement;

  // 先处理「动画进行中」：即使 next 已经等于当前 ref，也必须更新队列。
  // 否则快速连点「暗 -> 明 -> 暗」时，最后一次会被当成无变化丢掉，
  // 动画结束后反而落到中间那次「明」。
  if (switching) {
    queuedTheme = next;
    return Promise.resolve();
  }

  if (next === currentTheme.value && root.getAttribute("data-theme") === next) {
    return Promise.resolve();
  }

  const animate =
    options.animate !== false &&
    (options.force === true || !prefersReducedMotion());
  switching = true;

  let task: Promise<void>;
  if (!animate) {
    applyImmediately(next);
    task = Promise.resolve();
  } else if (supportsViewTransition()) {
    // startViewTransition 在当前 TS DOM 类型里是必有方法，
    // 但旧内核运行时没有；supportsViewTransition 已做运行时兜底。
    task = runViewTransition(next);
  } else {
    task = runColorTransitionFallback(next);
  }

  return task.finally(() => {
    switching = false;
    const queued = queuedTheme;
    queuedTheme = null;
    if (queued && queued !== currentTheme.value) {
      // 快速连点时不再播第二遍动画，直接落到用户最后选择的状态
      applyImmediately(queued);
    }
  });
}

export function toggleTheme(): Promise<void> {
  return setTheme(currentTheme.value === "dark" ? "light" : "dark", {
    force: true,
  });
}

/** 组件里读取主题状态。 */
export function useTheme() {
  return {
    theme: readonly(currentTheme),
    isDark,
    setTheme,
    toggleTheme,
  };
}
