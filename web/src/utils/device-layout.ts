/**
 * 视口 / 设备判定（纯逻辑）。
 *
 * 这个模块刻意不依赖 Vue、也不在顶层访问 DOM：
 * 判定规则可以被单测直接调用，避免「规则对不对」只能靠肉眼看浏览器。
 * DOM 读写与响应式包装见 composables/use-device-layout.ts。
 *
 * ## 判定规则
 *
 * **横屏一律走桌面布局；竖屏按宽度决定。**
 *
 * | 视口 | 尺寸 | 方向 | 布局 |
 * | --- | --- | --- | --- |
 * | 手机竖屏 iPhone 15 | 393x852 | 竖屏 | 手机 |
 * | 手机横屏 iPhone 15 | 852x393 | 横屏 | **桌面** |
 * | 竖屏平板 iPad | 820x1180 | 竖屏 | 桌面（宽 820 > 768） |
 * | 桌面窗口被拉窄 | 700x1200 | 竖屏 | 手机（宽 700 <= 768） |
 * | 被拖扁的电脑窗口 | 700x400 | 横屏 | 桌面 |
 *
 * 展开成两条：
 *
 * 1. **横屏（`width > height`）→ 桌面**。横屏后横向空间足够放下桌面那套结构
 *    （例如聊天的 300px 会话列表 + 消息面板），继续用手机的单栏结构反而浪费宽度。
 * 2. **竖屏 → 宽度判定**：`width <= 768` 走手机布局，否则桌面。
 *    竖屏下「宽度满足手机像素宽度」才当手机 —— 820x1180 的竖屏平板虽然「高 > 宽」，
 *    但宽度不是手机像素宽度，仍然走桌面布局。
 *
 * 手机横屏（852x393）旧实现会判成桌面，属于**巧合正确**；
 * 但 iPhone SE 横屏（667x375）与它形状一致却是错的，所以判定必须看方向而不是只看宽度。
 *
 * 注意：竖屏且高小于 480 无法与横屏共存（width <= height <= 480 与 width > height 矛盾），
 * 所以「横屏优先」这条规则不会和竖屏规则打架。
 *
 * ## `layout` 与 `isPhone` 的区别
 *
 * `layout` 是**布局模式**（该用哪套结构），`isPhone` 是**几何上是不是手机**。
 * 横屏手机 `layout: desktop` 但 `isPhone: true` —— 后者只用于埋点诊断与
 * 「与输入方式相关」的微调，不参与布局切换。
 *
 * ## `tier`：「三档设备」判定（聊天页用）
 *
 * 上面那套 `layout` 只有两档（手机 / 桌面），够用但不精细：
 * 竖屏平板（768x1024）和手机竖屏一样落到 `mobile`，
 * 而聊天页要的是「手机单栏、平板双栏、大屏电脑常规密度」三档。
 *
 * 所以额外提供一条**以宽度为主、宽高比为辅**的档位轴，切成三档
 * （宽度分档 + 一条「窄但够扁 → 双栏」的例外）：
 *
 * | 视口 | 宽度 | tier | 聊天页结构 | 控件/间距 |
 * | --- | --- | --- | --- | --- |
 * | 手机竖屏 iPhone 15 | 393 | `phone` | 单栏（列表 / 聊天二选一） | 24px / 6px |
 * | 手机竖屏 iPhone 15 PM | 430 | `phone` | 单栏 | 24px / 6px |
 * | 折叠屏展开竖屏 | 480 | `phone` | 单栏 | 24px / 6px |
 * | 小屏横屏 480x320（宽扁） | 480 | `tablet` | 双栏 | 24px / 6px |
 * | 手机横屏 iPhone SE（宽扁） | 568 | `tablet` | 双栏 | 24px / 6px |
 * | 横屏手机 iPhone 15 | 852 | `tablet` | 双栏 | 24px / 6px |
 * | 竖屏平板 iPad mini | 768 | `tablet` | 双栏 | 24px / 6px |
 * | 竖屏平板 iPad | 820 | `tablet` | 双栏 | 24px / 6px |
 * | 横屏平板 iPad | 1180 | `tablet` | 双栏 | 24px / 6px |
 * | 笔记本 1366x768 | 1366 | `desktop` | 双栏 | 32px / 12px |
 * | 桌面 1920x1080 | 1920 | `desktop` | 双栏 | 32px / 12px |
 *
 * 三条边界：
 *
 * 1. `width > pcWidth(1200)` → `desktop`（大屏电脑端，常规密度）。
 * 2. `width <= phoneMaxWidth(600)` → `phone`（单栏）。手机竖屏基本都在 600 以内；
 *    竖屏平板最窄的 iPad mini 也有 768，不会误判成手机。
 * 3. **宽扁小屏例外**：宽度虽在手机档，但 `宽/高 >= 1.5`（即 `> splitAspectRatio`）时
 *    按 `tablet`（双栏）处理 —— 屏幕再小，只要够扁，横向就放得下两栏，
 *    继续挤成单栏反而浪费宽度。手机横屏全在这一类：
 *
 *    - 480x320（宽/高 1.50）→ `tablet` 双栏
 *    - 568x320（1.78，iPhone SE 横屏）→ `tablet` 双栏
 *    - 852x393（2.17，iPhone 15 横屏）→ `tablet` 双栏
 *    - 500x360（1.39，4:3 附近的小窗口）→ `phone` 单栏
 *    - 393x852（0.46，竖屏手机）→ `phone` 单栏
 *
 * 其余 (600, 1200] 是 `tablet`：平板、横屏手机、以及被拖窄的桌面窗口 ——
 * 它们的共同点是「横向还放得下两栏，但没宽敞到用桌面那套大间距」。
 *
 * 为什么 tier 主要看宽度：`layout` 那条「横屏一律桌面」是为了**结构**不塌，
 * 而 tier 关心的是「横向空间够不够放两栏 / 够不够放大间距」，这件事由宽度决定；
 * 唯一的补丁就是「窄但够扁」—— 那时宽度不够、但宽度相对高度富余，双栏同样成立。
 */

/** 布局模式：组件据此切换「桌面结构 / 手机结构」。 */
export type LayoutMode = "mobile" | "desktop";

/** 设备档位（三档）：组件据此决定「单栏 / 双栏」与控件密度。 */
export type DeviceTier = "phone" | "tablet" | "desktop";

/** 屏幕方向。与 CSS 的 `(orientation: portrait)` 保持同一语义（height >= width 视为竖屏）。 */
export type ViewportOrientation = "portrait" | "landscape";

/**
 * 断点常量（CSS 像素）。
 * 必须与 web/src/styles/responsive-mixins.scss 中的 `$bp-*` 保持一致。
 */
export const DEVICE_LAYOUT_BREAKPOINTS = {
  /** 竖屏手机判定的宽度上限（仅用于 isPhone，不切换布局）。 */
  phonePortraitWidth: 480,
  /** 手机短边上限（横屏时即视口高度）。仅用于 isPhone。 */
  phoneShortSide: 480,
  /** 手机长边上限（横屏时即视口宽度）。仅用于 isPhone。 */
  phoneLongSide: 960,
  /** 竖屏下走手机布局的宽度上限；超过则桌面。 */
  narrowViewportWidth: 768,
  /**
   * 设备档位：手机宽度上限（`width <= 该值` 即 `tier: phone`）。
   *
   * 比 `narrowViewportWidth(768)` 更窄：768 是**布局结构**的分界（旧页面用），
   * 600 是**设备档位**的分界。平板最窄的 iPad mini 竖屏是 768，
   * 必须落在 tablet 档（双栏），不能被当成手机。
   */
  phoneMaxWidth: 600,
  /**
   * 设备档位：大屏电脑端的宽度下限（`width > 该值` 即 `tier: desktop`）。
   *
   * 1200 以下（平板 / 横屏手机 / 拖窄的桌面窗口）用 24px 控件 + 6px 间距：
   * 那个宽度下 32px 控件配 12px 间距会把两栏挤得很局促。
   */
  pcWidth: 1200,
  /**
   * 设备档位：宽扁小屏的宽高比阈值（`width > height * 该值` 即按双栏排）。
   *
   * 只对「宽度落在手机档（<= phoneMaxWidth）」的视口生效：屏幕再小，
   * 只要够扁（3:2 起，手机横屏都在 1.6~2.2），横向就放得下两栏。
   * 4:3 及更方的小窗口（500x360 = 1.39）仍然是单栏。
   *
   * 取值 1.499 是为了与 CSS 严格互补：`styles/responsive-mixins.scss` 里
   * `device-phone` 用 `max-aspect-ratio: 1.499`（含等号），这里用「大于」，
   * 两条判定刚好铺满、互不重叠（见 verify-device-layout.mjs 的全矩阵比对）。
   * 有效阈值即 3:2 —— 480x320 这种正好 1.5 的横屏手机落在双栏。
   */
  splitAspectRatio: 1.499,
  /**
   * 「小窗口」宽度上限。桌面结构要 ~1024px 才舒展，
   * 低于它即使仍是桌面**布局**，也该套用紧凑**密度**（移动端那套间距/字号）。
   */
  smallWindowWidth: 1024,
  /** 视口高度低于该值视为「过矮」，需要压缩纵向留白。 */
  compactHeight: 560,
  /** 键盘弹起判定阈值（px）。小于该值的差异视为地址栏变化，不算键盘。 */
  keyboardThreshold: 120,
} as const;

export interface ViewportInput {
  /** 布局视口宽度（documentElement.clientWidth）。 */
  width: number;
  /** 布局视口高度（documentElement.clientHeight）。不随软键盘变化。 */
  height: number;
  /** 是否触屏（粗指针）。 */
  isTouch: boolean;
  /**
   * 可视视口高度（window.visualViewport.height），随软键盘变化。
   * 缺省时按布局视口高度处理。
   */
  visualHeight?: number;
}

export interface DeviceLayout {
  /** 用于分类的布局视口宽度。 */
  width: number;
  /** 用于分类的布局视口高度。 */
  height: number;
  /** 键盘感知的可视视口高度，供 CSS `--app-h` 使用。 */
  visualHeight: number;
  /** 短边 = min(width, height)，即「竖着拿时的宽度」。 */
  shortSide: number;
  /** 长边 = max(width, height)。 */
  longSide: number;
  /** 宽高比 = width / height。 */
  aspectRatio: number;
  orientation: ViewportOrientation;
  /** 布局切换信号：mobile | desktop。 */
  layout: LayoutMode;
  isMobile: boolean;
  isDesktop: boolean;
  /**
   * 设备档位（三档，只按宽度判）：
   *   phone   宽 <= 600     —— 单栏 + 24px 控件 / 6px 间距
   *   tablet  600 < 宽 <= 1200 —— 双栏 + 24px 控件 / 6px 间距
   *   desktop 宽 > 1200     —— 双栏 + 常规密度（32px / 12px）
   * 与 `layout` 相互独立，见文件头注释。
   */
  tier: DeviceTier;
  /** `tier === "phone"`：该用单栏结构。 */
  isPhoneTier: boolean;
  /** `tier === "tablet"`：双栏 + 紧凑密度（平板 / 横屏手机 / 拖窄的窗口）。 */
  isTabletTier: boolean;
  /** `tier === "desktop"`：大屏电脑端，常规密度。 */
  isDesktopTier: boolean;
  /**
   * 「宽扁小屏」：宽度在手机档（<= 600），但宽/高 > 1.5（3:2）。
   * 这类视口（典型是手机横屏）会**破格走双栏**，所以 isPhoneTier 为 false。
   */
  isSmallLandscape: boolean;
  /**
   * 几何上是否手机（含横屏）。
   * 只用于埋点诊断与「与输入方式相关」的微调，**不参与布局切换** ——
   * 横屏手机是 `layout: desktop` 但 `isPhone: true`。
   */
  isPhone: boolean;
  /** 竖屏 且 宽度满足手机像素宽度（高 > 宽，且宽不是平板那么宽）。 */
  isPhonePortrait: boolean;
  /** 横屏 且 短边/长边都在手机范围内（852x393 命中）。 */
  isPhoneLandscape: boolean;
  /** 宽度 <= 768。注意：横屏时该标志为 true 也不走手机布局。 */
  isNarrowViewport: boolean;
  /** 视口过矮（横屏手机 / 分屏窗口），压缩纵向留白用。 */
  isShortViewport: boolean;
  /**
   * 小窗口：宽度 <= 1024 或 视口过矮。
   * 与布局模式**无关** —— 小窗口即使是桌面布局，密度也该按移动端那套收。
   */
  isSmallWindow: boolean;
  isTouch: boolean;
  /** 软键盘是否弹起（可视视口明显矮于布局视口）。 */
  isKeyboardOpen: boolean;
}

/**
 * 根据视口尺寸判定布局模式。纯函数，便于单测。
 */
export function classifyViewport(input: ViewportInput): DeviceLayout {
  const bp = DEVICE_LAYOUT_BREAKPOINTS;

  // 防御脏数据：0 会让宽高比变成 Infinity/NaN。
  const width = Math.max(1, Math.round(input.width) || 1);
  const height = Math.max(1, Math.round(input.height) || 1);
  const visualHeight = Math.max(
    1,
    Math.round(input.visualHeight ?? height) || height,
  );

  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const aspectRatio = width / height;

  // 与 CSS 的 (orientation: portrait) 一致：等高算竖屏。
  const orientation: ViewportOrientation =
    height >= width ? "portrait" : "landscape";

  const isPortrait = orientation === "portrait";

  // ── 几何上是不是手机（仅诊断/微调用，不参与布局切换）──
  const isPhonePortrait = isPortrait && width <= bp.phonePortraitWidth;
  const isPhoneLandscape =
    !isPortrait &&
    height <= bp.phoneShortSide &&
    width <= bp.phoneLongSide;
  // 短边够小且长边没超出手机横屏范围（覆盖 isPhoneLandscape，
  // 也覆盖「竖屏但很长」的机型，如 480x1024 折叠屏）。
  const hasPhoneSides =
    shortSide <= bp.phoneShortSide && longSide <= bp.phoneLongSide;
  const isPhone = isPhonePortrait || isPhoneLandscape || hasPhoneSides;

  // ── 布局切换 ──
  // 横屏一律桌面：横过来之后横向空间足够放下桌面结构，
  // 继续用手机单栏反而浪费宽度。竖屏才按宽度判定。
  const isNarrowViewport = width <= bp.narrowViewportWidth;
  const isMobile = isPortrait && isNarrowViewport;
  const isShortViewport = height <= bp.compactHeight;
  // 「小窗口」只看挤不挤，与横竖屏/布局结构无关
  const isSmallWindow = width <= bp.smallWindowWidth || isShortViewport;

  // ── 设备档位（三档）──
  // 与上面的 isMobile 是两条独立的轴：这里关心「横向空间够不够放两栏 / 够不够放大间距」。
  // 宽度是主判据；唯一的补充是「窄而够扁」的小屏 —— 宽度不够，但相对高度富余，
  // 双栏同样成立（手机横屏 480x320、568x320 就是这一类）。
  const isNarrowWidth = width <= bp.phoneMaxWidth;
  const isSmallLandscape = isNarrowWidth && aspectRatio > bp.splitAspectRatio;
  const isPhoneTier = isNarrowWidth && !isSmallLandscape;
  const isDesktopTier = width > bp.pcWidth;
  const isTabletTier = !isPhoneTier && !isDesktopTier;
  const tier: DeviceTier = isPhoneTier
    ? "phone"
    : isTabletTier
      ? "tablet"
      : "desktop";

  return {
    width,
    height,
    visualHeight,
    shortSide,
    longSide,
    aspectRatio,
    orientation,
    layout: isMobile ? "mobile" : "desktop",
    isMobile,
    isDesktop: !isMobile,
    tier,
    isPhoneTier,
    isTabletTier,
    isDesktopTier,
    isSmallLandscape,
    isPhone,
    isPhonePortrait,
    isPhoneLandscape,
    isNarrowViewport,
    isShortViewport,
    isSmallWindow,
    isTouch: input.isTouch,
    isKeyboardOpen: height - visualHeight > bp.keyboardThreshold,
  };
}

/** 当前是否触屏设备（粗指针）。 */
export function detectCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

/**
 * 读取真实视口尺寸。
 *
 * - 分类用**布局视口**（clientWidth/clientHeight）：它不会被软键盘压缩，
 *   否则手机上弹出键盘会把竖屏误判成横屏。
 * - `--app-h` 用**可视视口**（visualViewport.height）：它随键盘变化，
 *   这样聊天输入框不会被键盘挡住。
 * - 双指缩放会让 visualViewport.height 变矮，此时回退到布局视口，避免误判键盘。
 */
export function readViewportInput(): ViewportInput {
  const doc = document.documentElement;
  const width = Math.round(doc.clientWidth || window.innerWidth || 0);
  const height = Math.round(doc.clientHeight || window.innerHeight || 0);

  const viewport = window.visualViewport;
  let visualHeight = height;
  if (viewport && viewport.scale <= 1.01) {
    visualHeight = Math.round(viewport.height) || height;
  }

  return {
    width,
    height,
    isTouch: detectCoarsePointer(),
    visualHeight,
  };
}
