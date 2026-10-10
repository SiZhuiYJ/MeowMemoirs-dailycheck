import { setANICursor, type CursorController } from "ani-cursor.js";

import alternateCursorUrl from "@/assets/Miku/Alternate Select.ani?url";
import busyCursorUrl from "@/assets/Miku/Busy.ani?url";
import diagonalResizeOneCursorUrl from "@/assets/Miku/Diagonal Resize 1.ani?url";
import diagonalResizeTwoCursorUrl from "@/assets/Miku/Diagonal Resize 2.ani?url";
import handwritingCursorUrl from "@/assets/Miku/handwriting.ani?url";
import helpCursorUrl from "@/assets/Miku/Help Select.ani?url";
import horizontalResizeCursorUrl from "@/assets/Miku/Horizontal Resize.ani?url";
import linkCursorUrl from "@/assets/Miku/Link.ani?url";
import locationCursorUrl from "@/assets/Miku/Location Select.ani?url";
import moveCursorUrl from "@/assets/Miku/Move.ani?url";
import normalCursorUrl from "@/assets/Miku/Normal Select.ani?url";
import personCursorUrl from "@/assets/Miku/Person Select.ani?url";
import precisionCursorUrl from "@/assets/Miku/Precision Select.ani?url";
import textCursorUrl from "@/assets/Miku/Text Select.ani?url";
import unavailableCursorUrl from "@/assets/Miku/Unavailable.ani?url";
import verticalResizeCursorUrl from "@/assets/Miku/Vertical Resize.ani?url";
import workCursorUrl from "@/assets/Miku/Work.ani?url";

type CursorRule = {
  selectors: readonly string[];
  cursorUrl: string;
  fallback: string;
  hotspot: readonly [number, number];
};

type WindowWithOptionalIdleCallback = {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const CURSOR_SIZE = 32;

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

const immediateCursorRules: readonly CursorRule[] = [
  {
    selectors: ["html", "body", "#app"],
    cursorUrl: normalCursorUrl,
    fallback: "auto",
    hotspot: [0, 0],
  },
  {
    selectors: [...nativeInteractiveSelectors, ...elementPlusInteractiveSelectors],
    cursorUrl: linkCursorUrl,
    fallback: "pointer",
    hotspot: [8, 0],
  },
  {
    selectors: textSelectors,
    cursorUrl: textCursorUrl,
    fallback: "text",
    hotspot: [16, 16],
  },
];

const idleCursorRules: readonly CursorRule[] = [
  {
    selectors: disabledSelectors,
    cursorUrl: unavailableCursorUrl,
    fallback: "not-allowed",
    hotspot: [16, 16],
  },
  {
    selectors: [
      "[title]:not(a):not(button)",
      "abbr[title]",
      "[data-cursor=\"help\"]",
      ".cursor-help",
      ".el-tooltip__trigger",
    ],
    cursorUrl: helpCursorUrl,
    fallback: "help",
    hotspot: [0, 0],
  },
  {
    selectors: loadingSelectors,
    cursorUrl: workCursorUrl,
    fallback: "progress",
    hotspot: [0, 0],
  },
  {
    selectors: waitSelectors,
    cursorUrl: busyCursorUrl,
    fallback: "wait",
    hotspot: [16, 16],
  },
  {
    selectors: [
      "[data-cursor=\"crosshair\"]",
      ".cursor-crosshair",
      "[style*=\"cursor: crosshair\"]",
      "[style*=\"cursor:crosshair\"]",
    ],
    cursorUrl: precisionCursorUrl,
    fallback: "crosshair",
    hotspot: [16, 16],
  },
  {
    selectors: moveSelectors,
    cursorUrl: moveCursorUrl,
    fallback: "move",
    hotspot: [16, 16],
  },
  {
    selectors: horizontalResizeSelectors,
    cursorUrl: horizontalResizeCursorUrl,
    fallback: "ew-resize",
    hotspot: [16, 16],
  },
  {
    selectors: verticalResizeSelectors,
    cursorUrl: verticalResizeCursorUrl,
    fallback: "ns-resize",
    hotspot: [16, 16],
  },
  {
    selectors: [
      "[data-cursor=\"nwse-resize\"]",
      ".cursor-nwse-resize",
      "[style*=\"nw-resize\"]",
      "[style*=\"nwse-resize\"]",
      "[style*=\"se-resize\"]",
    ],
    cursorUrl: diagonalResizeOneCursorUrl,
    fallback: "nwse-resize",
    hotspot: [16, 16],
  },
  {
    selectors: [
      "[data-cursor=\"nesw-resize\"]",
      ".cursor-nesw-resize",
      "[style*=\"ne-resize\"]",
      "[style*=\"nesw-resize\"]",
      "[style*=\"sw-resize\"]",
    ],
    cursorUrl: diagonalResizeTwoCursorUrl,
    fallback: "nesw-resize",
    hotspot: [16, 16],
  },
  {
    selectors: [
      "[data-cursor=\"handwriting\"]",
      ".cursor-handwriting",
      "[style*=\"cursor: cell\"]",
      "[style*=\"cursor:cell\"]",
    ],
    cursorUrl: handwritingCursorUrl,
    fallback: "cell",
    hotspot: [2, 30],
  },
  {
    selectors: [
      "[data-cursor=\"alternate\"]",
      ".cursor-alternate",
      "[style*=\"cursor: alias\"]",
      "[style*=\"cursor:alias\"]",
    ],
    cursorUrl: alternateCursorUrl,
    fallback: "alias",
    hotspot: [0, 0],
  },
  {
    selectors: [
      "[data-cursor=\"pin\"]",
      "[data-cursor=\"location\"]",
      ".cursor-location",
      ".cursor-pin",
    ],
    cursorUrl: locationCursorUrl,
    fallback: "pointer",
    hotspot: [16, 16],
  },
  {
    selectors: [
      "[data-cursor=\"person\"]",
      ".cursor-person",
    ],
    cursorUrl: personCursorUrl,
    fallback: "pointer",
    hotspot: [16, 16],
  },
];

let controllers: CursorController[] = [];
let idleHandle: number | undefined;
let idleHandleType: "idle" | "timeout" | undefined;

function isFinePointerDevice() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  if (typeof window.matchMedia !== "function") {
    return true;
  }

  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function registerCursorRule(rule: CursorRule) {
  const [hotspotX, hotspotY] = rule.hotspot;
  const controller = setANICursor(
    rule.selectors.join(","),
    rule.cursorUrl,
    rule.fallback,
    CURSOR_SIZE,
    CURSOR_SIZE,
    hotspotX,
    hotspotY,
  );

  void controller.ready.catch((error: unknown) => {
    console.warn("Miku ani cursor failed to load:", error);
  });

  controllers.push(controller);
}

function scheduleIdleRegistration() {
  const registerIdleRules = () => {
    idleHandle = undefined;
    idleHandleType = undefined;
    idleCursorRules.forEach(registerCursorRule);
  };
  const idleWindow = window as unknown as WindowWithOptionalIdleCallback;

  if (typeof idleWindow.requestIdleCallback === "function") {
    idleHandle = idleWindow.requestIdleCallback(registerIdleRules, { timeout: 3000 });
    idleHandleType = "idle";
    return;
  }

  idleHandle = window.setTimeout(registerIdleRules, 800);
  idleHandleType = "timeout";
}

export function setupMikuCursor() {
  if (controllers.length > 0 || !isFinePointerDevice()) {
    return;
  }

  immediateCursorRules.forEach(registerCursorRule);
  scheduleIdleRegistration();
}

export function destroyMikuCursor() {
  if (idleHandle !== undefined) {
    const idleWindow = window as unknown as WindowWithOptionalIdleCallback;

    if (idleHandleType === "idle" && typeof idleWindow.cancelIdleCallback === "function") {
      idleWindow.cancelIdleCallback(idleHandle);
    } else {
      window.clearTimeout(idleHandle);
    }

    idleHandle = undefined;
    idleHandleType = undefined;
  }

  controllers.forEach((controller) => controller.destroy());
  controllers = [];
}

if (import.meta.hot) {
  import.meta.hot.dispose(destroyMikuCursor);
}
