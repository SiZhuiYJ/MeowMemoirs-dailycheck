/**
 * Miku 动画光标。
 *
 * 素材在 `src/assets/Miku/*.ani`，但**运行时不解码 ANI**：构建期
 * `scripts/build-miku-cursors.mjs` 已经把每个 .ani 拆成 32×32 的 PNG 帧，并把
 * 每帧时长写进 `cursors.generated.ts`。这里只负责两件事：
 *
 *   1. 启动：给每类元素装「首帧」光标（单帧动画）并预热首帧图片，首屏即可用；
 *   2. 空闲：逐只光标加载剩余帧，加载完替换成完整 @keyframes，开始播放。
 *
 * 选择器是白名单：元素自己写了 `cursor: pointer` 就会覆盖「继承来的」动画光标，
 * 所以「整块可点但不是 button/a」的元素必须登记到 appInteractiveSelectors。
 */
import {
  MIKU_CURSOR_VERSION,
  MIKU_CURSORS,
  type MikuCursorAnimation,
  type MikuCursorKey,
} from "./cursors.generated";

/**
 * 一条「选择器 → 光标」规则。
 *
 * 光标本身在构建期就被拆成了 32×32 的帧图（scripts/build-miku-cursors.mjs），
 * 这里只负责说明「哪些元素用哪只光标、热点在哪」。
 */
type CursorRule = {
  /** `cursors.generated.ts` 里的光标 key（准星/时长都跟着它走） */
  cursor: MikuCursorKey;
  selectors: readonly string[];
  fallback: string;
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
 * 为什么必须显式登记：ani-cursor 的做法是给**命中的选择器**挂一条 `cursor` 关键帧
 * 动画，没命中的元素只能继承 html/body/#app 上的动画光标。而这些元素自己写了
 * `cursor: pointer` —— 普通声明覆盖的是「继承来的值」，动画只挂在祖先身上、
 * 不会作用到它们，于是光标回退成系统默认手型。在满是 Miku 光标的页面里，
 * 鼠标一移上去就像变成了「普通的系统按钮」。
 *
 * 以后新增「整块可点」的自定义元素，把选择器补到这里；`<button>` / `a[href]`
 * 已经由上面的原生列表覆盖，不用重复登记。
 */
const appInteractiveSelectors = [
  // 会话列表项：li 整行可点（见 features/chat/style/index.scss 的 .conversation-list li）
  ".conversation-item",
  // 文件消息卡片：图片 / 视频 / 音频 / 文档共用这个根节点，整块可点打开详情。
  // 上传中刻意保持 cursor: default（FileMessage.vue），所以排除掉这个状态。
  ".file-message:not(.uploading)",
  // 头像跳转：ProgressiveAvatar 的根节点是 div，只靠 CSS 给的手型
  ".member-avatar-link",
  ".search-result-avatar-link",
  ".blacklist-avatar",
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
 * 选择器 → 光标。顺序就是注入顺序：同一个元素命中多条规则时，后面的覆盖前面的
 * （disabled / help 这类状态光标必须压过 link，和旧实现保持一致）。
 */
const CURSOR_RULES: readonly CursorRule[] = [
  {
    cursor: "normal-select",
    selectors: ["html", "body", "#app"],
    fallback: "auto",
  },
  {
    cursor: "link",
    selectors: [
      ...nativeInteractiveSelectors,
      ...elementPlusInteractiveSelectors,
      ...appInteractiveSelectors,
    ],
    fallback: "pointer",
  },
  {
    cursor: "text-select",
    selectors: textSelectors,
    fallback: "text",
  },
  {
    cursor: "unavailable",
    selectors: disabledSelectors,
    fallback: "not-allowed",
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
    fallback: "help",
  },
  {
    cursor: "work",
    selectors: loadingSelectors,
    fallback: "progress",
  },
  {
    cursor: "busy",
    selectors: waitSelectors,
    fallback: "wait",
  },
  {
    cursor: "precision-select",
    selectors: [
      "[data-cursor=\"crosshair\"]",
      ".cursor-crosshair",
      "[style*=\"cursor: crosshair\"]",
      "[style*=\"cursor:crosshair\"]",
    ],
    fallback: "crosshair",
  },
  {
    cursor: "move",
    selectors: moveSelectors,
    fallback: "move",
  },
  {
    cursor: "horizontal-resize",
    selectors: horizontalResizeSelectors,
    fallback: "ew-resize",
  },
  {
    cursor: "vertical-resize",
    selectors: verticalResizeSelectors,
    fallback: "ns-resize",
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
    fallback: "nwse-resize",
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
    fallback: "nesw-resize",
  },
  {
    cursor: "handwriting",
    selectors: [
      "[data-cursor=\"handwriting\"]",
      ".cursor-handwriting",
      "[style*=\"cursor: cell\"]",
      "[style*=\"cursor:cell\"]",
    ],
    fallback: "cell",
  },
  {
    cursor: "alternate-select",
    selectors: [
      "[data-cursor=\"alternate\"]",
      ".cursor-alternate",
      "[style*=\"cursor: alias\"]",
      "[style*=\"cursor:alias\"]",
    ],
    fallback: "alias",
  },
  {
    cursor: "location-select",
    selectors: [
      "[data-cursor=\"pin\"]",
      "[data-cursor=\"location\"]",
      ".cursor-location",
      ".cursor-pin",
    ],
    fallback: "pointer",
  },
  {
    cursor: "person-select",
    selectors: ["[data-cursor=\"person\"]", ".cursor-person"],
    fallback: "pointer",
  },
];

/** `cursor` 的值：`url(...) 0 0, pointer`；准星取自素材的 CUR hotspot。 */
function cursorValue(rule: CursorRule, url: string) {
  const [hotspotX, hotspotY] = MIKU_CURSORS[rule.cursor].hotspot;
  return `url("${url}") ${hotspotX} ${hotspotY}, ${rule.fallback}`;
}

function keyframesName(index: number) {
  return `miku-cursor-${index}`;
}

function formatPercent(value: number) {
  return `${Number(value.toFixed(5))}%`;
}

/**
 * 首帧样式。
 *
 * 用「只有 0% 的动画」而不是普通 `cursor` 声明，是为了让两个阶段的层叠行为完全一致：
 * 动画天然压过元素自己的 `cursor: pointer`（.conversation-item / .file-message 就靠
 * `.file-message:not(.uploading)` 这类规则拿回 Miku 光标），换成普通声明会输给
 * `.conversation-list li` 这种更高特异性的写法，首帧阶段就会闪回系统光标。
 */
function buildFirstFrameCss(rule: CursorRule, index: number, url: string) {
  return [
    `@keyframes ${keyframesName(index)} {`,
    `  0% { cursor: ${cursorValue(rule, url)}; }`,
    `}`,
    // 同时写一条普通 cursor 兜底：支持 cursor 动画的浏览器由动画覆盖，
    // 不支持的浏览器至少还能拿到首帧，而不是系统光标。
    `${rule.selectors.join(",\n")} { cursor: ${cursorValue(rule, url)}; animation: ${keyframesName(index)} 1000ms step-end infinite; }`,
  ].join("\n");
}

/**
 * 完整动画：按生成的字幕表把每一步换算成百分比位置。
 *
 * `step-end` + 每步一个关键帧 = 到点硬切；最后一步的百分比不一定是 100%，
 * 剩余区间会保持最后一帧直到循环回到 0%，与 ani-cursor.js 的行为一致。
 */
function buildAnimationCss(rule: CursorRule, index: number, animation: MikuCursorAnimation) {
  let position = 0;
  let firstUrl: string | undefined;
  const frames: string[] = [];

  for (const step of animation.steps) {
    const url = frameUrl(step.file);
    firstUrl ??= url;
    frames.push(`  ${formatPercent(position)} { cursor: ${cursorValue(rule, url)}; }`);
    position += (step.duration / animation.totalDuration) * 100;
  }

  // 普通 cursor 兜底：支持 cursor 动画的浏览器由动画覆盖，
  // 不支持的浏览器至少停在首帧，而不是系统光标。
  const staticCursor = firstUrl ? ` cursor: ${cursorValue(rule, firstUrl)};` : "";

  return [
    `@keyframes ${keyframesName(index)} {`,
    ...frames,
    `}`,
    `${rule.selectors.join(",\n")} {${staticCursor} animation: ${keyframesName(index)} ${Number(
      animation.totalDuration.toFixed(3),
    )}ms step-end infinite; }`,
  ].join("\n");
}

/** 预加载图片（失败也 resolve：宁可少这一帧，也不能让升级流程卡住）。 */
function preload(urls: readonly string[]) {
  return Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = url;
        }),
    ),
  ).then(() => undefined);
}

const mountedStyles: Array<HTMLStyleElement | undefined> = [];
let idleHandle: number | undefined;
let idleHandleType: "idle" | "timeout" | undefined;
let mounted = false;

function isFinePointerDevice() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  if (typeof window.matchMedia !== "function") {
    return true;
  }

  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/**
 * 启动阶段：只加载每只光标的**首帧**。
 *
 * 每只光标一条 <style>，内容是「首帧 + 1000ms 的单帧动画」。等剩余帧加载完，
 * 直接替换同一个 <style> 的内容（keyframes 名字不变），光标就从静态首帧切到动画。
 */
function mountFirstFrames() {
  const firstFrames: string[] = [];

  CURSOR_RULES.forEach((rule, index) => {
    const animation = MIKU_CURSORS[rule.cursor];
    const first = animation.steps[0];
    if (!first) {
      mountedStyles[index] = undefined;
      return;
    }

    const url = frameUrl(first.file);
    firstFrames.push(url);

    const style = document.createElement("style");
    style.dataset.mikuCursor = rule.cursor;
    style.dataset.mikuCursorPhase = "first-frame";
    style.textContent = buildFirstFrameCss(rule, index, url);
    document.head.appendChild(style);
    mountedStyles[index] = style;
  });

  // 首帧预热：真正悬停时不用再等这一次网络请求。
  void preload(firstFrames);
}

/**
 * 空闲阶段：逐只光标加载剩余帧，加载完就把该光标升级成完整动画。
 *
 * 按光标逐个处理（而不是把所有帧一次性丢出去），既限制并发，也让先加载完的
 * 光标先动起来，不必等最慢的那只。
 */
async function loadRemainingFrames() {
  for (let index = 0; index < CURSOR_RULES.length; index += 1) {
    if (!mounted) return;

    const rule = CURSOR_RULES[index];
    const style = mountedStyles[index];
    if (!rule || !style) continue;

    const animation = MIKU_CURSORS[rule.cursor];

    // 首帧在启动阶段已经预热过，这里只等剩下的帧（单帧光标没有后续帧要等）。
    const laterFrames = animation.steps.slice(1).map((step) => frameUrl(step.file));
    if (laterFrames.length) await preload(laterFrames);
    if (!mounted) return;

    style.dataset.mikuCursorPhase = "animated";
    style.textContent = buildAnimationCss(rule, index, animation);
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
      { timeout: 3000 },
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
  mountFirstFrames();
  scheduleIdle(() => void loadRemainingFrames());
}

export function destroyMikuCursor() {
  mounted = false;
  cancelIdle();
  mountedStyles.forEach((style) => style?.remove());
  mountedStyles.length = 0;
}

if (import.meta.hot) {
  import.meta.hot.dispose(destroyMikuCursor);
}
