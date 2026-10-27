<!--
  埋点诊断悬浮按钮（可拖动）。

  为什么需要拖动：
  这个按钮是全局 fixed 悬浮层，默认停在聊天页输入区上方（避开上传 / 发送按钮的
  触屏命中区）。横屏或小窗口时仍可能贴到安全区 / 其他控件，允许用户把它拖到
  任意角落，比反复调 bottom / left 常量更直接。

  实现要点：
  1. 用 Pointer Events 统一鼠标 / 触屏 / 手写笔，不写两套 mousemove + touchmove。
  2. 位移小于 6px 仍按「点按」处理，超过阈值才进入拖动 —— 手指点按时几像素的
     抖动不会把「打开诊断页」变成「拖了一下」。
  3. 拖动结束后的 click 直接忽略（350ms 窗口），否则松手时浏览器会补一个 click，
     表现为「拖完按钮自己跳进诊断页」。
  4. 位置用「可移动范围内的比例」持久化（不是像素）：换设备、旋转屏幕后仍然
     停留在用户熟悉的角落，且不会因为视口变小跑到屏幕外。
  5. 拖动范围会避开刘海 / 手势条（--safe-*），并随 resize / 横竖屏切换重新夹取。
  6. 触屏端通过 touch-action: none 阻止拖动时页面跟着滚动或双指缩放。
  7. 背景是半透明磨砂玻璃（backdrop-filter + 白色高光），不支持时回退到主题底色。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

interface Props {
  /** 当前累计的 error 级埋点数，> 0 时显示红色角标。 */
  errorCount?: number;
}

const props = withDefaults(defineProps<Props>(), {
  errorCount: 0,
});

const emit = defineEmits<{
  /** 未发生拖动时点击按钮：父组件负责跳转诊断页。 */
  open: [];
}>();

/**
 * localStorage 键：只存比例，不存像素。
 * v2：默认位置上移后，旧版保存的位置可能仍压着上传键，一次性重置到新默认。
 */
const STORAGE_KEY = "telemetry-fab-position-v2";
/** 与视口（含安全区）边缘保持的最小间距。 */
const EDGE_GAP = 8;
/** 判定「拖动」的最小位移；小于它的移动仍算点按。 */
const DRAG_THRESHOLD = 6;
/** 拖动结束后忽略 click 的时间窗口。 */
const CLICK_GUARD_MS = 350;
/**
 * 默认位置：左下角，但必须停在输入区（composer）上方。
 *
 * 实测 393×852 的移动端 Chrome 上：composer 高 36px，文件上传键的透明命中区
 * 还向上外扩 10px（44px 触屏命中区）。原来 DEFAULT_BOTTOM_OFFSET=28 时，
 * 诊断按钮和上传命中区重叠 11px（约 22% 面积）——点在按钮上沿会打开诊断页
 * 而不是文件选择器。这里再上抬 28px，留出 17px 间隙。
 */
const DEFAULT_BOTTOM_OFFSET = 56;

const fabRef = ref<HTMLButtonElement | null>(null);
const position = ref({ x: EDGE_GAP, y: EDGE_GAP });
const isPositioned = ref(false);
const isDragging = ref(false);

/** 用户拖动后的归一化位置：0 = 最左/最上，1 = 最右/最下。 */
const savedRatio = ref<{ x: number; y: number } | null>(null);

interface FabMetrics {
  width: number;
  height: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

let activePointerId: number | null = null;
let dragStartPointer = { x: 0, y: 0 };
let dragStartPosition = { x: 0, y: 0 };
let dragMetrics: FabMetrics | null = null;
let movedDuringDrag = false;
/** 用 -Infinity 而不是 0：否则页面打开后的前 350ms 内，正常点按会被误判成「刚拖完」。 */
let lastDragEndAt = Number.NEGATIVE_INFINITY;
let relayoutFrame: number | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseCssPx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 读取全局安全区。
 * CSS 里 --safe-* 由 env(safe-area-inset-*) 定义，计算值一般已是 px；
 * 个别浏览器读回原始 env() 字符串时 parseFloat 会得到 NaN，退化为 0，
 * 最坏情况只是少让出一点刘海空间，不会把按钮夹到屏幕外。
 */
function readSafeInsets(): SafeInsets {
  if (typeof window === "undefined") {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const style = window.getComputedStyle(document.documentElement);
  return {
    top: parseCssPx(style.getPropertyValue("--safe-top")),
    right: parseCssPx(style.getPropertyValue("--safe-right")),
    bottom: parseCssPx(style.getPropertyValue("--safe-bottom")),
    left: parseCssPx(style.getPropertyValue("--safe-left")),
  };
}

/** 量一次按钮尺寸与当前视口的可移动范围。按钮尺寸随断点/触屏媒体查询变化，不能写死。 */
function measureMetrics(): FabMetrics | null {
  const el = fabRef.value;
  if (!el || typeof window === "undefined") return null;

  const rect = el.getBoundingClientRect();
  const width = rect.width || 48;
  const height = rect.height || 28;
  const insets = readSafeInsets();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const minX = insets.left + EDGE_GAP;
  const minY = insets.top + EDGE_GAP;

  return {
    width,
    height,
    minX,
    maxX: Math.max(minX, viewportWidth - insets.right - EDGE_GAP - width),
    minY,
    maxY: Math.max(minY, viewportHeight - insets.bottom - EDGE_GAP - height),
  };
}

function positionFromRatio(
  ratio: { x: number; y: number },
  metrics: FabMetrics,
): { x: number; y: number } {
  return {
    x: metrics.minX + (metrics.maxX - metrics.minX) * ratio.x,
    y: metrics.minY + (metrics.maxY - metrics.minY) * ratio.y,
  };
}

function ratioFromPosition(
  next: { x: number; y: number },
  metrics: FabMetrics,
): { x: number; y: number } {
  const spanX = metrics.maxX - metrics.minX;
  const spanY = metrics.maxY - metrics.minY;
  return {
    x: spanX > 0 ? clamp((next.x - metrics.minX) / spanX, 0, 1) : 0,
    y: spanY > 0 ? clamp((next.y - metrics.minY) / spanY, 0, 1) : 1,
  };
}

function defaultPosition(metrics: FabMetrics): { x: number; y: number } {
  return {
    x: metrics.minX,
    y: Math.max(metrics.minY, metrics.maxY - DEFAULT_BOTTOM_OFFSET),
  };
}

function readStoredRatio(): { x: number; y: number } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") {
      return null;
    }
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: clamp(parsed.x, 0, 1), y: clamp(parsed.y, 0, 1) };
  } catch {
    // 隐私模式 / localStorage 被禁用时不影响按钮本身可用，只是不记忆位置。
    return null;
  }
}

function writeStoredRatio(ratio: { x: number; y: number }): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ratio));
  } catch {
    // 同上：存不下就算了。
  }
}

/** 按当前视口 + 已保存比例重新摆放。resize / 横竖屏切换 / 首次挂载都走这里。 */
function applyPlacement(): void {
  const metrics = measureMetrics();
  if (!metrics) return;
  position.value = savedRatio.value
    ? positionFromRatio(savedRatio.value, metrics)
    : defaultPosition(metrics);
}

function initialize(): void {
  if (!fabRef.value) return;
  savedRatio.value = readStoredRatio();
  applyPlacement();
  isPositioned.value = true;
}

function scheduleRelayout(): void {
  if (relayoutFrame !== null) return;
  relayoutFrame = window.requestAnimationFrame(() => {
    relayoutFrame = null;
    // 拖动中不重排：此时 position 由手指决定，重排会让按钮跳一下。
    if (isDragging.value) return;
    applyPlacement();
  });
}

function handlePointerDown(event: PointerEvent): void {
  // 鼠标只响应左键；触屏 / 手写笔的 button 恒为 0。
  if (event.pointerType === "mouse" && event.button !== 0) return;
  // 多指触摸时只跟第一根手指，第二根按下直接忽略。
  if (activePointerId !== null) return;

  const el = fabRef.value;
  if (!el) return;

  activePointerId = event.pointerId;
  movedDuringDrag = false;
  dragStartPointer = { x: event.clientX, y: event.clientY };
  dragStartPosition = { ...position.value };
  dragMetrics = measureMetrics();

  try {
    el.setPointerCapture(event.pointerId);
  } catch {
    // 某些旧浏览器 / 合成事件不支持捕获，下面的 window 监听仍能兜住。
  }

  window.addEventListener("pointermove", handlePointerMove, { passive: false });
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerUp);
}

function handlePointerMove(event: PointerEvent): void {
  if (activePointerId === null || event.pointerId !== activePointerId) return;

  // 鼠标在窗口外松开时可能收不到 pointerup，这里用 buttons === 0 兜底，
  // 避免松手后鼠标划过按钮仍被当成拖动。
  if (event.pointerType === "mouse" && event.buttons === 0) {
    finishPointerInteraction();
    return;
  }

  const deltaX = event.clientX - dragStartPointer.x;
  const deltaY = event.clientY - dragStartPointer.y;

  if (!movedDuringDrag) {
    if (Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;
    movedDuringDrag = true;
    isDragging.value = true;
  }

  // touch-action: none 已经能阻止滚动；这里再 preventDefault 是为了兼容
  // 不支持 touch-action 的老 WebView，避免拖动时页面同时滚动。
  if (event.cancelable) event.preventDefault();

  const metrics = dragMetrics;
  if (!metrics) return;

  position.value = {
    x: clamp(dragStartPosition.x + deltaX, metrics.minX, metrics.maxX),
    y: clamp(dragStartPosition.y + deltaY, metrics.minY, metrics.maxY),
  };
}

function finishPointerInteraction(): void {
  if (activePointerId === null) return;

  const pointerId = activePointerId;
  const moved = movedDuringDrag;

  try {
    fabRef.value?.releasePointerCapture(pointerId);
  } catch {
    // 捕获可能已被浏览器自动释放，忽略即可。
  }

  window.removeEventListener("pointermove", handlePointerMove);
  window.removeEventListener("pointerup", handlePointerUp);
  window.removeEventListener("pointercancel", handlePointerUp);

  activePointerId = null;
  dragMetrics = null;
  movedDuringDrag = false;
  isDragging.value = false;

  if (moved) {
    // 记录本次拖动，并挡住紧随其后的 click。
    lastDragEndAt = performance.now();
    const metrics = measureMetrics();
    if (metrics) {
      const ratio = ratioFromPosition(position.value, metrics);
      savedRatio.value = ratio;
      writeStoredRatio(ratio);
      // 角标可能在拖动过程中出现 / 消失让按钮变宽，用最新尺寸再夹一次边。
      applyPlacement();
    }
  }
}

function handlePointerUp(event: PointerEvent): void {
  if (activePointerId === null || event.pointerId !== activePointerId) return;
  finishPointerInteraction();
}

/** 拖到一半切走窗口 / 被系统弹窗打断时，结束拖动并落位，避免状态卡住。 */
function handleWindowBlur(): void {
  if (activePointerId !== null) finishPointerInteraction();
}

function handleClick(): void {
  // 拖动松手后浏览器通常还会补发 click，必须忽略，否则会误跳诊断页。
  if (performance.now() - lastDragEndAt < CLICK_GUARD_MS) return;
  emit("open");
}

const fabStyle = computed(() => ({
  transform: `translate3d(${position.value.x}px, ${position.value.y}px, 0)`,
}));

// 角标出现 / 消失会改变按钮宽度。停在右边缘时若不重新夹取，按钮会溢出屏幕。
watch(
  () => props.errorCount,
  () => {
    if (isDragging.value) return;
    applyPlacement();
  },
  { flush: "post" },
);

onMounted(() => {
  initialize();
  window.addEventListener("resize", scheduleRelayout);
  // 老版 iOS 的 resize 在横竖屏切换时不一定触发，额外听一次 orientationchange。
  window.addEventListener("orientationchange", scheduleRelayout);
  window.addEventListener("blur", handleWindowBlur);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", scheduleRelayout);
  window.removeEventListener("orientationchange", scheduleRelayout);
  window.removeEventListener("blur", handleWindowBlur);
  window.removeEventListener("pointermove", handlePointerMove);
  window.removeEventListener("pointerup", handlePointerUp);
  window.removeEventListener("pointercancel", handlePointerUp);
  if (relayoutFrame !== null) {
    window.cancelAnimationFrame(relayoutFrame);
    relayoutFrame = null;
  }
  activePointerId = null;
  dragMetrics = null;
});
</script>

<template>
  <button ref="fabRef" class="telemetry-fab" :class="{
    'is-positioned': isPositioned,
    'is-dragging': isDragging,
  }" type="button" title="埋点诊断（拖动可移动位置）" :aria-label="props.errorCount > 0
        ? `打开埋点诊断页，当前 ${props.errorCount} 条错误，按住可拖动位置`
        : '打开埋点诊断页，按住可拖动位置'
      " :style="fabStyle" @pointerdown="handlePointerDown" @click="handleClick" @contextmenu.prevent @dragstart.prevent>
    <span class="telemetry-fab__grip" aria-hidden="true"></span>
    <span>诊断</span>
    <span v-if="props.errorCount > 0" class="telemetry-fab-badge" aria-hidden="true">
      {{ props.errorCount > 99 ? "99+" : props.errorCount }}
    </span>
  </button>
</template>

<style scoped>
.telemetry-fab {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 3000;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 28px;
  padding: 6px 10px;
  border: 1px solid var(--theme-color-muted);
  border-radius: 999px;
  color: var(--theme-color-strong);
  font-family: inherit;
  font-size: 11px;
  line-height: 16px;
  /* 兜底：不支持 backdrop-filter 时用主题底色，保证文字仍然可读 */
  background: var(--theme-color-soft);
  box-shadow: 0 6px 18px rgba(var(--theme-color-rgb), 0.2);
  /* 磨砂玻璃顶部高光的强度：浅色面板上更亮，夜间玻璃上克制一点 */
  --fab-glass-highlight: rgba(255, 255, 255, 0.32);
  --fab-glass-highlight-strong: rgba(255, 255, 255, 0.48);
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
  /* 拖动按钮时不要触发页面滚动 / 双指缩放，这是触屏端可用的前提。 */
  touch-action: none;
  will-change: transform;
  visibility: hidden;
  transition:
    box-shadow 0.18s ease,
    border-color 0.18s ease,
    background-color 0.18s ease;
}

/* 日间：白色磨砂更明显，避免夜间那层灰雾压低对比度。 */
:global(html[data-theme="light"] .telemetry-fab) {
  --fab-glass-highlight: rgba(255, 255, 255, 0.92);
  --fab-glass-highlight-strong: rgba(255, 255, 255, 1);
}

/*
 * 透明磨砂背景。
 *
 * 两层 background：斜向白色高光 + 半透明主题色。backdrop-filter 把按钮后面的
 * 聊天内容（图片、气泡、输入框）模糊成柔和色块，既透出背景又保证文字清晰。
 * 只放在 @supports 里：不支持时沿用上面的 --theme-color-soft 实色兜底。
 */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .telemetry-fab {
    background:
      linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.22) 0%,
        rgba(255, 255, 255, 0.06) 46%,
        rgba(255, 255, 255, 0.02) 100%
      ),
      rgba(var(--theme-color-rgb), 0.16);
    border-color: rgba(255, 255, 255, 0.22);
    box-shadow:
      0 8px 24px rgba(var(--theme-color-rgb), 0.24),
      inset 0 1px 0 var(--fab-glass-highlight),
      inset 0 -1px 0 rgba(0, 0, 0, 0.12);
    -webkit-backdrop-filter: blur(14px) saturate(170%);
    backdrop-filter: blur(14px) saturate(170%);
  }

  :global(html[data-theme="light"] .telemetry-fab) {
    background:
      linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.55) 0%,
        rgba(255, 255, 255, 0.24) 50%,
        rgba(255, 255, 255, 0.1) 100%
      ),
      rgba(var(--theme-color-rgb), 0.18);
    /* 浅色底上白边框会「消失」，改用主题次级色描边，玻璃轮廓才立得住 */
    border-color: var(--theme-color-muted);
    box-shadow:
      0 10px 26px rgba(var(--theme-color-rgb), 0.2),
      0 4px 12px rgba(17, 24, 39, 0.08),
      inset 0 1px 0 var(--fab-glass-highlight),
      inset 0 -1px 0 rgba(255, 255, 255, 0.28);
  }
}

/* 首帧先量尺寸再显示，避免保存过位置时在默认角落闪一下。 */
.telemetry-fab.is-positioned {
  visibility: visible;
}

.telemetry-fab.is-dragging {
  cursor: grabbing;
  box-shadow:
    0 14px 34px rgba(var(--theme-color-rgb), 0.32),
    0 6px 16px rgba(17, 24, 39, 0.12),
    inset 0 1px 0 var(--fab-glass-highlight-strong);
}

.telemetry-fab:focus-visible {
  outline: 2px solid var(--theme-color-strong);
  outline-offset: 2px;
}

/* 拖动标识：两列三行共六个点，提示这里可以按住移动。 */
.telemetry-fab__grip {
  width: 6px;
  height: 12px;
  flex: none;
  background-image: radial-gradient(circle, currentColor 0.9px, transparent 1.1px);
  background-size: 3px 4px;
  background-position: center;
  opacity: 0.45;
}

.telemetry-fab-badge {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 999px;
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  background: #dc2626;
}

/* 鼠标端才给 hover；触屏没有 hover，避免点完一直「亮着」。 */
@media (hover: hover) and (pointer: fine) {
  .telemetry-fab:hover {
    border-color: var(--theme-color-strong);
    box-shadow:
      0 10px 28px rgba(var(--theme-color-rgb), 0.3),
      0 4px 12px rgba(17, 24, 39, 0.08),
      inset 0 1px 0 var(--fab-glass-highlight-strong);
  }
}

/* 触屏：把点击区域放大到约 36px 高，单手也能稳稳按住拖动。 */
@media (hover: none) and (pointer: coarse) {
  .telemetry-fab {
    min-width: 48px;
    min-height: 36px;
    padding: 8px 12px;
    font-size: 12px;
    line-height: 18px;
  }

  .telemetry-fab__grip {
    height: 14px;
  }

  .telemetry-fab-badge {
    min-width: 18px;
    font-size: 11px;
    line-height: 18px;
  }
}

/* 横屏手机的纵向空间很紧，按钮别再长高。 */
@media (max-height: 420px) {
  .telemetry-fab {
    min-height: 30px;
    padding-top: 4px;
    padding-bottom: 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .telemetry-fab {
    transition: none;
  }
}
</style>
