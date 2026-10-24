/**
 * ⚠️ 由 `scripts/build-miku-cursors.mjs` 生成，请勿手改。
 * 重新生成：`npm run cursors`
 *
 * 每只光标的动画信息：帧图（相对 `public/miku-cursors`）、每帧停留时长、准星。
 * 帧图尺寸统一为 32×32；`steps[0]` 是首帧（启动时只加载它）。
 * 准星来自素材每帧 CUR 头里的 hotspot，按「32 / 原始尺寸」缩放，不要手写。
 *
 * 帧图内容版本号同时用作缓存戳：运行时 URL 形如
 * `/miku-cursors/link/0.png?v=<MIKU_CURSOR_VERSION>`。
 */

/** 帧图内容版本（重新生成后变化，用于给静态缓存加戳）。 */
export const MIKU_CURSOR_VERSION = "0090ab3c11";

export interface MikuCursorStep {
  /** 帧图路径，相对 `public/miku-cursors` */
  file: string;
  /** 该帧停留时长（毫秒） */
  duration: number;
}

export interface MikuCursorAnimation {
  /** 源 `.ani` 文件名 */
  source: string;
  width: number;
  height: number;
  /** 准星（热点）：素材 CUR 里的 hotspot，已换算到输出尺寸 */
  hotspot: readonly [number, number];
  steps: readonly MikuCursorStep[];
  /** 一轮动画总时长（毫秒） */
  totalDuration: number;
}

export const MIKU_CURSORS = {
  "alternate-select": {
    source: "Alternate Select.ani",
    width: 32,
    height: 32,
    hotspot: [2, 0],
    steps: [
      { file: "alternate-select/0.png", duration: 133.333 },
      { file: "alternate-select/1.png", duration: 133.333 },
      { file: "alternate-select/2.png", duration: 133.333 },
      { file: "alternate-select/3.png", duration: 133.333 },
      { file: "alternate-select/4.png", duration: 133.333 },
      { file: "alternate-select/5.png", duration: 133.333 },
      { file: "alternate-select/6.png", duration: 133.333 },
      { file: "alternate-select/7.png", duration: 133.333 },
      { file: "alternate-select/8.png", duration: 133.333 },
      { file: "alternate-select/9.png", duration: 133.333 },
      { file: "alternate-select/10.png", duration: 133.333 },
      { file: "alternate-select/11.png", duration: 133.333 },
      { file: "alternate-select/12.png", duration: 133.333 },
    ],
    totalDuration: 1733.329,
  },
  "busy": {
    source: "Busy.ani",
    width: 32,
    height: 32,
    hotspot: [0, 0],
    steps: [
      { file: "busy/0.png", duration: 116.667 },
      { file: "busy/1.png", duration: 116.667 },
      { file: "busy/2.png", duration: 116.667 },
      { file: "busy/3.png", duration: 116.667 },
      { file: "busy/4.png", duration: 116.667 },
      { file: "busy/5.png", duration: 116.667 },
      { file: "busy/6.png", duration: 116.667 },
      { file: "busy/7.png", duration: 116.667 },
      { file: "busy/8.png", duration: 116.667 },
      { file: "busy/9.png", duration: 116.667 },
      { file: "busy/10.png", duration: 116.667 },
      { file: "busy/11.png", duration: 116.667 },
      { file: "busy/12.png", duration: 116.667 },
      { file: "busy/13.png", duration: 116.667 },
      { file: "busy/14.png", duration: 116.667 },
      { file: "busy/15.png", duration: 116.667 },
    ],
    totalDuration: 1866.672,
  },
  "diagonal-resize-1": {
    source: "Diagonal Resize 1.ani",
    width: 32,
    height: 32,
    hotspot: [15, 16],
    steps: [
      { file: "diagonal-resize-1/0.png", duration: 150 },
      { file: "diagonal-resize-1/1.png", duration: 150 },
      { file: "diagonal-resize-1/2.png", duration: 150 },
      { file: "diagonal-resize-1/3.png", duration: 150 },
    ],
    totalDuration: 600,
  },
  "diagonal-resize-2": {
    source: "Diagonal Resize 2.ani",
    width: 32,
    height: 32,
    hotspot: [16, 16],
    steps: [
      { file: "diagonal-resize-2/0.png", duration: 150 },
      { file: "diagonal-resize-2/1.png", duration: 150 },
      { file: "diagonal-resize-2/2.png", duration: 150 },
      { file: "diagonal-resize-2/3.png", duration: 150 },
    ],
    totalDuration: 600,
  },
  "handwriting": {
    source: "handwriting.ani",
    width: 32,
    height: 32,
    hotspot: [1, 1],
    steps: [
      { file: "handwriting/0.png", duration: 100 },
    ],
    totalDuration: 100,
  },
  "help-select": {
    source: "Help Select.ani",
    width: 32,
    height: 32,
    hotspot: [0, 0],
    steps: [
      { file: "help-select/0.png", duration: 133.333 },
      { file: "help-select/1.png", duration: 133.333 },
      { file: "help-select/2.png", duration: 133.333 },
      { file: "help-select/3.png", duration: 133.333 },
      { file: "help-select/4.png", duration: 133.333 },
      { file: "help-select/5.png", duration: 133.333 },
      { file: "help-select/6.png", duration: 133.333 },
      { file: "help-select/7.png", duration: 133.333 },
      { file: "help-select/8.png", duration: 133.333 },
      { file: "help-select/9.png", duration: 133.333 },
      { file: "help-select/10.png", duration: 133.333 },
      { file: "help-select/11.png", duration: 133.333 },
      { file: "help-select/12.png", duration: 133.333 },
      { file: "help-select/13.png", duration: 133.333 },
      { file: "help-select/14.png", duration: 133.333 },
      { file: "help-select/15.png", duration: 133.333 },
    ],
    totalDuration: 2133.328,
  },
  "horizontal-resize": {
    source: "Horizontal Resize.ani",
    width: 32,
    height: 32,
    hotspot: [16, 16],
    steps: [
      { file: "horizontal-resize/0.png", duration: 150 },
      { file: "horizontal-resize/1.png", duration: 150 },
      { file: "horizontal-resize/2.png", duration: 150 },
      { file: "horizontal-resize/3.png", duration: 150 },
    ],
    totalDuration: 600,
  },
  "link": {
    source: "Link.ani",
    width: 32,
    height: 32,
    hotspot: [0, 0],
    steps: [
      { file: "link/0.png", duration: 116.667 },
      { file: "link/1.png", duration: 116.667 },
      { file: "link/2.png", duration: 116.667 },
      { file: "link/3.png", duration: 116.667 },
      { file: "link/4.png", duration: 116.667 },
      { file: "link/5.png", duration: 116.667 },
      { file: "link/6.png", duration: 116.667 },
      { file: "link/7.png", duration: 116.667 },
      { file: "link/8.png", duration: 116.667 },
      { file: "link/9.png", duration: 116.667 },
      { file: "link/10.png", duration: 116.667 },
      { file: "link/11.png", duration: 116.667 },
      { file: "link/12.png", duration: 116.667 },
      { file: "link/13.png", duration: 116.667 },
      { file: "link/14.png", duration: 116.667 },
      { file: "link/15.png", duration: 116.667 },
      { file: "link/16.png", duration: 116.667 },
    ],
    totalDuration: 1983.339,
  },
  "location-select": {
    source: "Location Select.ani",
    width: 32,
    height: 32,
    hotspot: [15, 24],
    steps: [
      { file: "location-select/0.png", duration: 100 },
    ],
    totalDuration: 100,
  },
  "move": {
    source: "Move.ani",
    width: 32,
    height: 32,
    hotspot: [15, 16],
    steps: [
      { file: "move/0.png", duration: 150 },
      { file: "move/1.png", duration: 150 },
      { file: "move/2.png", duration: 150 },
      { file: "move/3.png", duration: 150 },
    ],
    totalDuration: 600,
  },
  "normal-select": {
    source: "Normal Select.ani",
    width: 32,
    height: 32,
    hotspot: [0, 0],
    steps: [
      { file: "normal-select/0.png", duration: 116.667 },
      { file: "normal-select/1.png", duration: 116.667 },
      { file: "normal-select/2.png", duration: 116.667 },
      { file: "normal-select/3.png", duration: 116.667 },
      { file: "normal-select/4.png", duration: 116.667 },
      { file: "normal-select/5.png", duration: 116.667 },
      { file: "normal-select/6.png", duration: 116.667 },
      { file: "normal-select/7.png", duration: 116.667 },
      { file: "normal-select/8.png", duration: 116.667 },
      { file: "normal-select/9.png", duration: 116.667 },
      { file: "normal-select/10.png", duration: 116.667 },
      { file: "normal-select/11.png", duration: 116.667 },
    ],
    totalDuration: 1400.004,
  },
  "person-select": {
    source: "Person Select.ani",
    width: 32,
    height: 32,
    hotspot: [1, 1],
    steps: [
      { file: "person-select/0.png", duration: 100 },
    ],
    totalDuration: 100,
  },
  "precision-select": {
    source: "Precision Select.ani",
    width: 32,
    height: 32,
    hotspot: [6, 6],
    steps: [
      { file: "precision-select/0.png", duration: 133.333 },
      { file: "precision-select/1.png", duration: 133.333 },
      { file: "precision-select/2.png", duration: 133.333 },
      { file: "precision-select/3.png", duration: 133.333 },
      { file: "precision-select/4.png", duration: 133.333 },
      { file: "precision-select/5.png", duration: 133.333 },
      { file: "precision-select/6.png", duration: 133.333 },
      { file: "precision-select/7.png", duration: 133.333 },
      { file: "precision-select/8.png", duration: 133.333 },
      { file: "precision-select/9.png", duration: 133.333 },
      { file: "precision-select/10.png", duration: 133.333 },
      { file: "precision-select/11.png", duration: 133.333 },
      { file: "precision-select/12.png", duration: 133.333 },
    ],
    totalDuration: 1733.329,
  },
  "text-select": {
    source: "Text Select.ani",
    width: 32,
    height: 32,
    hotspot: [3, 7],
    steps: [
      { file: "text-select/0.png", duration: 133.333 },
      { file: "text-select/1.png", duration: 133.333 },
      { file: "text-select/2.png", duration: 133.333 },
      { file: "text-select/3.png", duration: 133.333 },
      { file: "text-select/4.png", duration: 133.333 },
      { file: "text-select/5.png", duration: 133.333 },
      { file: "text-select/6.png", duration: 133.333 },
      { file: "text-select/7.png", duration: 133.333 },
      { file: "text-select/8.png", duration: 133.333 },
      { file: "text-select/9.png", duration: 133.333 },
      { file: "text-select/10.png", duration: 133.333 },
      { file: "text-select/11.png", duration: 133.333 },
    ],
    totalDuration: 1599.996,
  },
  "unavailable": {
    source: "Unavailable.ani",
    width: 32,
    height: 32,
    hotspot: [0, 0],
    steps: [
      { file: "unavailable/0.png", duration: 116.667 },
    ],
    totalDuration: 116.667,
  },
  "vertical-resize": {
    source: "Vertical Resize.ani",
    width: 32,
    height: 32,
    hotspot: [15, 16],
    steps: [
      { file: "vertical-resize/0.png", duration: 150 },
      { file: "vertical-resize/1.png", duration: 150 },
      { file: "vertical-resize/2.png", duration: 150 },
      { file: "vertical-resize/3.png", duration: 150 },
    ],
    totalDuration: 600,
  },
  "work": {
    source: "Work.ani",
    width: 32,
    height: 32,
    hotspot: [2, 2],
    steps: [
      { file: "work/0.png", duration: 116.667 },
      { file: "work/1.png", duration: 116.667 },
      { file: "work/2.png", duration: 116.667 },
      { file: "work/3.png", duration: 116.667 },
      { file: "work/4.png", duration: 116.667 },
      { file: "work/5.png", duration: 116.667 },
      { file: "work/6.png", duration: 116.667 },
      { file: "work/7.png", duration: 116.667 },
      { file: "work/8.png", duration: 116.667 },
      { file: "work/9.png", duration: 116.667 },
      { file: "work/10.png", duration: 116.667 },
      { file: "work/11.png", duration: 116.667 },
      { file: "work/12.png", duration: 116.667 },
      { file: "work/13.png", duration: 116.667 },
      { file: "work/14.png", duration: 116.667 },
      { file: "work/15.png", duration: 116.667 },
      { file: "work/16.png", duration: 116.667 },
      { file: "work/17.png", duration: 116.667 },
      { file: "work/18.png", duration: 116.667 },
      { file: "work/19.png", duration: 116.667 },
      { file: "work/20.png", duration: 116.667 },
      { file: "work/21.png", duration: 116.667 },
      { file: "work/22.png", duration: 116.667 },
    ],
    totalDuration: 2683.341,
  },
} satisfies Record<string, MikuCursorAnimation>;

export type MikuCursorKey = keyof typeof MIKU_CURSORS;
