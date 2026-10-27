<!--
  文件选择按钮。

  ⚠️ 历史教训，别改回去：
  旧实现是「JS 里 document.createElement('input') + input.click()」，
  桌面正常，手机端（微信/QQ/UC 的内置浏览器、部分 Android WebView）点下去
  完全不弹选择器，也不报错。两层原因：
    1. 那个 input 是 display:none 的 —— 不少移动内核会直接忽略对
       「不渲染的 file input」的程序化 click()；
    2. 它被挂到 body 上，脱离了组件生命周期，出问题时连元素都查不到。

  现在的做法：把**真实的、透明的** <input type="file"> 铺在按钮上，
  手指点到的就是 input 本体，走浏览器原生激活流程 —— 全程没有 JS 点击，
  桌面 / iOS / Android / 内置浏览器行为一致。这也是本仓库
  features/file/ImageUploader.vue、features/checkin/CheckinForm.vue 的既有写法。

  另外顺手修掉的三个坑：
  - 旧实现「window focus + 1.5s 后 input.remove()」会打断慢速设备上还在
    等结果的选择流程（选完文件什么都没发生），现在这个定时器只清埋点标记，
    不再碰 DOM；
  - 旧实现靠 emit 抛错来暂存文件，但组件卸载后 emit 并不会抛错，
    那个兜底其实从未生效。现在用显式的「卸载后转存 + 重建后补发」，
    并且按会话打标记：切了会话就不补发（否则会发到别的会话去）；
  - 同一文件连选两次不触发 change（value 未清空），现在读完 files 立刻清空。
-->
<template>
  <div ref="rootRef" class="file-upload-button">
    <el-tooltip content="发送文件" placement="top" :disabled="!supportsHover">
      <div class="upload-trigger">
        <!-- 纯视觉层：不吃指针事件，所有交互交给下面那个透明 input -->
        <el-button circle class="upload-visual" :loading="preparing" :disabled="isBlocked" aria-hidden="true"
          tabindex="-1">
          <el-icon>
            <Paperclip />
          </el-icon>
        </el-button>

        <!--
          真正的交互元素：透明、铺满按钮、始终渲染。
          用户点它 = 原生唤起文件选择器，不经过任何 JS。
          （所以组件里不该再有任何 .click()；ref 只用于埋点做命中/样式快照。）

          下面这些监听只做「留痕」，不 preventDefault / stopPropagation：
          移动端 Chrome 不弹选择器时，靠 trigger-* / input-click / picker-* 这条链定位断点。
        -->
        <input ref="inputRef" class="native-file-input" type="file" multiple :accept="ACCEPT" :disabled="isBlocked"
          aria-label="发送文件" @click="handleInputClick" @change="handleChange" @focus="handleInputFocus" />
      </div>
    </el-tooltip>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Paperclip } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { telemetry } from '@/libs/telemetry';
import {
  abortChatFileUploadFlow,
  chatFileFlowStep,
  describeUploadTarget,
  describeUserActivation,
  hasActiveChatFileUploadFlow,
  startChatFileUploadFlow,
} from '@/libs/telemetry/chatFileFlow';
import { prepareFilesForMessageUpload } from '../utils/fileUpload';
import { SUPPORTED_FILE_EXTENSIONS } from '../utils/fileMeta';

const props = defineProps<{
  disabled?: boolean;
  /**
   * 当前会话标识。用来给「暂存待补发」的文件打上下文标记：
   * 如果用户在预处理期间切了会话，补发时就不能再发到新会话里去。
   */
  contextKey?: number | string | null;
}>();

const emit = defineEmits<{
  fileSelected: [files: File[]];
}>();

/**
 * 与后端白名单一致：移动端把选择器收窄，能少一半误选。
 *
 * ⚠️ 不要在这里手写扩展名列表。`accept` 是浏览器原生选择器的过滤条件：
 * 不匹配的文件在桌面端直接置灰、点不动，手机端文档选择器也不列出来。
 * 之前这里手写漏了 `.md`（以及 .csv/.rtf/.json/.xml/.html/.css/.js/.ts），
 * 虽然后端 SupportedFileTypes 和前端 validateFile 都放行，用户却「选都选不了」。
 * 现在统一从 fileMeta 的白名单拼出来，两边不会再脱节。
 */
const ACCEPT = [
  // 用通配符而不是逐个列扩展名：手机端能进相册/图库选择器，而不是只弹文件管理器
  'image/*',
  'video/*',
  'audio/*',
  ...SUPPORTED_FILE_EXTENSIONS.map((extension) => `.${extension}`),
].join(',');

/** 校验 + 预处理（图片转 WebP、视频抽帧）期间，不再接受新的选择。 */
const preparing = ref(false);

const rootRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);

/** 忙或禁用 → input 直接 disabled，浏览器不会再弹选择器。 */
const isBlocked = computed(() => Boolean(props.disabled) || preparing.value);

/** 触屏上没有 hover 语义：气泡既没用，还可能吃掉第一下点击，直接禁用。 */
const supportsHover = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

let unmounted = false;

/**
 * 组件被卸载（切会话、返回会话列表…）时暂存已选文件，重建后自动补发。
 * 放模块级：同一时刻页面上只有一个输入框实例。
 */
let pendingFiles: File[] = [];
/** 暂存文件属于哪个会话：切了会话就作废，避免发到别的会话里。 */
let pendingContextKey: number | string | null = null;

/** 选择器是否已关闭（收到 change 或判定为取消）。 */
let pickerClosed = true;
/** 每次点击 input 递增，用于判断某次 focus 回来的是不是同一次选择。 */
let pickerSession = 0;
let pickerMarkerTimer: ReturnType<typeof setTimeout> | null = null;
let pickerRestoreTimer: ReturnType<typeof setTimeout> | null = null;

// —— 上传流程诊断状态 ——
//
// 移动端 Chrome「点了没反应」分好几种，必须分别留下证据：
//   1. pointerdown 到了按钮，但 click 没到 input（被上层元素挡住 / input disabled）；
//   2. input 的 click 到了，但浏览器没有唤起选择器（没有 blur / visibilitychange 信号）；
//   3. 选择器打开了，用户取消；
//   4. 选择器打开了、也选了文件，但后面预处理/上传/发送失败。
// 下面的计时器只负责「超时判定」，原生信号监听在 onMounted 里。

/** click 后多久没收到选择器打开信号就记一条 warn。 */
const PICKER_SIGNAL_WINDOW_MS = 2000;
/** click 后多久仍无信号且无 change，升级为 error（强证据：没唤起选择器）。 */
const PICKER_NOT_OPENED_MS = 5000;
/** focus / visible 回来后等多久仍无 change，判定为取消。 */
const PICKER_CANCEL_SETTLE_MS = 900;
/** pointerdown 后多久没收到 input 的 click，判定为被拦截。 */
const CLICK_MISSING_MS = 1200;

let pointerDownAt = 0;
let pointerDownTargetInsideInput = false;
let inputClickSeen = false;
let inputClickAt = 0;
let pickerSignalSeen = false;
let pickerOpenedAt = 0;
let pickerAttempt = 0;
let pickerMissingTimer: ReturnType<typeof setTimeout> | null = null;
let pickerHardTimer: ReturnType<typeof setTimeout> | null = null;
let clickMissingTimer: ReturnType<typeof setTimeout> | null = null;
/** 最近一次点击的 DOM 快照：超时/失败事件里带上它，事后不用再猜被谁挡住了。 */
let lastTargetSnapshot: Record<string, unknown> | null = null;

// —— 埋点包一层：任何埋点异常都绝不能影响「选文件」本身 ——

function safeCaptureError(...args: Parameters<typeof telemetry.captureError>) {
  try {
    telemetry.captureError(...args);
  } catch {
    // 忽略
  }
}

function markPickerPending() {
  try {
    telemetry.markPending('file-picker', '等待用户选择文件', {});
  } catch {
    // 忽略
  }
}

function clearPickerPending() {
  try {
    telemetry.clearPending('file-picker');
    telemetry.clearPending('file-prepare');
  } catch {
    // 忽略
  }
}

function currentContextKey(): number | string | null {
  return props.contextKey ?? null;
}

/** 把文件挂到「待补发」队列，并记住它属于哪个会话。 */
function queuePending(files: File[]) {
  pendingFiles = files;
  pendingContextKey = currentContextKey();
}

/** 把文件交给父组件；卸载/失败时转存，等重建后补发。 */
function deliver(files: File[]) {
  if (files.length === 0) {
    chatFileFlowStep('file-deliver-empty', { reason: 'no-valid-files' }, 'warn');
    abortChatFileUploadFlow('no-valid-files');
    return;
  }

  if (unmounted) {
    queuePending(files);
    chatFileFlowStep('file-pending-resend', { count: files.length, reason: 'unmounted' }, 'warn');
    abortChatFileUploadFlow('component-unmounted', { count: files.length });
    return;
  }

  try {
    emit('fileSelected', files);
    chatFileFlowStep('files-delivered', {
      count: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      note: '已交给 MessagePanel，后续阶段由上传逻辑继续记录',
    }, 'debug');
  } catch (error) {
    queuePending(files);
    chatFileFlowStep('file-deliver-failed', {
      count: files.length,
      message: error instanceof Error ? error.message : String(error),
    }, 'error');
    safeCaptureError('file-deliver-failed', error, {
      note: '交付失败，文件已暂存，待组件重建后补发',
      fileCount: files.length,
    });
    abortChatFileUploadFlow('deliver-failed', { count: files.length });
  }
}

/** 有攒下的文件且当前空闲时补发。 */
function flushPending() {
  if (unmounted || pendingFiles.length === 0 || isBlocked.value) return;

  // 会话已经换了：这批文件属于上一个会话，补发就等于发错地方
  if (pendingContextKey !== currentContextKey()) {
    const count = pendingFiles.length;
    pendingFiles = [];
    pendingContextKey = null;
    chatFileFlowStep('file-pending-dropped', { count, reason: 'conversation-changed' }, 'warn');
    abortChatFileUploadFlow('conversation-changed', { count });
    ElMessage.warning('已切换会话，之前选择的文件未发送');
    return;
  }

  const files = pendingFiles;
  pendingFiles = [];
  pendingContextKey = null;
  startChatFileUploadFlow({ source: 'pending-resend', meta: { count: files.length } });
  chatFileFlowStep('file-pending-resend', { count: files.length, reason: 'flush' }, 'warn');
  void processFiles(files);
}

/**
 * 让出一帧再干活：等原生选择器彻底关闭、页面先画完这一帧。
 *
 * 注意 rAF 在页面不可见时不会触发（选文件期间页面可能被挂起），
 * 所以必须带超时兜底，否则 change 回来后会永远卡在这里。
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, 200);

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        clearTimeout(timer);
        finish();
      });
    } else {
      clearTimeout(timer);
      finish();
    }
  });
}

async function processFiles(files: File[]) {
  if (files.length === 0) return;

  // 忙/禁用时先存着，等解除后补发 —— 用户选的文件绝不静默丢弃
  if (isBlocked.value) {
    queuePending(files);
    chatFileFlowStep('file-busy-queued', {
      count: files.length,
      preparing: preparing.value,
      propsDisabled: Boolean(props.disabled),
      note: '选完文件时按钮仍处于禁用/处理中，先暂存',
    }, 'warn');
    return;
  }

  // 关键：不要在 change 的同一个任务里就开始解码/转码。
  // 手机上选择器还在收尾，此时同步开一张大画布既卡顿又容易 OOM。
  await nextFrame();
  if (isBlocked.value) {
    queuePending(files);
    chatFileFlowStep('file-busy-queued', {
      count: files.length,
      reason: 'blocked-after-frame',
      note: '等待下一帧期间按钮被占用，先暂存',
    }, 'warn');
    return;
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  chatFileFlowStep('file-select', {
    count: files.length,
    totalBytes,
    names: files.slice(0, 5).map((file) => file.name),
    types: files.slice(0, 5).map((file) => file.type || 'unknown'),
    pageVisibility: document.visibilityState,
    pickerSignaled: pickerSignalSeen,
    sinceInputClickMs: inputClickAt ? Date.now() - inputClickAt : null,
  }, 'info');

  try {
    telemetry.markPending('file-prepare', '文件预处理', { count: files.length, totalBytes });
  } catch {
    // 忽略
  }

  chatFileFlowStep('file-prepare-start', { count: files.length, totalBytes }, 'debug');
  preparing.value = true;
  const startedAt = Date.now();

  try {
    const { files: validFiles, invalidFiles, failedFiles } = await prepareFilesForMessageUpload(files);

    chatFileFlowStep('file-prepare-done', {
      durationMs: Date.now() - startedAt,
      valid: validFiles.length,
      invalid: invalidFiles.length,
      failed: failedFiles.length,
      errors: [...invalidFiles, ...failedFiles].slice(0, 5),
    }, failedFiles.length > 0 ? 'warn' : 'info');

    invalidFiles.forEach(({ name, error }) => {
      ElMessage.warning(`${name}: ${error}`);
    });
    failedFiles.forEach(({ name }) => {
      ElMessage.error(`${name}: 处理失败`);
    });

    deliver(validFiles);
  } catch (error) {
    chatFileFlowStep('file-prepare-failed', {
      durationMs: Date.now() - startedAt,
      fileCount: files.length,
      message: error instanceof Error ? error.message : String(error),
    }, 'error');
    safeCaptureError('file-prepare-failed', error, {
      durationMs: Date.now() - startedAt,
      fileCount: files.length,
    });
    abortChatFileUploadFlow('prepare-failed', { fileCount: files.length });
    ElMessage.error('文件处理失败');
  } finally {
    preparing.value = false;
    try {
      telemetry.clearPending('file-prepare');
    } catch {
      // 忽略
    }
    flushPending();
  }
}

// —— 选择器 / 点击诊断 ——

/** 点击是否落在 input 的命中区内（input 比视觉按钮大一圈，必须按 input 的 rect 算）。 */
function insideTrigger(x: number, y: number): boolean {
  // 同时看 input 与视觉按钮：正常情况下 input 的 44px 命中区更大；
  // 万一 input 被样式/disabled 弄成 0×0，视觉按钮仍在，不能因此漏掉「点了没反应」。
  const targets = [inputRef.value, rootRef.value]
    .filter((element): element is HTMLElement => Boolean(element));
  return targets.some((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  });
}

function clearClickMissingTimer() {
  if (clickMissingTimer !== null) {
    clearTimeout(clickMissingTimer);
    clickMissingTimer = null;
  }
}

function clearPickerSignalTimers() {
  if (pickerMissingTimer !== null) {
    clearTimeout(pickerMissingTimer);
    pickerMissingTimer = null;
  }
  if (pickerHardTimer !== null) {
    clearTimeout(pickerHardTimer);
    pickerHardTimer = null;
  }
}

function scheduleClickMissingCheck() {
  clearClickMissingTimer();
  const startedAt = pointerDownAt;
  clickMissingTimer = setTimeout(() => {
    clickMissingTimer = null;
    if (inputClickSeen || Date.now() - startedAt < CLICK_MISSING_MS - 50) return;

    chatFileFlowStep('input-click-missing', {
      sincePointerDownMs: Date.now() - startedAt,
      pointerDownTargetInsideInput,
      note: 'pointerdown 已到达按钮区域，但没有收到 file input 的 click：点击可能被上层元素拦截',
      target: lastTargetSnapshot,
    }, 'error');
    abortChatFileUploadFlow('input-click-missing', {
      sincePointerDownMs: Date.now() - startedAt,
      pointerDownTargetInsideInput,
    });
  }, CLICK_MISSING_MS);
}

/**
 * 原生 pointerdown 诊断。
 *
 * 挂在 document 捕获阶段而不是 input 上：如果 input 被别的元素盖住，
 * 事件根本到不了 input，只有从 document 才能看到「用户确实点了这个位置」以及「点到了谁」。
 */
function handleDocumentPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (!event.isPrimary) return;
  if (!insideTrigger(event.clientX, event.clientY)) return;

  const point = { x: event.clientX, y: event.clientY };
  const input = inputRef.value;
  const pointerDownOnInput = Boolean(
    input && event.target instanceof Node && input.contains(event.target as Node),
  );

  pointerDownAt = Date.now();
  pointerDownTargetInsideInput = pointerDownOnInput;
  inputClickSeen = false;

  const snapshot = describeUploadTarget(input, point);
  lastTargetSnapshot = snapshot;

  // 先开流程再记第一步：即使后面判定被拦截，流程记录里也有完整的「点了什么」。
  startChatFileUploadFlow({ source: 'input' });
  chatFileFlowStep('trigger-pointerdown', {
    isTrusted: event.isTrusted,
    pointerType: event.pointerType,
    button: event.button,
    buttons: event.buttons,
    pointerDownOnInput,
    defaultPrevented: event.defaultPrevented,
    activation: describeUserActivation(),
    blocked: isBlocked.value,
    preparing: preparing.value,
    propsDisabled: Boolean(props.disabled),
    target: snapshot,
  }, 'debug');

  // 事件派发结束后再看一次：如果被别的处理器 preventDefault，
  // Chrome 可能不再合成 click —— 选择器自然也不会打开。
  window.setTimeout(() => {
    if (!event.defaultPrevented) return;
    chatFileFlowStep('pointerdown-prevented', {
      note: 'pointerdown 被 preventDefault：兼容鼠标事件（含 click）可能不会生成，浏览器不会唤起选择器',
    }, 'warn');
  }, 0);

  if (isBlocked.value) {
    chatFileFlowStep('trigger-blocked', {
      reason: props.disabled ? 'prop-disabled' : preparing.value ? 'preparing' : 'busy',
      note: 'input 处于 disabled，浏览器不会唤起选择器（常见于上一批上传卡住）',
      preparing: preparing.value,
      propsDisabled: Boolean(props.disabled),
    }, 'warn');
    abortChatFileUploadFlow('input-disabled', {
      preparing: preparing.value,
      propsDisabled: Boolean(props.disabled),
    });
    return;
  }

  scheduleClickMissingCheck();
}

/** 触屏兜底：部分内核 pointer 事件不全，touchstart 是最后的证据。 */
function handleDocumentTouchStart(event: TouchEvent) {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch || !insideTrigger(touch.clientX, touch.clientY)) return;

  if (!hasActiveChatFileUploadFlow()) {
    if (isBlocked.value) return;
    // pointerdown 已经处理过同一个手势（可能刚判定被拦截并收尾），不要另起一个流程
    if (pointerDownAt && Date.now() - pointerDownAt < 500) return;
    startChatFileUploadFlow({ source: 'touch' });
  }

  chatFileFlowStep('trigger-touchstart', {
    isTrusted: event.isTrusted,
    touches: event.touches.length,
    targetInsideInput: Boolean(
      inputRef.value && event.target instanceof Node && inputRef.value.contains(event.target as Node),
    ),
    defaultPrevented: event.defaultPrevented,
  }, 'debug');

  window.setTimeout(() => {
    if (!event.defaultPrevented) return;
    chatFileFlowStep('touchstart-prevented', {
      note: 'touchstart 被 preventDefault：部分内核会连 click / pointer 一起取消',
    }, 'warn');
  }, 0);
}

/** 点击命中了按钮区域、但目标不是 input：记录「被谁挡住」，并等待 click-missing 兜底。 */
function handleDocumentClick(event: MouseEvent) {
  if (!insideTrigger(event.clientX, event.clientY)) return;

  const input = inputRef.value;
  const onInput = Boolean(input && event.target instanceof Node && input.contains(event.target as Node));
  if (onInput) return;

  chatFileFlowStep('trigger-click-blocked', {
    isTrusted: event.isTrusted,
    detail: event.detail,
    note: '点击落在按钮命中区内，但目标不是 file input',
    point: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
    target: describeUploadTarget(input, { x: event.clientX, y: event.clientY }),
  }, 'warn');
}

/**
 * 记录「选择器真的打开了」的信号。
 *
 * 移动端 Chrome 打开文件选择器时页面会失去焦点：有的版本发 blur，
 * 有的发 visibilitychange(hidden)，个别还会 pagehide。三个都没有、
 * 随后也没有 change，就是「浏览器没唤起文件管理器」的强证据。
 */
function recordPickerSignal(signal: string) {
  if (pickerClosed || pickerSignalSeen) return;
  if (!inputClickAt) return;

  const sinceClickMs = Date.now() - inputClickAt;
  if (sinceClickMs > PICKER_SIGNAL_WINDOW_MS + 1000) return;

  pickerSignalSeen = true;
  pickerOpenedAt = Date.now();
  clearPickerSignalTimers();

  chatFileFlowStep('picker-open-signal', {
    signal,
    sinceClickMs,
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
  }, 'info');

  // 页面可能马上被系统挂起：把这一步立刻发出去（本地也会落盘）
  try {
    telemetry.flush(true);
  } catch {
    // 忽略
  }
}

function handleWindowBlur() {
  recordPickerSignal('window-blur');
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    recordPickerSignal('visibilitychange-hidden');
    return;
  }
  if (!pickerClosed) schedulePickerReturnCheck('visibilitychange-visible');
}

function handlePageHide() {
  recordPickerSignal('pagehide');
}

function beginPickerAttempt() {
  pickerClosed = false;
  pickerSession += 1;
  pickerAttempt += 1;
  pickerSignalSeen = false;
  pickerOpenedAt = 0;
  clearPickerSignalTimers();

  const attempt = pickerAttempt;
  pickerMissingTimer = setTimeout(() => {
    pickerMissingTimer = null;
    if (pickerClosed || pickerSignalSeen || attempt !== pickerAttempt) return;
    chatFileFlowStep('picker-signal-missing', {
      windowMs: PICKER_SIGNAL_WINDOW_MS,
      note: 'input click 后没有收到 blur / visibilitychange / pagehide，选择器可能没有打开',
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
      target: lastTargetSnapshot,
    }, 'warn');
  }, PICKER_SIGNAL_WINDOW_MS);

  pickerHardTimer = setTimeout(() => {
    pickerHardTimer = null;
    if (pickerClosed || pickerSignalSeen || attempt !== pickerAttempt) return;
    const waitedMs = Date.now() - (inputClickAt || Date.now());
    if (document.hasFocus()) {
      chatFileFlowStep('picker-not-opened', {
        waitedMs,
        note: '5 秒内没有选择器打开信号、也没有 change，且页面仍持有焦点：判定浏览器没有唤起文件管理器',
        target: lastTargetSnapshot,
      }, 'error');
    } else {
      // 页面已失焦，说明大概率真的切走了（选择器可能已打开），只是没捕获到信号。
      // 不要误报成「没打开」，留给后续 change / 返回页面来判定。
      chatFileFlowStep('picker-open-unconfirmed', {
        waitedMs,
        note: '5 秒内没有捕获到打开信号，但页面已经失焦：选择器可能已打开，不判定失败',
      }, 'warn');
    }
  }, PICKER_NOT_OPENED_MS);
}

/**
 * 选择器关闭后页面会重新聚焦。若此时仍没收到 change，判定为「用户取消」；
 * 如果连打开信号都没有，那就是「根本没打开」。
 * 只清埋点标记 —— 绝不像旧实现那样把 input 从 DOM 里摘掉。
 */
function schedulePickerReturnCheck(source: string) {
  if (pickerClosed) return;

  const session = pickerSession;
  if (pickerRestoreTimer !== null) clearTimeout(pickerRestoreTimer);
  pickerRestoreTimer = setTimeout(() => {
    pickerRestoreTimer = null;
    if (pickerClosed || session !== pickerSession) return;

    const sinceClickMs = inputClickAt ? Date.now() - inputClickAt : null;
    const openedMs = pickerOpenedAt ? Date.now() - pickerOpenedAt : null;
    pickerClosed = true;
    pickerAttempt += 1;
    clearPickerSignalTimers();
    clearClickMissingTimer();
    clearPickerPending();

    chatFileFlowStep('picker-return', {
      source,
      pickerWasSignaled: pickerSignalSeen,
      openedMs,
      sinceClickMs,
      visibility: document.visibilityState,
    }, 'debug');

    if (pickerSignalSeen) {
      chatFileFlowStep('picker-cancelled', {
        source,
        openedMs,
        note: '选择器打开后返回页面，但没有收到 change（用户取消）',
      }, 'info');
      abortChatFileUploadFlow('picker-cancelled', { source, openedMs }, 'info');
    } else {
      chatFileFlowStep('picker-not-opened', {
        source,
        sinceClickMs,
        note: '页面重新获得焦点，但从未收到选择器打开信号，也没有 change',
        target: lastTargetSnapshot,
      }, 'error');
      abortChatFileUploadFlow('picker-not-opened', { source, sinceClickMs });
    }
  }, PICKER_CANCEL_SETTLE_MS);
}

function handleWindowFocus() {
  if (!pickerClosed) schedulePickerReturnCheck('window-focus');
}

function handleInputFocus() {
  if (pickerClosed && !hasActiveChatFileUploadFlow()) return;
  chatFileFlowStep('input-focus', {
    sincePointerDownMs: pointerDownAt ? Date.now() - pointerDownAt : null,
    visibility: document.visibilityState,
  }, 'debug');
}

function handleInputClick(event: MouseEvent) {
  inputClickSeen = true;
  inputClickAt = Date.now();
  clearClickMissingTimer();

  // 键盘激活 / 程序触发时可能没有 pointerdown，这里补一个流程
  if (!hasActiveChatFileUploadFlow()) {
    startChatFileUploadFlow({
      source: 'input',
      meta: { note: 'click 之前没有记录到 pointerdown（键盘激活或程序触发）' },
    });
  }

  chatFileFlowStep('input-click', {
    isTrusted: event.isTrusted,
    detail: event.detail,
    defaultPrevented: event.defaultPrevented,
    sincePointerDownMs: pointerDownAt ? Date.now() - pointerDownAt : null,
    pointerDownTargetInsideInput,
    activation: describeUserActivation(),
    disabled: Boolean(inputRef.value?.disabled),
    blocked: isBlocked.value,
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
  }, 'info');

  if (isBlocked.value) {
    chatFileFlowStep('trigger-blocked', {
      reason: 'input-disabled-at-click',
      note: 'input 已 disabled，浏览器不会唤起选择器',
      preparing: preparing.value,
      propsDisabled: Boolean(props.disabled),
    }, 'warn');
    abortChatFileUploadFlow('input-disabled', {
      preparing: preparing.value,
      propsDisabled: Boolean(props.disabled),
    });
    return;
  }

  // 注意：这里只留痕，不做任何 preventDefault / stopPropagation，
  // 也不能在这里操作 DOM —— 任何多余动作都可能打断浏览器原生的唤起流程。
  beginPickerAttempt();
  markPickerPending();
  chatFileFlowStep('file-picker-open', {
    visibility: document.visibilityState,
    activation: describeUserActivation(),
  }, 'debug');

  if (pickerMarkerTimer !== null) clearTimeout(pickerMarkerTimer);
  // 兜底：某些内核对「取消选择」什么都不发，标记不能一直挂着
  pickerMarkerTimer = setTimeout(() => {
    pickerMarkerTimer = null;
    if (!pickerClosed && !pickerSignalSeen) {
      chatFileFlowStep('picker-timeout', {
        waitedMs: 120_000,
        note: '2 分钟内既没有选择器打开信号，也没有 change / 取消',
        target: lastTargetSnapshot,
      }, 'warn');
    }
    clearPickerPending();
  }, 120_000);
}

function handleChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;

  // 必须同步读出 files 并立刻清空 value：
  // 清空才能让「同一个文件再选一次」也触发 change；File 引用已经拿到，不受影响。
  const files = Array.from(input.files ?? []);
  input.value = '';

  const pickerWasSignaled = pickerSignalSeen;
  const sinceClickMs = inputClickAt ? Date.now() - inputClickAt : null;

  pickerClosed = true;
  pickerSession += 1;
  pickerAttempt += 1;
  clearPickerSignalTimers();
  clearClickMissingTimer();
  if (pickerRestoreTimer !== null) {
    clearTimeout(pickerRestoreTimer);
    pickerRestoreTimer = null;
  }
  if (pickerMarkerTimer !== null) {
    clearTimeout(pickerMarkerTimer);
    pickerMarkerTimer = null;
  }
  clearPickerPending();

  if (!hasActiveChatFileUploadFlow()) {
    startChatFileUploadFlow({
      source: 'input',
      meta: { note: 'change 之前没有记录到流程，补一个' },
    });
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  chatFileFlowStep('file-change', {
    count: files.length,
    totalBytes,
    names: files.slice(0, 5).map((file) => file.name),
    types: files.slice(0, 5).map((file) => file.type || 'unknown'),
    pickerWasSignaled,
    sinceClickMs,
    visibility: document.visibilityState,
  }, files.length === 0 ? 'debug' : 'info');

  if (files.length === 0) {
    // 在选择器里点了取消
    chatFileFlowStep('file-select-cancelled', { source: 'change', pickerWasSignaled }, 'debug');
    abortChatFileUploadFlow('picker-cancelled', { source: 'change', pickerWasSignaled }, 'info');
    return;
  }

  void processFiles(files);
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown, { capture: true, passive: true });
  document.addEventListener('touchstart', handleDocumentTouchStart, { capture: true, passive: true });
  document.addEventListener('click', handleDocumentClick, { capture: true, passive: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleWindowFocus, { passive: true });
  window.addEventListener('blur', handleWindowBlur, { passive: true });
  window.addEventListener('pagehide', handlePageHide, { passive: true });
  flushPending();
});

onBeforeUnmount(() => {
  unmounted = true;

  document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  document.removeEventListener('touchstart', handleDocumentTouchStart, true);
  document.removeEventListener('click', handleDocumentClick, true);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('focus', handleWindowFocus);
  window.removeEventListener('blur', handleWindowBlur);
  window.removeEventListener('pagehide', handlePageHide);

  if (pendingFiles.length > 0 || !pickerClosed || preparing.value) {
    chatFileFlowStep('component-unmounted', {
      pickerClosed,
      pendingFiles: pendingFiles.length,
      preparing: preparing.value,
      note: '上传流程在组件卸载时仍未结束',
    }, 'warn');
    abortChatFileUploadFlow('component-unmounted', {
      pendingFiles: pendingFiles.length,
      pickerClosed,
    });
  }

  if (pickerMarkerTimer !== null) {
    clearTimeout(pickerMarkerTimer);
    pickerMarkerTimer = null;
  }
  if (pickerRestoreTimer !== null) {
    clearTimeout(pickerRestoreTimer);
    pickerRestoreTimer = null;
  }
  clearPickerSignalTimers();
  clearClickMissingTimer();
  clearPickerPending();
});

// 父组件解除禁用（例如上一批文件传完）后，把攒下的文件补发出去
watch(isBlocked, (blocked) => {
  if (!blocked) flushPending();
});
</script>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

.file-upload-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  /* 去掉移动端双击缩放带来的 300ms 延迟与误触 */
  touch-action: manipulation;
}

.upload-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  touch-action: manipulation;
}

/* 视觉层不吃事件，点击全部落到下面那个透明 input 上 */
.upload-visual {
  pointer-events: none;
}

/**
 * 铺满按钮的透明原生 input。
 * ⚠️ 这里**不能**改成 display:none / visibility:hidden ——
 * 那正是旧实现在手机端点不出选择器的原因。
 *
 * `inset: -6px` 是刻意的：EP 按钮只有 32px，低于触屏 44px 的最小点击区，
 * 手指偏几像素就点不中（表现为「点了没反应」）。把透明层向外扩 6px
 * 得到 44×44 的命中区，视觉尺寸不变，也不会压到输入框
 * （composer 的 gap 正好是 6px）。
 */
.native-file-input {
  position: absolute;
  inset: -6px;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
  /* 避免个别内核把原生控件文字撑出来 */
  font-size: 0;
  z-index: 2;
  touch-action: manipulation;

  &:disabled {
    cursor: not-allowed;
  }

  // 移动端（手机/平板）按钮只有 24px（见 features/chat/style/index.scss 的
  // --chat-control-h），而触屏最小可点区是 44px —— 这里按同一公式反算外扩量，
  // 视觉尺寸不变、命中区仍是 44px。
  //   (44px - 24px) / 2 = 10px
  @include rp.device-mobile {
    inset: calc((44px - var(--chat-control-h, 24px)) / -2);
  }
}
</style>
