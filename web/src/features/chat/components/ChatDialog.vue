<script lang="ts">
/**
 * 模块级状态：弹层栈、层级、body 滚动锁。
 *
 * 必须写在普通 `<script>` 里 —— `<script setup>` 的内容会被编译进 setup()，
 * 写在那里的话每个弹层实例都会拿到自己的一份「栈」和「锁计数」，
 * 嵌套弹层与 ESC 的层级判定就全部失效。
 */
let instanceSeed = 0;
const openStack: number[] = [];

/** 基准层级：必须低于 Element Plus 的 2000 档，见文件头说明。 */
const BASE_Z_INDEX = 1900;
const Z_INDEX_STEP = 10;

/** body 滚动锁计数：嵌套弹层各锁一次，全部关闭才恢复。 */
let bodyLockCount = 0;
let bodyOverflowBeforeLock = '';

function lockBodyScroll() {
  if (typeof document === 'undefined') return;
  if (bodyLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyLockCount += 1;
}

function unlockBodyScroll() {
  if (typeof document === 'undefined' || bodyLockCount === 0) return;
  bodyLockCount -= 1;
  if (bodyLockCount === 0) {
    document.body.style.overflow = bodyOverflowBeforeLock;
  }
}
</script>

<script setup lang="ts">
/**
 * 聊天页专用弹层（替代 Element Plus 的 `el-dialog`）。
 *
 * ## 为什么不用 el-dialog
 *
 * 聊天页的弹层越来越多（会话详情、邀请、加群申请、禁言、好友列表 / 搜索 /
 * 好友申请、黑名单、申请加群、拖拽上传确认、文件详情……），而 el-dialog 的
 * 结构是「居中卡片 + 标题 + 正文 + 可选 footer」。在手机上它只有 92vw 宽，
 * 长列表要么在弹窗里再套一层滚动条（双层滚动），要么把整页撑出屏幕。
 *
 * 这里改成和聊天主界面**同一套布局**的整屏弹层：
 *
 *   .chat-dialog-overlay                    遮罩（app 可视高度，不在 body 上滚动）
 *     └ .chat-dialog.conversation-detail    整屏面板（100% 窗口宽高）
 *         ├ .chat-header                    顶部栏（标题 + 关闭 / 头部操作）
 *         ├ .el-scrollbar                   中间内容栏（唯一滚动区，宽高 100%）
 *         │   └ .chat-dialog-body           内容列（居中，宽度可配）
 *         └ .composer                       底部栏（footer 操作按钮）
 *
 * 顶部 / 底部栏沿用聊天页的 `.chat-header` / `.composer`：绝对定位 + 毛玻璃
 * 渐变，内容从它们下面滚过去，视觉与聊天页完全一致。区别只是弹层被 Teleport
 * 到 body，脱离了 `.chat-page` 的 CSS 变量作用域，所以本组件在 `.chat-dialog`
 * 上重新声明一整套 `--chat-*` 变量（值与 features/chat/style/index.scss 对齐），
 * 三档设备（大屏电脑 32px / 平板·手机 24px）的密度也在这里再切一次。
 *
 * ## 尺寸
 *
 * - 面板：`width: 100%` / `height: 100%`，`max-width: 100vw` /
 *   `max-height: var(--app-h, 100dvh)` —— 即「最大宽高均为当前窗口的 100%」。
 * - 内容栏 `.el-scrollbar`：同样 `width/height: 100%`，`max-width/height` 同上；
 *   它是弹层里**唯一**的滚动容器（调用方的长列表不要再套 el-scrollbar）。
 * - 内容列 `.chat-dialog-body`：默认居中、`max-width: 760px`，避免在 2K 屏上
 *   一行文字拉得过长；传 `content-width="100%"` 可铺满。
 *
 * ## 层级
 *
 * 基准 z-index 取 1900（不是 2000）：Element Plus 的 overlay / popper 从
 * 2000 起递增，聊天里仍会用到 `ElMessageBox.confirm`（解散群聊、移出群聊等）
 * 与 el-select 下拉。弹层压在 1900 档，确认框和下拉才能正常浮在它上面；
 * 嵌套弹层按打开顺序每层 +10（1910 / 1920 …），互相不会盖住。
 *
 * ## 交互
 *
 * - 打开时锁 body 滚动（嵌套弹层用计数，内层关闭不会把外层的锁解掉）；
 * - ESC 关闭：只在最上层弹层上生效；`el-select` 自己处理 ESC 时
 *   （会 preventDefault + stopPropagation），不会顺手把整个弹层关掉；
 * - 焦圈：打开时聚焦面板、Tab / Shift+Tab 在面板内循环，关闭后焦点回到
 *   打开前的元素；
 * - 过渡结束后才 emit `closed`（与 el-dialog 的 `@closed` 语义一致），
 *   `close-on-click-modal` / `close-on-press-escape` / `show-close` 与
 *   `closable` 组合，忙碌态下与本项目原 el-dialog 的用法一一对应。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Close } from '@element-plus/icons-vue';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** 顶部栏标题；长标题省略显示。 */
    title?: string;
    /** 标题右侧的补充说明（例如「共 3 项」）。 */
    subtitle?: string;
    /** 关闭总开关：false 时关闭按钮 / 遮罩 / ESC 全部禁用（忙碌态）。 */
    closable?: boolean;
    closeOnClickModal?: boolean;
    closeOnPressEscape?: boolean;
    /** 是否显示右上角关闭按钮（忙碌态下单独隐藏，与 el-dialog 一致）。 */
    showClose?: boolean;
    /** 内容列最大宽度，默认 760px；铺满传 "100%"。 */
    contentWidth?: string;
  }>(),
  {
    title: '',
    subtitle: '',
    closable: true,
    closeOnClickModal: true,
    closeOnPressEscape: true,
    showClose: true,
    contentWidth: '760px',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  open: [];
  opened: [];
  close: [];
  closed: [];
}>();

/** 每个实例一个 id，用于「只有最上层响应 ESC」。 */
const instanceId = ++instanceSeed;

const panelRef = ref<HTMLElement | null>(null);
const scrollbarRef = ref<{ setScrollTop: (top: number) => void } | null>(null);

const titleId = `chat-dialog-title-${instanceId}`;

const zIndex = ref(BASE_Z_INDEX + Z_INDEX_STEP);
const contentStyle = computed(() => ({ maxWidth: props.contentWidth }));

/** 打开前的焦点元素：关闭后还回去。 */
let previousActiveElement: HTMLElement | null = null;
/** 当前是否已入栈（避免 leaving 过渡期间重复入栈 / 出栈）。 */
let stacked = false;
/** 是否处于打开状态（模型值），用于幂等的 onOpen。 */
let opened = false;
/** 本实例是否真的锁住了 body（避免重复解锁 / 漏解锁）。 */
let bodyLocked = false;

function acquireBodyLock() {
  if (bodyLocked) return;
  bodyLocked = true;
  lockBodyScroll();
}

function releaseBodyLock() {
  if (!bodyLocked) return;
  bodyLocked = false;
  unlockBodyScroll();
}

const canClose = computed(() => props.closable);

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isTopmost() {
  return openStack[openStack.length - 1] === instanceId;
}

function getFocusableElements(): HTMLElement[] {
  const panel = panelRef.value;
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.offsetParent !== null,
  );
}

function handlePanelKeydown(event: KeyboardEvent) {
  // 嵌套弹层：ESC / Tab 只归最上层管，否则一次按键会连关两层。
  if (!isTopmost()) return;

  if (event.key === 'Escape') {
    if (!canClose.value || !props.closeOnPressEscape) return;
    // el-select 等组件处理 ESC 时会 stopPropagation，这里再兜一层
    // defaultPrevented，避免「关下拉」被当成「关弹层」。
    if (event.defaultPrevented) return;
    event.preventDefault();
    // 弹层是模态的：ESC 只用于关它，不再传给页面上的其它快捷键。
    event.stopPropagation();
    requestClose();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusables = getFocusableElements();
  const panel = panelRef.value;
  if (!panel) return;

  if (focusables.length === 0) {
    event.preventDefault();
    panel.focus({ preventScroll: true });
    return;
  }

  const first = focusables[0] as HTMLElement;
  const last = focusables[focusables.length - 1] as HTMLElement;
  const activeElement = document.activeElement as HTMLElement | null;
  const focusInsidePanel = activeElement !== null && panel.contains(activeElement);

  if (event.shiftKey) {
    if (!focusInsidePanel || activeElement === first || activeElement === panel) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (!focusInsidePanel || activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function requestClose() {
  if (!canClose.value) return;
  emit('close');
  emit('update:modelValue', false);
}

function handleOverlayClick() {
  if (!canClose.value || !props.closeOnClickModal) return;
  requestClose();
}

function handleOverlayMousedown() {
  // 点空白处后焦点可能落到 body，按键就收不到了；拉回面板。
  panelRef.value?.focus({ preventScroll: true });
}

function handleAfterEnter() {
  emit('opened');
}

function handleAfterLeave() {
  // 过渡期间又被打开时 Vue 会取消 leave；这里再兜一层，避免误清栈 / 误解锁。
  if (props.modelValue) return;
  opened = false;
  if (stacked) {
    const index = openStack.indexOf(instanceId);
    if (index >= 0) openStack.splice(index, 1);
    stacked = false;
  }
  releaseBodyLock();

  const previous = previousActiveElement;
  previousActiveElement = null;
  if (previous && document.contains(previous)) {
    previous.focus({ preventScroll: true });
  }

  emit('closed');
}

function onOpen() {
  if (opened) return;
  // 打开请求可能在同一个 tick 内又被关掉：此时不要再入栈 / 加锁，
  // 否则这一层永远等不到 after-leave，body 滚动锁与弹层栈都会漏。
  if (!props.modelValue) return;
  opened = true;

  openStack.push(instanceId);
  stacked = true;
  // 栈深 1 -> 1910、2 -> 1920…… 仍然低于 EP 的 2000 档。
  zIndex.value = BASE_Z_INDEX + openStack.length * Z_INDEX_STEP;

  previousActiveElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  acquireBodyLock();
  emit('open');

  nextTick(() => {
    scrollbarRef.value?.setScrollTop(0);
    panelRef.value?.focus({ preventScroll: true });
  });
}

onBeforeUnmount(() => {
  if (stacked) {
    const index = openStack.indexOf(instanceId);
    if (index >= 0) openStack.splice(index, 1);
    stacked = false;
  }
  opened = false;
  releaseBodyLock();
});

watch(
  () => props.modelValue,
  (value) => {
    if (value) {
      // 等 DOM 真正渲染出来再入栈（模板里的 v-if 在下一帧生效）。
      void nextTick(onOpen);
    }
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="chat-dialog-fade" @after-enter="handleAfterEnter" @after-leave="handleAfterLeave">
      <div v-if="modelValue" class="chat-dialog-overlay" :style="{ zIndex }" @mousedown.self="handleOverlayMousedown"
        @click.self="handleOverlayClick">
        <section ref="panelRef" class="chat-dialog conversation-detail"
          :class="{ 'chat-dialog--with-footer': $slots.footer }" role="dialog" aria-modal="true" tabindex="-1"
          :aria-labelledby="title ? titleId : undefined" @keydown="handlePanelKeydown">
          <header class="chat-header">
            <div class="chat-dialog-header-inner" :style="contentStyle">
              <div class="chat-header-main">
                <h3 v-if="title" :id="titleId" class="chat-dialog-title" :title="title">{{ title }}</h3>
                <span v-if="subtitle" class="chat-dialog-subtitle">{{ subtitle }}</span>
                <slot name="header-extra" />
              </div>

              <div class="chat-dialog-header-actions">
                <slot name="header-actions" />
                <el-button v-if="showClose" class="chat-dialog-close" link :icon="Close" aria-label="关闭" title="关闭"
                  @click="requestClose" />
              </div>
            </div>
          </header>

          <el-scrollbar ref="scrollbarRef" class="chat-dialog-scrollbar">
            <div class="chat-dialog-body" :style="contentStyle">
              <slot />
            </div>
          </el-scrollbar>

          <footer v-if="$slots.footer" class="composer chat-dialog-composer">
            <div class="chat-dialog-footer" :style="contentStyle">
              <slot name="footer" />
            </div>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;
@use "@/styles/app-shell" as shell;

// ==============================================
// 变量：与 features/chat/style/index.scss 的 .chat-page 对齐
// ==============================================
// 弹层被 Teleport 到 body，拿不到 .chat-page 上的变量，所以在这里重新声明一份。
// 全局 .chat-header / .composer 的规则也会读这些变量（毛玻璃背景等）。
.chat-dialog {
  // 打开时脚本会 focus 面板自身（读屏播报标题），不要因此在整屏外圈出现焦点框。
  &:focus {
    outline: none;
  }

  // —— 大屏电脑端（默认）——
  --chat-gap: 12px;
  --chat-pad: 12px;
  --chat-control-h: 32px;
  --chat-radius: 8px;
  --chat-title-fs: 16px;

  // —— 派生量 ——
  --chat-bar-h: calc(var(--chat-control-h) + var(--chat-pad) * 2);

  --chat-bg: linear-gradient(180deg, #f7f7f5 0%, #ebeae4 100%);
  --chat-surface: rgba(255, 255, 255, 0.94);
  --chat-border: rgba(17, 24, 39, 0.08);
  --chat-shadow: 0 18px 40px rgba(17, 24, 39, 0.08);
  --chat-accent: #9a4f8d;
  --chat-accent-soft: #f7e8f4;
  --chat-muted: #6b7280;
  --chat-danger: #dc2626;

  // 全局 .chat-header / .composer 现在由 app-shell 的通用 mixin 提供，
  // 读取 --shell-*；弹层这里把聊天变量映射过去。
  --shell-gap: var(--chat-gap);
  --shell-pad: var(--chat-pad);
  --shell-control-h: var(--chat-control-h);
  --shell-radius: var(--chat-radius);
  --shell-title-fs: var(--chat-title-fs);
  --shell-bar-h: var(--chat-bar-h);
  --shell-bg: var(--chat-bg);
  --shell-surface: var(--chat-surface);
  --shell-border: var(--chat-border);
  --shell-shadow: var(--chat-shadow);
  --shell-muted: var(--chat-muted);

  // Element Plus 控件高度：与聊天页同一套密度（32 / 24）。
  --el-component-size: var(--chat-control-h);
  --el-component-size-small: var(--chat-control-h);

  position: relative;
  display: block;
  // 宽高 = 当前窗口的 100%（max-* 再兜一层，软键盘/地址栏变化时不会超出）。
  width: 100%;
  max-width: 100vw;
  height: 100%;
  max-height: var(--app-h, 100dvh);
  overflow: hidden;
  color: #111827;
  background: var(--chat-bg);
  box-shadow: var(--chat-shadow);

  // 按钮 / 输入框高度与聊天页一致（EP 的 32px 是写死的，必须显式接管）。
  :deep(.el-button:not(.is-link)) {
    height: var(--chat-control-h);
  }

  :deep(.el-input__wrapper),
  :deep(.el-select__wrapper) {
    min-height: var(--chat-control-h);
  }
}

// 整屏遮罩与用户主页 / 聊天页共用 app-shell 的全屏浮层结构。
.chat-dialog-overlay {
  @include shell.app-fullscreen-overlay;
}

// ==============================================
// 顶部栏：复用聊天页 .chat-header 的绝对定位 + 毛玻璃
// ==============================================
.chat-dialog>.chat-header {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--chat-gap);
  min-height: calc(var(--chat-bar-h) + var(--safe-top, 0px));
  padding: calc(var(--chat-pad) + var(--safe-top, 0px)) calc(var(--chat-pad) + var(--safe-right, 0px)) var(--chat-pad) calc(var(--chat-pad) + var(--safe-left, 0px));
  background: linear-gradient(var(--chat-surface), transparent);
  backdrop-filter: blur(6px);
}

.chat-dialog-header-inner {
  width: 100%;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--chat-gap);
  min-width: 0;
}

.chat-header-main {
  display: flex;
  align-items: center;
  gap: var(--chat-gap);
  min-width: 0;
  flex: 1 1 auto;
}

.chat-dialog-title {
  min-width: 0;
  margin: 0;
  padding-left: 6px;
  overflow: hidden;
  color: #111827;
  font-size: var(--chat-title-fs);
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-dialog-subtitle {
  flex-shrink: 0;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
}

.chat-dialog-header-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
}

.chat-dialog-close {
  width: var(--chat-control-h);
  height: var(--chat-control-h);
  margin: 0;
  padding: 0;
  color: var(--chat-muted);
  font-size: 18px;
  border-radius: 50%;

  &:hover {
    color: #111827;
    background: rgba(17, 24, 39, 0.06);
  }
}

// ==============================================
// 中间内容栏：唯一滚动区，宽高均为窗口的 100%
// ==============================================
.chat-dialog-scrollbar {
  width: 100%;
  max-width: 100vw;
  height: 100%;
  max-height: var(--app-h, 100dvh);

  :deep(.el-scrollbar__wrap) {
    overflow-x: hidden;
  }

  // 滚动条避开顶部 / 底部浮层栏。
  :deep(.el-scrollbar__bar.is-vertical) {
    top: calc(var(--chat-bar-h) + var(--safe-top, 0px));
    bottom: calc(var(--chat-bar-h) + var(--safe-bottom, 0px));
  }
}

.chat-dialog-body {
  box-sizing: border-box;
  display: grid;
  gap: var(--chat-gap);
  width: 100%;
  min-width: 0;
  margin: 0 auto;
  // 上下留白 = 浮层头部 / 底部栏高度，让内容可以钻到毛玻璃栏下面。
  padding: calc(var(--chat-bar-h) + var(--safe-top, 0px)) calc(var(--chat-pad) + var(--safe-right, 0px)) calc(var(--chat-bar-h) + var(--safe-bottom, 0px)) calc(var(--chat-pad) + var(--safe-left, 0px));
}

// 没有底部操作栏时不需要给 composer 留位置。
.chat-dialog:not(.chat-dialog--with-footer) .chat-dialog-body {
  padding-bottom: calc(var(--chat-pad) + var(--safe-bottom, 0px));
}

// 没有底部栏时，滚动条轨道也贴到内容底部。
.chat-dialog:not(.chat-dialog--with-footer) .chat-dialog-scrollbar :deep(.el-scrollbar__bar.is-vertical) {
  bottom: calc(var(--chat-pad) + var(--safe-bottom, 0px));
}

// 内容块的 grid item 默认 min-width: auto，长文件名 / nowrap 文本会顶宽内容列；
// 统一压到 0，由各内容块自己决定省略。
.chat-dialog-body>* {
  min-width: 0;
}

// ==============================================
// 底部栏：复用聊天页 .composer 的绝对定位 + 毛玻璃
// ==============================================
.chat-dialog>.composer {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--chat-gap);
  padding: var(--chat-pad) calc(var(--chat-pad) + var(--safe-right, 0px)) calc(var(--chat-pad) + var(--safe-bottom, 0px)) calc(var(--chat-pad) + var(--safe-left, 0px));
  background: linear-gradient(to top, var(--chat-surface), transparent);
  backdrop-filter: blur(6px);
}

.chat-dialog-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
  margin: 0 auto;
}

// ==============================================
// 打开 / 关闭过渡
// ==============================================
.chat-dialog-fade-enter-active,
.chat-dialog-fade-leave-active {
  transition: opacity 0.2s ease;
}

.chat-dialog-fade-enter-active .chat-dialog,
.chat-dialog-fade-leave-active .chat-dialog {
  transition: transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.2s ease;
}

.chat-dialog-fade-enter-from,
.chat-dialog-fade-leave-to {
  opacity: 0;
}

.chat-dialog-fade-enter-from .chat-dialog,
.chat-dialog-fade-leave-to .chat-dialog {
  transform: translateY(10px) scale(0.995);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {

  .chat-dialog-fade-enter-active,
  .chat-dialog-fade-leave-active,
  .chat-dialog-fade-enter-active .chat-dialog,
  .chat-dialog-fade-leave-active .chat-dialog {
    transition: none;
  }

  .chat-dialog-fade-enter-from .chat-dialog,
  .chat-dialog-fade-leave-to .chat-dialog {
    transform: none;
  }
}

// ==============================================
// 三档设备：平板 / 手机 = 24px 控件 + 6px 间距
// ==============================================
@include rp.device-mobile {
  .chat-dialog {
    --chat-gap: 6px;
    --chat-pad: 6px;
    --chat-control-h: 24px;
    --chat-title-fs: 15px;
  }

  .chat-dialog-body {
    // 内容块之间的呼吸感比控件间距稍大一点，否则卡片会糊成一片。
    gap: 12px;
    padding-left: calc(var(--chat-pad) + var(--safe-left, 0px));
    padding-right: calc(var(--chat-pad) + var(--safe-right, 0px));
  }

  .chat-dialog-title {
    padding-left: 0;
  }

  .chat-dialog-footer {
    gap: 6px;
  }
}
</style>
