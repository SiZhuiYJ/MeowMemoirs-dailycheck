import { computed, nextTick, readonly, ref } from "vue";
import { DEFAULT_THEME } from "@/config";
import {
  buildThemePalette,
  normalizeHexColor,
} from "@/composables/theme-palette";

/**
 * 主题模式（日间 / 夜间）与主题色（用户自定义）。
 *
 * 日 / 夜切换以视口中心为圆心扩散一圈环形波纹：
 * 新主题的画面从圆心向外揭开，波纹本身用当前主题色描边 + 发光。
 *
 * 主题色由用户在下拉里选择，持久化到 localStorage。种子色会实时生成
 * 整套色阶（强调色、浅底、深色动作按钮、Element Plus primary、聊天浅色面），
 * 因此任意颜色都能保持文字可读，不需要为每个颜色单独写样式。
 *
 * 实现分两条路径：
 * 1. 支持 View Transitions API：旧 / 新主题各拍一张快照，用 clip-path 圆形裁切。
 * 2. 不支持时：给 <html> 临时加颜色 transition，再用真实 DOM 元素做波纹。
 *
 * 系统开启「减少动态效果」时，程序化 setTheme 默认直接生效；
 * 但顶栏按钮是用户主动点击的明确反馈，toggleTheme 会 force 播放波纹。
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
const THEME_COLOR_STORAGE_KEY = "themeColor";

/** 动画时长；CSS 侧通过 --theme-transition-duration 读取同一数值。 */
export const THEME_TRANSITION_MS = 720;
/** 降级动画的缓动；theme-transition.scss 的 --theme-transition-ease 必须一致。 */
const THEME_TRANSITION_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

const SWITCHING_CLASS = "theme-switching";
const COLOR_TRANSITION_CLASS = "theme-colors-transitioning";
/** 只做颜色过渡、不播放整页波纹：主题色取色时使用。 */
const COLOR_ONLY_TRANSITION_CLASS = "theme-color-transitioning";
const COLOR_ONLY_TRANSITION_MS = 500;
const RIPPLE_LAYER_ID = "theme-ripple-layer";
const RIPPLE_LAYER_CLASS = "theme-ripple-ring";

const currentTheme = ref<ThemeMode>(readStoredTheme() ?? "light");
const currentThemeColor = ref<string>(readStoredThemeColor());
const isDark = computed(() => currentTheme.value === "dark");

let initialized = false;
let switching = false;
/** 主题色连续取色时，延长颜色过渡类的移除时间。 */
let colorTransitionTimer: number | null = null;
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

function readStoredThemeColor(): string {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    return (
      normalizeHexColor(window.localStorage.getItem(THEME_COLOR_STORAGE_KEY) ?? "") ??
      DEFAULT_THEME
    );
  } catch {
    return DEFAULT_THEME;
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

/**
 * 把当前主题色生成的全套变量写到 <html> 行内样式。
 *
 * 聊天页 / 用户主页挂载时 <html> 带 .theme-light-surface：
 * 这类固定浅色面要用日间色阶，即使全局主题是夜间。
 */
export function refreshThemePalette(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const lightSurface = root.classList.contains("theme-light-surface");
  const mode: ThemeMode =
    lightSurface || root.getAttribute("data-theme") !== "dark"
      ? "light"
      : "dark";
  const palette = buildThemePalette(currentThemeColor.value, mode);
  for (const [name, value] of Object.entries(palette)) {
    root.style.setProperty(name, value);
  }
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
      refreshThemePalette();
      // 等 Vue 把内容更新完，再拍新快照
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
    refreshThemePalette();
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
    refreshThemePalette();

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
  refreshThemePalette();
}

/**
 * 初始化主题。必须在 app.mount() 之前调用：
 * 否则页面会先按默认主题渲染一帧，再跳到用户保存的主题。
 */
export function initTheme(): void {
  if (initialized || typeof document === "undefined") return;
  initialized = true;

  // index.html 的首屏脚本已经按 localStorage 写过一次 data-theme / 种子色；
  // 这里以同一份存储为准再做一次幂等校正，并把完整色阶写入行内变量。
  const mode = readStoredTheme() ?? currentTheme.value;
  applyThemeAttributes(mode);
  currentThemeColor.value = readStoredThemeColor();
  refreshThemePalette();

  // 首帧就建好透明波纹层：切换时它已经参与过渲染，
  // 旧 / 新快照都能稳定拿到 theme-ripple 这个命名元素。
  ensureRippleLayer();
}

/**
 * 切换日 / 夜主题。返回 Promise 便于测试等待动画结束。
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

/**
 * 修改主题色并持久化。非法 hex 返回 false。
 * 颜色变化不播整页 View Transition（取色器会连续触发 input），
 * 但所有色阶是实时更新的。
 */
export function setThemeColor(color: string): boolean {
  const normalized = normalizeHexColor(color);
  if (!normalized) return false;
  if (normalized === currentThemeColor.value) return true;

  const root = document.documentElement;
  currentThemeColor.value = normalized;
  try {
    window.localStorage.setItem(THEME_COLOR_STORAGE_KEY, normalized);
  } catch {
    // 存不下也照常应用
  }

  // 取色时不做整页 View Transition，只让页面已有颜色平滑过渡。
  // 连续拖动取色器时复用同一个类，过渡会从当前颜色继续追到新颜色。
  root.classList.add(COLOR_ONLY_TRANSITION_CLASS);
  // 先强制一次样式计算，确保浏览器把旧颜色作为 transition 起点
  void root.getBoundingClientRect();
  refreshThemePalette();

  if (colorTransitionTimer !== null) {
    window.clearTimeout(colorTransitionTimer);
  }
  colorTransitionTimer = window.setTimeout(() => {
    colorTransitionTimer = null;
    root.classList.remove(COLOR_ONLY_TRANSITION_CLASS);
  }, COLOR_ONLY_TRANSITION_MS + 80);
  return true;
}

/** 恢复默认主题色。 */
export function resetThemeColor(): void {
  setThemeColor(DEFAULT_THEME);
}

/** 组件里读取主题状态。 */
export function useTheme() {
  return {
    theme: readonly(currentTheme),
    themeColor: readonly(currentThemeColor),
    isDark,
    setTheme,
    toggleTheme,
    setThemeColor,
    resetThemeColor,
  };
}
