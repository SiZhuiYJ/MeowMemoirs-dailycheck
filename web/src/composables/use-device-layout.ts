/**
 * 设备布局（单例）。
 *
 * 把 utils/device-layout.ts 的判定结果：
 *   1. 同步到 `<html>` 的 data-* 属性 —— 供 CSS 选择器使用；
 *   2. 同步成 CSS 变量（--app-w / --app-h / ...） —— 供尺寸计算使用；
 *   3. 暴露成响应式 ref —— 供组件按布局模式切换结构。
 *
 * 这样「桌面结构 / 手机结构」在 JS 与 CSS 两侧用的是**同一个判定结果**，
 * 不会再出现「JS 认为手机、CSS 认为桌面」的半吊子状态。
 *
 * 为什么可以依赖 JS 写属性：本项目是纯 SPA，没有 JS 连页面都渲染不出来，
 * 而 install 在 app.mount() 之前执行，所以首帧之前属性就已经就位，不会有闪烁。
 *
 * CSS 侧的断点常量在 styles/responsive-mixins.scss，改规则要两个文件一起改；
 * tools/dev-verify/verify-device-layout.mjs 会校验两边是否一致。
 */
import { computed, shallowRef, type ComputedRef, type Ref } from "vue";
import {
  classifyViewport,
  readViewportInput,
  type DeviceLayout,
  type DeviceTier,
  type LayoutMode,
  type ViewportOrientation,
} from "@/utils/device-layout";

/** 写到 <html> 上的属性名。 */
export const DEVICE_LAYOUT_ATTRIBUTES = {
  layout: "data-layout",
  orientation: "data-orientation",
  phone: "data-phone",
  short: "data-short",
  // 「小窗口」：宽 <= 1024 或 视口过矮。与 data-layout 无关 ——
  // 小窗口即使是桌面布局，密度也该按移动端那套收。
  compact: "data-compact",
  // 设备档位（三档）：phone / tablet / desktop。
  // 与 data-layout 是两条轴：data-layout 管结构（两档），data-device 管档位（三档）。
  device: "data-device",
  touch: "data-touch",
  keyboard: "data-keyboard",
} as const;

/** 写到 <html> 上的 CSS 变量名。 */
export const DEVICE_LAYOUT_CSS_VARS = {
  width: "--app-w",
  height: "--app-h",
  shortSide: "--app-short-side",
  longSide: "--app-long-side",
  aspect: "--app-aspect",
  keyboard: "--app-kb",
} as const;

export interface DeviceLayoutApi {
  /** 完整判定结果。 */
  layout: Readonly<Ref<DeviceLayout>>;
  /** 布局模式：mobile | desktop。 */
  mode: ComputedRef<LayoutMode>;
  orientation: ComputedRef<ViewportOrientation>;
  width: ComputedRef<number>;
  height: ComputedRef<number>;
  /** 是否应该使用手机那套结构（含窄窗口兜底）。 */
  isMobile: ComputedRef<boolean>;
  isDesktop: ComputedRef<boolean>;
  /**
   * 设备档位（三档，只看宽度）：phone / tablet / desktop。
   * 与 isMobile 是两条独立的轴，聊天页用它切「单栏 / 双栏 / 大屏密度」。
   */
  tier: ComputedRef<DeviceTier>;
  /** 手机档（宽 <= 600）：单栏结构。 */
  isPhoneTier: ComputedRef<boolean>;
  /** 平板档（600 < 宽 <= 1200）：双栏 + 紧凑密度。 */
  isTabletTier: ComputedRef<boolean>;
  /** 大屏电脑档（宽 > 1200）：双栏 + 常规密度。 */
  isDesktopTier: ComputedRef<boolean>;
  /** 几何上是否手机（横屏也算）。与 isMobile 的区别见 device-layout.ts。 */
  isPhone: ComputedRef<boolean>;
  /** 竖屏手机：高 > 宽 且 宽度满足手机像素宽度。 */
  isPhonePortrait: ComputedRef<boolean>;
  /** 横屏手机：宽度可能超过 768，但高度是手机级别的矮。 */
  isPhoneLandscape: ComputedRef<boolean>;
  /** 视口过矮，需要压缩纵向留白。 */
  isShortViewport: ComputedRef<boolean>;
  /** 小窗口（宽 <= 1024 或 过矮）：即使桌面布局也该用紧凑密度。 */
  isSmallWindow: ComputedRef<boolean>;
  isTouch: ComputedRef<boolean>;
  isKeyboardOpen: ComputedRef<boolean>;
}

let layoutRef: Ref<DeviceLayout> | null = null;
let api: DeviceLayoutApi | null = null;
let teardown: (() => void) | null = null;
let frame: number | null = null;
let orientationTimer: ReturnType<typeof setTimeout> | null = null;

function safeSnapshot(): DeviceLayout {
  if (typeof window === "undefined" || typeof document === "undefined") {
    // 非浏览器环境（构建期/测试）给一份桌面默认值，避免报错。
    return classifyViewport({ width: 1440, height: 900, isTouch: false });
  }
  return classifyViewport(readViewportInput());
}

/** 把判定结果写到 <html>，CSS 由此拿到和 JS 完全一致的状态。 */
function applyToDocument(next: DeviceLayout): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;

  root.setAttribute(DEVICE_LAYOUT_ATTRIBUTES.layout, next.layout);
  root.setAttribute(DEVICE_LAYOUT_ATTRIBUTES.orientation, next.orientation);
  root.setAttribute(DEVICE_LAYOUT_ATTRIBUTES.phone, next.isPhone ? "true" : "false");
  root.setAttribute(DEVICE_LAYOUT_ATTRIBUTES.short, next.isShortViewport ? "true" : "false");
  root.setAttribute(
    DEVICE_LAYOUT_ATTRIBUTES.compact,
    next.isSmallWindow ? "true" : "false",
  );
  root.setAttribute(DEVICE_LAYOUT_ATTRIBUTES.device, next.tier);
  root.setAttribute(DEVICE_LAYOUT_ATTRIBUTES.touch, next.isTouch ? "true" : "false");
  root.setAttribute(
    DEVICE_LAYOUT_ATTRIBUTES.keyboard,
    next.isKeyboardOpen ? "true" : "false",
  );

  const style = root.style;
  style.setProperty(DEVICE_LAYOUT_CSS_VARS.width, next.width + "px");
  // --app-h 用「键盘感知」的可视高度：软键盘弹起时它变小，
  // 于是固定高度的外壳会跟着收缩，输入框不会被键盘盖住。
  style.setProperty(DEVICE_LAYOUT_CSS_VARS.height, next.visualHeight + "px");
  style.setProperty(DEVICE_LAYOUT_CSS_VARS.shortSide, next.shortSide + "px");
  style.setProperty(DEVICE_LAYOUT_CSS_VARS.longSide, next.longSide + "px");
  style.setProperty(DEVICE_LAYOUT_CSS_VARS.aspect, String(next.aspectRatio));
  style.setProperty(
    DEVICE_LAYOUT_CSS_VARS.keyboard,
    Math.max(0, next.height - next.visualHeight) + "px",
  );
}

function sync(): void {
  if (!layoutRef) return;
  const next = safeSnapshot();
  const prev = layoutRef.value;
  // 尺寸没变就不写 DOM，避免无谓的样式重算与响应式触发。
  if (
    prev &&
    prev.width === next.width &&
    prev.visualHeight === next.visualHeight &&
    prev.layout === next.layout &&
    prev.isTouch === next.isTouch
  ) {
    return;
  }
  layoutRef.value = next;
  applyToDocument(next);
}

/** rAF 节流：缩放/旋转时 resize 会连发很多次。 */
function schedule(): void {
  if (typeof window === "undefined") return;
  if (frame !== null) return;
  frame = window.requestAnimationFrame(() => {
    frame = null;
    sync();
  });
}

/**
 * 旋转时浏览器上报的尺寸常常还是旧的，所以补一次延迟同步。
 * iOS Safari 上尤其明显。
 */
function scheduleAfterOrientationChange(): void {
  schedule();
  if (orientationTimer !== null) clearTimeout(orientationTimer);
  orientationTimer = setTimeout(() => {
    orientationTimer = null;
    sync();
  }, 160);
}

function bindListeners(): () => void {
  const coarseQuery = window.matchMedia("(hover: none) and (pointer: coarse)");
  const viewport = window.visualViewport;

  const onResize = () => schedule();
  const onOrientation = () => scheduleAfterOrientationChange();

  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("orientationchange", onOrientation, { passive: true });
  // 地址栏折叠 / 软键盘弹起只体现在 visualViewport 上，不会触发 window.resize
  viewport?.addEventListener("resize", onResize, { passive: true });
  viewport?.addEventListener("scroll", onResize, { passive: true });
  coarseQuery.addEventListener("change", onResize);
  window.screen?.orientation?.addEventListener("change", onOrientation);

  return () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onOrientation);
    viewport?.removeEventListener("resize", onResize);
    viewport?.removeEventListener("scroll", onResize);
    coarseQuery.removeEventListener("change", onResize);
    window.screen?.orientation?.removeEventListener("change", onOrientation);
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    if (orientationTimer !== null) clearTimeout(orientationTimer);
    orientationTimer = null;
  };
}

function createApi(ref: Ref<DeviceLayout>): DeviceLayoutApi {
  return {
    layout: ref,
    mode: computed(() => ref.value.layout),
    orientation: computed(() => ref.value.orientation),
    width: computed(() => ref.value.width),
    height: computed(() => ref.value.height),
    isMobile: computed(() => ref.value.isMobile),
    isDesktop: computed(() => ref.value.isDesktop),
    tier: computed(() => ref.value.tier),
    isPhoneTier: computed(() => ref.value.isPhoneTier),
    isTabletTier: computed(() => ref.value.isTabletTier),
    isDesktopTier: computed(() => ref.value.isDesktopTier),
    isPhone: computed(() => ref.value.isPhone),
    isPhonePortrait: computed(() => ref.value.isPhonePortrait),
    isPhoneLandscape: computed(() => ref.value.isPhoneLandscape),
    isShortViewport: computed(() => ref.value.isShortViewport),
    isSmallWindow: computed(() => ref.value.isSmallWindow),
    isTouch: computed(() => ref.value.isTouch),
    isKeyboardOpen: computed(() => ref.value.isKeyboardOpen),
  };
}

/**
 * 启动设备布局监听（幂等）。
 * 必须在 app.mount() 之前调用一次，保证首帧 CSS 选择器就能命中。
 */
export function installDeviceLayout(): Ref<DeviceLayout> {
  if (layoutRef) return layoutRef;

  const ref = shallowRef<DeviceLayout>(safeSnapshot());
  layoutRef = ref;
  api = createApi(ref);

  if (typeof window !== "undefined") {
    // 先写 DOM 再监听：避免监听回调早于首次属性写入。
    applyToDocument(ref.value);
    teardown = bindListeners();
  }

  return ref;
}

/** 读取响应式判定结果，组件里用它做结构切换。 */
export function useDeviceLayout(): DeviceLayoutApi {
  if (!layoutRef || !api) installDeviceLayout();
  return api as DeviceLayoutApi;
}

/** 手动重新测量一次（一般不需要，旋转/缩放已自动处理）。 */
export function refreshDeviceLayout(): void {
  sync();
}

/** 停止监听。仅用于测试或卸载整个应用。 */
export function disposeDeviceLayout(): void {
  teardown?.();
  teardown = null;
  layoutRef = null;
  api = null;
}
