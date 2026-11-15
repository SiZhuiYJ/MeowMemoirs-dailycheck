/**
 * 全局点击波纹（鼠标 / 手指 / 触控笔都生效）。
 *
 * 视觉：在点击位置扩散一枚「背景透明、只有圈线」的圆环，圈线取当前主题色，
 * 圈内 / 圈外各带一层同色阴影 —— 浅色底和深色底上都看得清。
 *
 * 尺寸 / 时长按设备档位走：全部在 styles/click-ripple.scss 里根据
 * <html data-device>（phone / tablet / desktop）与 data-short 定义，
 * 手机上圈更小、动画略快；JS 只负责「在哪个点、用什么颜色画」。
 *
 * 为什么监听 pointerdown 而不是 click：
 * click 要等指针抬起才触发，按下的那一瞬间没有任何反馈；pointerdown 在按下
 * 的同一帧就能画出来，与按钮自身的按下态同步。
 *
 * 输入类型：
 * 不要再按 pointerType 过滤 —— 手机上手指点按的 pointerdown 同样是主键
 * （button === 0），一旦只认 mouse / pen，触屏用户就完全看不到效果。
 * 只有不支持 PointerEvent 的老浏览器才退回 mousedown / touchstart 两套监听。
 *
 * 主题色跟随：
 * 主题色阶由 composables/use-theme.ts 写在 <html> 的行内 CSS 变量上，
 * 这里每次点击现读 --theme-color-strong（日间压深 / 夜间提亮的可读描边色；
 * 种子色 --theme-color 在浅色底上几乎看不见），再写成这枚波纹自己的
 * --click-ripple-color / --click-ripple-rgb。用户改主题色后，下一次点击
 * 立即用新颜色，不需要重启或刷新。
 *
 * 性能：
 * 点击是低频交互；每枚波纹只创建一个 span + 一条 CSS 动画（transform / opacity
 * 走合成层），animationend 即移除；同时存在的波纹有上限，防止连点或脚本触发
 * 把 DOM 越堆越多。
 *
 * 可访问性：
 * 系统开启「减少动态效果」时缩小扩散幅度并缩短时长（样式见
 * styles/click-ripple.scss 的 @media），但保留「小圈 → 整圈」的过程，
 * 不会退化成凭空出现一个圈；覆盖层与波纹都带 aria-hidden、
 * pointer-events: none，不影响点击和读屏。
 */

import { DEFAULT_THEME } from "@/config";
import { normalizeHexColor } from "@/composables/theme-palette";

/** 覆盖层 id：懒创建，第一次点击才挂到 body。 */
const LAYER_ID = "click-ripple-layer";
/** 单枚波纹的类名，具体皮肤见 styles/click-ripple.scss。 */
const RIPPLE_CLASS = "click-ripple";
/**
 * 桌面档最长动画时长；只用于兜底清理计时。
 * 实际时长由 styles/click-ripple.scss 按设备档位写进 --click-ripple-duration。
 */
const RIPPLE_MAX_DURATION_MS = 560;
/** 兜底移除时间：animationend 没触发时（例如动画被浏览器丢弃）也不留下垃圾节点。 */
const RIPPLE_CLEANUP_DELAY_MS = RIPPLE_MAX_DURATION_MS + 1000;
/** 同时存在的波纹上限（连点 / 脚本触发）：超出时提前结束最早的一枚。 */
const MAX_ACTIVE_RIPPLES = 12;
/** 主题色变量全都取不到时的兜底色（与 config 的默认主题色一致）。 */
const FALLBACK_RING_COLOR = DEFAULT_THEME;
/**
 * 旧内核的 touchstart → 兼容性 mousedown 去重窗口：真实设备上这段间隔约
 * 300ms，留到 700ms 以覆盖慢设备；只有走 mousedown/touchstart 兜底分支时才用。
 */
const TOUCH_MOUSE_DEDUP_MS = 700;

let initialized = false;
let layer: HTMLElement | null = null;
/** 是否用 pointerdown 监听；false 表示走了 mousedown / touchstart 的兜底分支。 */
let pointerEventsBound = false;
/** 最近一次 touchstart 的时间戳：只用于旧内核兜底分支里抑制随后的兼容性 mousedown。 */
let lastTouchStartAt = 0;
/** 已插入的波纹 → 提前 / 正常结束它的清理函数（Map 的插入顺序就是「最早一枚」）。 */
const activeRipples = new Map<HTMLElement, () => void>();

/** 覆盖层：铺满视口、不拦截指针事件，只负责给波纹定位。 */
function ensureLayer(): HTMLElement {
  if (layer && layer.isConnected) return layer;

  const existing = document.getElementById(LAYER_ID);
  if (existing) {
    layer = existing;
    return layer;
  }

  const element = document.createElement("div");
  element.id = LAYER_ID;
  element.className = "click-ripple-layer";
  element.setAttribute("aria-hidden", "true");
  // 尺寸 / 时长不在这里写：它们由 CSS 按 <html data-device> / data-short 分档，
  // 内联变量会盖掉分档结果，所以只让覆盖层负责定位。
  document.body.appendChild(element);
  layer = element;
  return element;
}

/** hex → "r, g, b"，供 rgba(var(--click-ripple-rgb), α) 使用。 */
function hexToRgbTriplet(hex: string): string {
  const normalized = normalizeHexColor(hex) ?? FALLBACK_RING_COLOR;
  const value = normalized.slice(1);
  return [0, 2, 4]
    .map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
    .join(", ");
}

/** 圈线取色候选：按「可读性优先」的顺序排列。 */
const RING_COLOR_VARIABLES = [
  "--theme-color-strong",
  "--theme-primary",
  "--theme-color",
] as const;

/**
 * 读取当前主题色（每枚波纹单独读一次）。
 *
 * 为什么圈线用 --theme-color-strong 而不是种子色 --theme-color：
 * 种子色是给装饰底 / 渐变用的，浅色主题下默认种子 #e3c0df 在 #f3f4f6 底上
 * 对比度只有约 1.5:1，2px 描边几乎看不见。--theme-color-strong 是同一色相按
 * 当前明暗压深 / 提亮的「描边 / 强调」变体（theme-colors.scss 里就标注为
 * 焦点 / 边框用途）；深色主题下它又约等于种子色。因此任何主题下圈线都是
 * 用户选的那个色系、且深浅底上都看得清。
 *
 * 取色优先级：--theme-color-strong → --theme-primary（兼容变量）→
 * --theme-color（种子色）→ 默认种子色，逐级回退到总能拿到一个 hex。
 *
 * 先读 <html> 的行内变量（use-theme 会把整套色阶写在 style 上），命中时
 * 不用 getComputedStyle —— 避免每次点击都触发一次样式重算；只有首帧 /
 * 初始化异常时才回退到 computed value。
 */
function resolveRingColor(): string {
  const root = document.documentElement;
  for (const name of RING_COLOR_VARIABLES) {
    const normalized = normalizeHexColor(root.style.getPropertyValue(name));
    if (normalized) return normalized;
  }

  const computed = getComputedStyle(root);
  for (const name of RING_COLOR_VARIABLES) {
    const normalized = normalizeHexColor(computed.getPropertyValue(name));
    if (normalized) return normalized;
  }
  return normalizeHexColor(FALLBACK_RING_COLOR) ?? FALLBACK_RING_COLOR;
}

/** 在视口坐标 (x, y) 处生成一枚波纹。 */
function spawnRipple(x: number, y: number): void {
  const layerElement = ensureLayer();
  const ripple = document.createElement("span");
  ripple.className = RIPPLE_CLASS;
  ripple.setAttribute("aria-hidden", "true");

  const ringColor = resolveRingColor();
  ripple.style.setProperty("--click-ripple-color", ringColor);
  ripple.style.setProperty("--click-ripple-rgb", hexToRgbTriplet(ringColor));
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;

  let removed = false;
  const cleanup = (): void => {
    if (removed) return;
    removed = true;
    window.clearTimeout(fallbackTimer);
    ripple.remove();
    activeRipples.delete(ripple);
  };
  const fallbackTimer = window.setTimeout(cleanup, RIPPLE_CLEANUP_DELAY_MS);
  ripple.addEventListener("animationend", cleanup, { once: true });

  activeRipples.set(ripple, cleanup);
  layerElement.appendChild(ripple);

  // 超出上限时先结束最早的一枚，保证 DOM 规模有界
  while (activeRipples.size > MAX_ACTIVE_RIPPLES) {
    const oldest = activeRipples.entries().next().value;
    if (!oldest) break;
    oldest[1]();
  }
}

function handlePointerDown(event: PointerEvent): void {
  // 只响应主键 / 主触点：右键菜单、中键拖拽不画波纹。
  // 触屏上手指按下的 pointerdown 同样是 button === 0（主触点）；
  // 极个别内核会把触摸的 button 报成 -1，这里也按主触点放行，
  // 避免再出现「手机上点了没反应」。
  if (event.button !== 0 && event.pointerType !== "touch") return;
  spawnRipple(event.clientX, event.clientY);
}

/** 没有 PointerEvent 的老浏览器（部分安卓 WebView / 旧内核）的鼠标兜底。 */
function handleMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;
  // 老内核上一次手指点按会先触发 touchstart，约 300ms 后再补发一次兼容性
  // mousedown（用来模拟 click）。不去重的话同一次点按会叠出两枚波纹。
  if (Date.now() - lastTouchStartAt < TOUCH_MOUSE_DEDUP_MS) return;
  spawnRipple(event.clientX, event.clientY);
}

/** 没有 PointerEvent 的老浏览器上的触屏兜底。 */
function handleTouchStart(event: TouchEvent): void {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) return;
  lastTouchStartAt = Date.now();
  spawnRipple(touch.clientX, touch.clientY);
}

/**
 * 初始化全局点击波纹。幂等，重复调用不会重复挂监听。
 * 在 main.ts 里于 app.mount() 之前调用一次即可。
 */
export function setupClickRipple(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // 捕获阶段监听：即便业务组件 stopPropagation，点击位置也应该有反馈。
  // 现代浏览器统一走 pointerdown（鼠标 / 手指 / 笔都覆盖）；
  // 只有完全没有 PointerEvent 的老环境才退回两套旧事件。
  pointerEventsBound = typeof window.PointerEvent === "function";
  if (pointerEventsBound) {
    window.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
      passive: true,
    });
  } else {
    window.addEventListener("mousedown", handleMouseDown, {
      capture: true,
      passive: true,
    });
    window.addEventListener("touchstart", handleTouchStart, {
      capture: true,
      passive: true,
    });
  }
}

/**
 * 销毁点击波纹（测试 / 热更新场景使用，应用运行时不需要调用）。
 */
export function destroyClickRipple(): void {
  if (!initialized) return;
  initialized = false;

  if (pointerEventsBound) {
    window.removeEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });
  } else {
    window.removeEventListener("mousedown", handleMouseDown, {
      capture: true,
    });
    window.removeEventListener("touchstart", handleTouchStart, {
      capture: true,
    });
  }
  pointerEventsBound = false;
  lastTouchStartAt = 0;

  for (const cleanup of [...activeRipples.values()]) {
    cleanup();
  }
  layer?.remove();
  layer = null;
}

// HMR：模块被替换时先摘掉旧监听 / 旧波纹，避免热更新后叠出两层效果
// （与 libs/mikuCursor/index.ts 的处理保持一致）
if (import.meta.hot) {
  import.meta.hot.dispose(destroyClickRipple);
}
