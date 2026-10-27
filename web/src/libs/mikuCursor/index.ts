/**
 * Miku 动画光标（虚拟光标）。
 *
 * ⚠️ 为什么不用 CSS `cursor` 关键帧：浏览器只有在鼠标移动 / 命中测试时才重新应用光标，
 * 鼠标静止时 CSS 动画改出来的 cursor 帧不会被刷新 —— 表现就是「鼠标不动光标不动，
 * 动一下跳一帧」。所以这里改成**跟随指针的 DOM 覆盖层**：隐藏原生光标，用 canvas
 * 画当前帧，帧序列 / 时长 / 准星全部来自构建期生成的数据。
 *
 * 加载仍然分两阶段：
 *   1. 启动：只加载每只光标的**首帧**，覆盖层立即可用；
 *   2. 空闲：逐只光标补齐剩余帧，加载完开始逐帧播放。
 *
 * 光标类型由 CSS 自定义属性 `--miku-cursor` 决定：给每类元素挂一条同名规则，
 * 覆盖层读取「指针所在元素」的 computed value，等价于原生的 cursor 级联
 * （disabled / help 这些状态、规则顺序都照旧）。
 */
import { MIKU_CURSOR_VERSION, MIKU_CURSORS, type MikuCursorKey } from "./cursors.generated";

/**
 * 一条「选择器 → 光标」规则。
 *
 * 光标本身在构建期就被拆成了 32×32 的帧图（scripts/build-miku-cursors.mjs），
 * 这里只负责说明「哪些元素用哪只光标」；准星和时长都在生成的数据里。
 */
type CursorRule = {
  /** `cursors.generated.ts` 里的光标 key */
  cursor: MikuCursorKey;
  selectors: readonly string[];
};

type WindowWithOptionalIdleCallback = {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * 帧图放在 `public/miku-cursors/`：构建时原样拷到站点根目录，不参与打包。
 *
 * 为什么不放 src/assets 用 import.meta.glob 拿 URL：146 张帧图会变成 146 个模块
 * 请求（dev 启动时全部加载）或 146 个 chunk（build），而我们只需要「用到哪张才
 * 请求哪张」。代价是没有内容 hash，所以用生成时的版本号 `?v=` 当缓存戳。
 */
const FRAME_BASE = `${import.meta.env.BASE_URL}miku-cursors/`;

function frameUrl(file: string) {
  return `${FRAME_BASE}${file}?v=${MIKU_CURSOR_VERSION}`;
}

const nativeInteractiveSelectors = [
  "a[href]",
  "button:not(:disabled)",
  "[role=\"button\"]:not([aria-disabled=\"true\"])",
  "[type=\"button\"]:not(:disabled)",
  "[type=\"submit\"]:not(:disabled)",
  "[type=\"reset\"]:not(:disabled)",
  "[data-cursor=\"pointer\"]",
  ".cursor-pointer",
  ".ink",
] as const;

/**
 * 应用内「整块可点」、但不是 `<button>`/`<a>` 的自定义元素。
 *
 * 为什么要显式登记：光标类型靠 `--miku-cursor` 自定义属性级联，没登记的元素会
 * 一直继承 html 上的 `normal-select` —— 明明是整块可点，指针却还是普通箭头。
 * （以前的 CSS cursor 方案里，这些元素还会因为自己写了 `cursor: pointer` 掉回
 * 系统手型；现在覆盖层只认这个属性。）
 *
 * 以后新增「整块可点」的自定义元素，把选择器补到这里；`<button>` / `a[href]`
 * 已经由上面的原生列表覆盖，不用重复登记。
 */
const appInteractiveSelectors = [
  // 会话列表项：li 整行可点（见 features/chat/style/index.scss 的 .conversation-list li）
  ".conversation-item",
  // 文件消息卡片：图片 / 视频 / 音频 / 文档共用这个根节点，整块可点打开详情。
  // 上传中不登记（FileMessage.vue 里是禁用态），会回退到继承的 normal 箭头。
  ".file-message:not(.uploading)",
  // 头像跳转：ProgressiveAvatar 的根节点是 div，只靠 CSS 给的手型
  ".member-avatar-link",
  ".search-result-avatar-link",
  ".blacklist-avatar",
  ".friend-request-avatar",
] as const;

const elementPlusInteractiveSelectors = [
  ".el-anchor__link",
  ".el-alert__close-btn",
  ".el-backtop",
  ".el-breadcrumb__inner.is-link",
  ".el-button:not(.is-disabled)",
  ".el-calendar-day",
  ".el-carousel__arrow",
  ".el-carousel__button",
  ".el-carousel__indicator",
  ".el-checkbox:not(.is-disabled)",
  ".el-checkbox-button:not(.is-disabled)",
  ".el-checkbox-button__inner",
  ".el-checkbox__input:not(.is-disabled)",
  ".el-collapse-item__header:not(.is-disabled)",
  ".el-dialog__headerbtn",
  ".el-drawer__close-btn",
  ".el-dropdown",
  ".el-dropdown-menu__item:not(.is-disabled)",
  ".el-image__preview",
  ".el-image-viewer__btn",
  ".el-image-viewer__close",
  ".el-input__clear",
  ".el-input__password",
  ".el-input-number__decrease:not(.is-disabled)",
  ".el-input-number__increase:not(.is-disabled)",
  ".el-link:not(.is-disabled)",
  ".el-menu-item:not(.is-disabled)",
  ".el-message__closeBtn",
  ".el-notification__closeBtn",
  ".el-option:not(.is-disabled)",
  ".el-page-header__left",
  ".el-pager li:not(.is-disabled)",
  ".el-pagination button:not(:disabled)",
  ".el-picker-panel__icon-btn:not(.is-disabled)",
  ".el-radio:not(.is-disabled)",
  ".el-radio-button:not(.is-disabled)",
  ".el-radio-button__inner",
  ".el-radio__input:not(.is-disabled)",
  ".el-rate__item",
  ".el-scrollbar__thumb",
  ".el-select:not(.is-disabled)",
  ".el-select-dropdown__item:not(.is-disabled)",
  ".el-select__caret",
  ".el-select__wrapper:not(.is-disabled)",
  ".el-sub-menu__title:not(.is-disabled)",
  ".el-switch:not(.is-disabled)",
  ".el-switch__core",
  ".el-table th.is-sortable",
  ".el-table__column-filter-trigger",
  ".el-table__expand-icon",
  ".el-table-filter__bottom button:not(:disabled)",
  ".el-table-filter__list-item:not(.is-disabled)",
  ".el-tabs__item:not(.is-disabled)",
  ".el-tabs__new-tab",
  ".el-tag__close",
  ".el-time-panel__btn:not(.is-disabled)",
  ".el-time-spinner__item:not(.is-disabled)",
  ".el-tree-node__content",
  ".el-upload",
  ".el-upload-dragger",
  ".el-upload-list__item-actions",
  ".el-year-table td:not(.disabled) .cell",
  ".el-month-table td:not(.disabled) .cell",
  ".el-date-table td.available .el-date-table-cell",
  ".el-date-table td.today .el-date-table-cell",
] as const;

const textSelectors = [
  "input:not([type]):not(:disabled)",
  "input[type=\"email\"]:not(:disabled)",
  "input[type=\"number\"]:not(:disabled)",
  "input[type=\"password\"]:not(:disabled)",
  "input[type=\"search\"]:not(:disabled)",
  "input[type=\"tel\"]:not(:disabled)",
  "input[type=\"text\"]:not(:disabled)",
  "input[type=\"url\"]:not(:disabled)",
  "textarea:not(:disabled)",
  "[contenteditable=\"\"]",
  "[contenteditable=\"true\"]",
  "[contenteditable=\"plaintext-only\"]",
  ".el-autocomplete .el-input__inner:not(:disabled)",
  ".el-input:not(.is-disabled) .el-input__inner:not(:disabled)",
  ".el-input:not(.is-disabled) .el-input__wrapper",
  ".el-mention .el-input__inner:not(:disabled)",
  ".el-pagination__editor .el-input__inner:not(:disabled)",
  ".el-select__input",
  ".el-textarea:not(.is-disabled) .el-textarea__inner:not(:disabled)",
  ".CodeMirror-code",
  ".cm-content",
] as const;

const disabledSelectors = [
  "button:disabled",
  "input:disabled",
  "select:disabled",
  "textarea:disabled",
  "[aria-disabled=\"true\"]",
  "[data-cursor=\"disabled\"]",
  ".cursor-not-allowed",
  ".is-disabled",
  ".is-disabled *",
  ".el-button.is-disabled",
  ".el-cascader.is-disabled",
  ".el-checkbox.is-disabled",
  ".el-checkbox-button.is-disabled",
  ".el-collapse-item.is-disabled .el-collapse-item__header",
  ".el-date-editor.is-disabled",
  ".el-date-table td.disabled",
  ".el-dropdown-menu__item.is-disabled",
  ".el-input.is-disabled",
  ".el-input.is-disabled *",
  ".el-input-number.is-disabled",
  ".el-link.is-disabled",
  ".el-menu-item.is-disabled",
  ".el-month-table td.disabled",
  ".el-option.is-disabled",
  ".el-pagination button:disabled",
  ".el-picker-panel__icon-btn.is-disabled",
  ".el-radio.is-disabled",
  ".el-radio-button.is-disabled",
  ".el-select.is-disabled",
  ".el-select-dropdown__item.is-disabled",
  ".el-select__wrapper.is-disabled",
  ".el-slider.is-disabled",
  ".el-sub-menu.is-disabled .el-sub-menu__title",
  ".el-switch.is-disabled",
  ".el-tabs__item.is-disabled",
  ".el-time-spinner__item.is-disabled",
  ".el-tree-node.is-disabled > .el-tree-node__content",
  ".el-upload--disabled",
  ".el-upload.is-disabled",
  ".el-year-table td.disabled",
] as const;

const loadingSelectors = [
  "[aria-busy=\"true\"]",
  "[data-cursor=\"progress\"]",
  ".cursor-progress",
  ".el-button.is-loading",
  ".el-icon.is-loading",
  ".el-select-dropdown.is-loading",
  ".el-upload-list__item.is-uploading",
] as const;

const waitSelectors = [
  "[data-cursor=\"wait\"]",
  ".cursor-wait",
  ".el-loading-mask",
  ".el-skeleton.is-animated",
] as const;

const moveSelectors = [
  "[draggable=\"true\"]",
  "[data-cursor=\"move\"]",
  ".cursor-grab",
  ".cursor-move",
  ".el-dialog.is-draggable .el-dialog__header",
  ".el-dialog__header",
  ".el-drawer__header",
  ".el-input-tag__item.is-draggable",
  ".el-scrollbar__thumb",
  ".el-slider__button",
  ".el-slider__button-wrapper",
  ".el-table .dragging",
  ".el-tree-node.is-drop-inner > .el-tree-node__content",
  "[style*=\"cursor: grab\"]",
  "[style*=\"cursor:grab\"]",
  "[style*=\"cursor: move\"]",
  "[style*=\"cursor:move\"]",
] as const;

const horizontalResizeSelectors = [
  "[data-cursor=\"ew-resize\"]",
  ".cursor-ew-resize",
  ".resize-horizontal",
  ".resize-x",
  ".el-drawer__handle.is-horizontal",
  ".el-splitter__mask-horizontal",
  ".el-splitter-bar__dragger-horizontal",
  ".el-table__column-resize-proxy",
  "[style*=\"col-resize\"]",
  "[style*=\"ew-resize\"]",
] as const;

const verticalResizeSelectors = [
  "[data-cursor=\"ns-resize\"]",
  ".cursor-ns-resize",
  ".resize-vertical",
  ".resize-y",
  ".el-drawer__handle.is-vertical",
  ".el-splitter__mask-vertical",
  ".el-splitter-bar__dragger-vertical",
  "[style*=\"ns-resize\"]",
  "[style*=\"row-resize\"]",
] as const;

/**
 * 选择器 → 光标。顺序就是优先级：同一个元素命中多条规则时，后面的覆盖前面的
 * （disabled / help 这类状态光标必须压过 link，和原生 cursor 的级联一致）。
 */
const CURSOR_RULES: readonly CursorRule[] = [
  {
    cursor: "normal-select",
    selectors: ["html", "body", "#app"],
  },
  {
    cursor: "link",
    selectors: [
      ...nativeInteractiveSelectors,
      ...elementPlusInteractiveSelectors,
      ...appInteractiveSelectors,
    ],
  },
  {
    cursor: "text-select",
    selectors: textSelectors,
  },
  {
    cursor: "unavailable",
    selectors: disabledSelectors,
  },
  {
    cursor: "help-select",
    selectors: [
      "[title]:not(a):not(button)",
      "abbr[title]",
      "[data-cursor=\"help\"]",
      ".cursor-help",
      ".el-tooltip__trigger",
    ],
  },
  {
    cursor: "work",
    selectors: loadingSelectors,
  },
  {
    cursor: "busy",
    selectors: waitSelectors,
  },
  {
    cursor: "precision-select",
    selectors: [
      "[data-cursor=\"crosshair\"]",
      ".cursor-crosshair",
      "[style*=\"cursor: crosshair\"]",
      "[style*=\"cursor:crosshair\"]",
    ],
  },
  {
    cursor: "move",
    selectors: moveSelectors,
  },
  {
    cursor: "horizontal-resize",
    selectors: horizontalResizeSelectors,
  },
  {
    cursor: "vertical-resize",
    selectors: verticalResizeSelectors,
  },
  {
    cursor: "diagonal-resize-1",
    selectors: [
      "[data-cursor=\"nwse-resize\"]",
      ".cursor-nwse-resize",
      "[style*=\"nw-resize\"]",
      "[style*=\"nwse-resize\"]",
      "[style*=\"se-resize\"]",
    ],
  },
  {
    cursor: "diagonal-resize-2",
    selectors: [
      "[data-cursor=\"nesw-resize\"]",
      ".cursor-nesw-resize",
      "[style*=\"ne-resize\"]",
      "[style*=\"nesw-resize\"]",
      "[style*=\"sw-resize\"]",
    ],
  },
  {
    cursor: "handwriting",
    selectors: [
      "[data-cursor=\"handwriting\"]",
      ".cursor-handwriting",
      "[style*=\"cursor: cell\"]",
      "[style*=\"cursor:cell\"]",
    ],
  },
  {
    cursor: "alternate-select",
    selectors: [
      "[data-cursor=\"alternate\"]",
      ".cursor-alternate",
      "[style*=\"cursor: alias\"]",
      "[style*=\"cursor:alias\"]",
    ],
  },
  {
    cursor: "location-select",
    selectors: [
      "[data-cursor=\"pin\"]",
      "[data-cursor=\"location\"]",
      ".cursor-location",
      ".cursor-pin",
    ],
  },
  {
    cursor: "person-select",
    selectors: ["[data-cursor=\"person\"]", ".cursor-person"],
  },
];

/** 帧图边长（CSS px），与生成器输出一致。 */
const CURSOR_SIZE = 32;
/** 覆盖层：盖在所有内容之上，但不接收指针事件。 */
const CURSOR_Z_INDEX = "2147483647";
/** 每类元素挂的光标类型（CSS 自定义属性，覆盖层读它）。 */
const CURSOR_PROPERTY = "--miku-cursor";

/** URL -> 已加载的图片。 */
const loadedImages = new Map<string, HTMLImageElement>();
/** 已经把「全部帧」加载完的光标。 */
const readyCursors = new Set<MikuCursorKey>();

let mounted = false;
let enabled = false;
let overlay: HTMLCanvasElement | null = null;
let overlayCtx: CanvasRenderingContext2D | null = null;
let rulesStyle: HTMLStyleElement | null = null;
let hideStyle: HTMLStyleElement | null = null;
let idleHandle: number | undefined;
let idleHandleType: "idle" | "timeout" | undefined;
let frameTimer: number | undefined;
let visible = false;
let pointerX = 0;
let pointerY = 0;
let pointerSeen = false;
let currentKey: MikuCursorKey = "normal-select";
let currentTarget: Element | null = null;
let animationStartedAt = 0;
let lastDrawnSignature = "";

function isFinePointerDevice() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  if (typeof window.matchMedia !== "function") {
    return true;
  }

  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function isCursorKey(value: string): value is MikuCursorKey {
  return Object.prototype.hasOwnProperty.call(MIKU_CURSORS, value);
}

/** 加载一张帧图（失败也 resolve null，交给首帧兜底）。 */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  const cached = loadedImages.get(url);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      loadedImages.set(url, image);
      resolve(image);
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function firstFrameUrl(key: MikuCursorKey) {
  const step = MIKU_CURSORS[key].steps[0];
  return step ? frameUrl(step.file) : "";
}

function frameImage(key: MikuCursorKey, index: number) {
  const step = MIKU_CURSORS[key].steps[index];
  return step ? loadedImages.get(frameUrl(step.file)) ?? null : null;
}

/** 指针所在元素用哪只光标 —— 交给 CSS 自定义属性的级联来算。 */
function resolveCursorKey(target: Element | null): MikuCursorKey {
  if (!target) return "normal-select";
  const value = getComputedStyle(target).getPropertyValue(CURSOR_PROPERTY).trim();
  return isCursorKey(value) ? value : "normal-select";
}

function updateTransform() {
  if (!overlay) return;
  const [hotspotX, hotspotY] = MIKU_CURSORS[currentKey].hotspot;
  overlay.style.transform = `translate3d(${pointerX - hotspotX}px, ${pointerY - hotspotY}px, 0)`;
}

/**
 * 画当前帧。
 *
 * 只有「该光标全部帧已就绪」时才按时间推进；否则停在首帧（启动阶段）。
 * `now` 用 performance.now()，和 `animationStartedAt` 同一时钟。
 */
function drawFrame(now: number) {
  const ctx = overlayCtx;
  if (!ctx) return;

  const animation = MIKU_CURSORS[currentKey];
  let index = 0;

  if (readyCursors.has(currentKey) && animation.totalDuration > 0) {
    const elapsed = (now - animationStartedAt) % animation.totalDuration;
    let accumulated = 0;
    for (let i = 0; i < animation.steps.length; i += 1) {
      accumulated += animation.steps[i]?.duration ?? 0;
      index = i;
      if (elapsed < accumulated) break;
    }
  }

  const image = frameImage(currentKey, index)
    ?? frameImage(currentKey, 0)
    ?? frameImage("normal-select", 0);
  if (!image) return;

  const signature = `${currentKey}:${index}:${image.src}`;
  if (signature === lastDrawnSignature) return;
  lastDrawnSignature = signature;

  ctx.clearRect(0, 0, CURSOR_SIZE, CURSOR_SIZE);
  ctx.drawImage(image, 0, 0, CURSOR_SIZE, CURSOR_SIZE);
}

/** 距离当前帧结束还有多久（毫秒）；未就绪时返回 undefined（不排定时器）。 */
function delayUntilNextFrame(now: number) {
  const animation = MIKU_CURSORS[currentKey];
  if (!readyCursors.has(currentKey) || animation.totalDuration <= 0) {
    return undefined;
  }

  const elapsed = (now - animationStartedAt) % animation.totalDuration;
  let accumulated = 0;
  for (const step of animation.steps) {
    accumulated += step.duration;
    if (elapsed < accumulated) {
      return Math.max(16, accumulated - elapsed);
    }
  }
  return undefined;
}

function tick() {
  frameTimer = undefined;
  if (!visible) return;

  const now = performance.now();
  drawFrame(now);

  const delay = delayUntilNextFrame(now);
  if (delay !== undefined) {
    frameTimer = window.setTimeout(tick, delay);
  }
}

function stopFrames() {
  if (frameTimer === undefined) return;
  window.clearTimeout(frameTimer);
  frameTimer = undefined;
}

/** 重新起一轮计时：换光标类型 / 重新显示 / 帧刚加载完都要调。 */
function startFrames() {
  stopFrames();
  if (!visible) return;

  const now = performance.now();
  drawFrame(now);

  const delay = delayUntilNextFrame(now);
  if (delay !== undefined) {
    frameTimer = window.setTimeout(tick, delay);
  }
}

function hideNativeCursor() {
  document.documentElement.classList.add("miku-cursor-on");
}

function show() {
  if (!enabled || visible || !overlay) return;
  visible = true;
  overlay.style.display = "block";
  hideNativeCursor();
  lastDrawnSignature = "";
  updateTransform();
  startFrames();
}

function hide() {
  visible = false;
  stopFrames();
  if (overlay) overlay.style.display = "none";
}

function handlePointerMove(event: PointerEvent) {
  // 触屏（含触控笔以外的触摸）不归虚拟光标管；混合设备上摸一下就把覆盖层收起来
  if (event.pointerType === "touch") {
    hide();
    return;
  }
  if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") {
    return;
  }

  pointerX = event.clientX;
  pointerY = event.clientY;
  pointerSeen = true;

  if (!enabled) return;

  const target = event.target instanceof Element ? event.target : null;
  if (target !== currentTarget) {
    currentTarget = target;
    const nextKey = resolveCursorKey(target);
    if (nextKey !== currentKey) {
      currentKey = nextKey;
      animationStartedAt = performance.now();
      lastDrawnSignature = "";
      updateTransform();
      startFrames();
    }
  }

  if (!visible) {
    animationStartedAt = performance.now();
    show();
  } else {
    updateTransform();
  }
}

/** 指针离开窗口（relatedTarget 为空）时藏起覆盖层，避免停在边缘。 */
function handlePointerOut(event: PointerEvent) {
  if (!event.relatedTarget) hide();
}

function handleVisibilityChange() {
  if (document.hidden) hide();
}

/**
 * 全屏时覆盖层（挂在 body 下）不会跟着进全屏元素，继续藏着系统光标就等于没光标。
 * 这里让出全屏这一段时间：恢复系统光标，退出全屏后下一次 pointermove 再接管。
 */
function handleFullscreenChange() {
  if (!document.fullscreenElement) return;
  hide();
  document.documentElement.classList.remove("miku-cursor-on");
}

function mountOverlay() {
  const canvas = document.createElement("canvas");
  canvas.className = "miku-cursor";
  canvas.setAttribute("aria-hidden", "true");

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = CURSOR_SIZE * dpr;
  canvas.height = CURSOR_SIZE * dpr;
  canvas.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${CURSOR_SIZE}px`,
    `height:${CURSOR_SIZE}px`,
    "pointer-events:none",
    "display:none",
    `z-index:${CURSOR_Z_INDEX}`,
    "will-change:transform",
    "image-rendering:pixelated",
  ].join(";");

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;

  (document.body ?? document.documentElement).appendChild(canvas);
  overlay = canvas;
  overlayCtx = ctx;
}

function enable() {
  if (!mounted || !overlayCtx || enabled) return;
  if (!loadedImages.has(firstFrameUrl("normal-select"))) return;

  enabled = true;

  // 已经移动过指针的话立刻接管（否则等下一次 pointermove）
  if (pointerSeen) {
    currentTarget = document.elementFromPoint(pointerX, pointerY);
    currentKey = resolveCursorKey(currentTarget);
    animationStartedAt = performance.now();
    lastDrawnSignature = "";
    show();
  }
}

/**
 * 空闲阶段：逐只光标加载剩余帧。
 *
 * 按规则顺序处理（normal / link / text 最先），先就绪的先动起来。
 */
async function loadRemainingFrames() {
  const keys = [...new Set(CURSOR_RULES.map((rule) => rule.cursor))];

  for (const key of keys) {
    if (!mounted) return;

    const urls = MIKU_CURSORS[key].steps.slice(1).map((step) => frameUrl(step.file));
    if (urls.length) {
      await Promise.all(urls.map((url) => loadImage(url)));
    }
    if (!mounted) return;

    readyCursors.add(key);
    if (key === currentKey && visible) startFrames();
  }
}

function scheduleIdle(task: () => void) {
  const idleWindow = window as unknown as WindowWithOptionalIdleCallback;

  if (typeof idleWindow.requestIdleCallback === "function") {
    idleHandleType = "idle";
    idleHandle = idleWindow.requestIdleCallback(
      () => {
        idleHandle = undefined;
        idleHandleType = undefined;
        task();
      },
      { timeout: 1500 },
    );
    return;
  }

  idleHandleType = "timeout";
  idleHandle = window.setTimeout(() => {
    idleHandle = undefined;
    idleHandleType = undefined;
    task();
  }, 800);
}

function cancelIdle() {
  if (idleHandle === undefined) return;

  const idleWindow = window as unknown as WindowWithOptionalIdleCallback;
  if (idleHandleType === "idle" && typeof idleWindow.cancelIdleCallback === "function") {
    idleWindow.cancelIdleCallback(idleHandle);
  } else {
    window.clearTimeout(idleHandle);
  }

  idleHandle = undefined;
  idleHandleType = undefined;
}

export function setupMikuCursor() {
  if (mounted || !isFinePointerDevice()) {
    return;
  }

  mounted = true;

  // 1) 每类元素挂光标类型（只写自定义属性，不碰原生 cursor）
  rulesStyle = document.createElement("style");
  rulesStyle.dataset.mikuCursor = "rules";
  rulesStyle.textContent = CURSOR_RULES.map(
    (rule) => `${rule.selectors.join(",\n")} { ${CURSOR_PROPERTY}: ${rule.cursor}; }`,
  ).join("\n");
  document.head.appendChild(rulesStyle);

  // 2) 原生光标只在覆盖层接管后隐藏（`miku-cursor-on` 由 show() 添加）
  hideStyle = document.createElement("style");
  hideStyle.dataset.mikuCursor = "native";
  hideStyle.textContent =
    "html.miku-cursor-on, html.miku-cursor-on * { cursor: none !important; }";
  document.head.appendChild(hideStyle);

  mountOverlay();

  window.addEventListener("pointermove", handlePointerMove, { passive: true });
  // pointerover 也走同一套：DOM 在指针下方变化（弹层打开、列表刷新）时浏览器会重新命中，
  // 不移动鼠标也能把光标类型切过去。
  window.addEventListener("pointerover", handlePointerMove, { passive: true });
  window.addEventListener("pointerout", handlePointerOut, { passive: true });
  window.addEventListener("blur", hide);
  // 拖拽（含从系统拖文件进来）期间交给系统拖拽光标，别让覆盖层停在原地
  window.addEventListener("dragenter", hide, { passive: true });
  window.addEventListener("drop", hide, { passive: true });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("fullscreenchange", handleFullscreenChange);

  // 3) 首屏只拉首帧：normal 的首帧一到就接管光标（其余首帧并行补齐），
  //    首帧全部落地后再空闲加载剩余帧。
  const firstFrames = [...new Set(CURSOR_RULES.map((rule) => rule.cursor))].map(
    (key) => firstFrameUrl(key),
  );

  void loadImage(firstFrameUrl("normal-select")).then(() => {
    if (mounted) enable();
  });

  void Promise.all(firstFrames.map((url) => loadImage(url))).then(() => {
    if (mounted) scheduleIdle(() => void loadRemainingFrames());
  });
}

export function destroyMikuCursor() {
  mounted = false;
  enabled = false;
  hide();

  cancelIdle();
  stopFrames();

  window.removeEventListener("pointermove", handlePointerMove);
  window.removeEventListener("pointerover", handlePointerMove);
  window.removeEventListener("pointerout", handlePointerOut);
  window.removeEventListener("blur", hide);
  window.removeEventListener("dragenter", hide);
  window.removeEventListener("drop", hide);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  document.documentElement.classList.remove("miku-cursor-on");

  overlay?.remove();
  overlay = null;
  overlayCtx = null;

  rulesStyle?.remove();
  hideStyle?.remove();
  rulesStyle = null;
  hideStyle = null;

  loadedImages.clear();
  readyCursors.clear();
  currentTarget = null;
  currentKey = "normal-select";
  pointerSeen = false;
  lastDrawnSignature = "";
}

if (import.meta.hot) {
  import.meta.hot.dispose(destroyMikuCursor);
}
