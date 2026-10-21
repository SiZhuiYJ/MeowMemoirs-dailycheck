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
  <div class="file-upload-button">
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
          （所以也不需要 ref：组件里不该再有任何 .click()。）
        -->
        <input class="native-file-input" type="file" multiple :accept="ACCEPT" :disabled="isBlocked" aria-label="发送文件"
          @click="handleInputClick" @change="handleChange" />
      </div>
    </el-tooltip>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Paperclip } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { telemetry } from '@/libs/telemetry';
import { prepareFilesForMessageUpload } from '../utils/fileUpload';

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

/** 与后端白名单一致：移动端把选择器收窄，能少一半误选。 */
const ACCEPT = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.7z';

/** 校验 + 预处理（图片转 WebP、视频抽帧）期间，不再接受新的选择。 */
const preparing = ref(false);

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

// —— 埋点全部包一层：任何埋点异常都绝不能影响「选文件」本身 ——

function safeTrack(...args: Parameters<typeof telemetry.track>) {
  try {
    telemetry.track(...args);
  } catch {
    // 忽略
  }
}

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
  if (files.length === 0) return;

  if (unmounted) {
    queuePending(files);
    safeTrack('file', 'file-pending-resend', { count: files.length, reason: 'unmounted' }, 'warn');
    return;
  }

  try {
    emit('fileSelected', files);
  } catch (error) {
    queuePending(files);
    safeCaptureError('file-deliver-failed', error, {
      note: '交付失败，文件已暂存，待组件重建后补发',
      fileCount: files.length,
    });
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
    safeTrack('file', 'file-pending-dropped', { count, reason: 'conversation-changed' }, 'warn');
    ElMessage.warning('已切换会话，之前选择的文件未发送');
    return;
  }

  const files = pendingFiles;
  pendingFiles = [];
  pendingContextKey = null;
  safeTrack('file', 'file-pending-resend', { count: files.length, reason: 'flush' }, 'warn');
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
    return;
  }

  // 关键：不要在 change 的同一个任务里就开始解码/转码。
  // 手机上选择器还在收尾，此时同步开一张大画布既卡顿又容易 OOM。
  await nextFrame();
  if (isBlocked.value) {
    queuePending(files);
    return;
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  safeTrack('file', 'file-select', {
    count: files.length,
    totalBytes,
    names: files.slice(0, 5).map((file) => file.name),
    pageVisibility: document.visibilityState,
  }, 'info');

  try {
    telemetry.markPending('file-prepare', '文件预处理', { count: files.length, totalBytes });
  } catch {
    // 忽略
  }

  preparing.value = true;
  const startedAt = Date.now();

  try {
    const { files: validFiles, invalidFiles, failedFiles } = await prepareFilesForMessageUpload(files);

    safeTrack('file', 'file-prepare-done', {
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
    safeCaptureError('file-prepare-failed', error, {
      durationMs: Date.now() - startedAt,
      fileCount: files.length,
    });
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

function handleChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;

  // 必须同步读出 files 并立刻清空 value：
  // 清空才能让「同一个文件再选一次」也触发 change；File 引用已经拿到，不受影响。
  const files = Array.from(input.files ?? []);
  input.value = '';

  pickerClosed = true;
  clearPickerPending();
  if (pickerRestoreTimer !== null) {
    clearTimeout(pickerRestoreTimer);
    pickerRestoreTimer = null;
  }

  if (files.length === 0) {
    // 在选择器里点了取消
    safeTrack('file', 'file-select-cancelled', { source: 'change' }, 'debug');
    return;
  }

  void processFiles(files);
}

function handleInputClick() {
  if (isBlocked.value) return;

  // 注意：这里只留痕，不做任何 preventDefault / stopPropagation，
  // 也不能在这里操作 DOM —— 任何多余动作都可能打断浏览器原生的唤起流程。
  pickerClosed = false;
  pickerSession += 1;

  markPickerPending();
  safeTrack('file', 'file-picker-open', { visibility: document.visibilityState }, 'debug');

  if (pickerMarkerTimer !== null) clearTimeout(pickerMarkerTimer);
  // 兜底：某些内核对「取消选择」什么都不发，标记不能一直挂着
  pickerMarkerTimer = setTimeout(clearPickerPending, 120_000);
}

/**
 * 选择器关闭后页面会重新聚焦。若此时仍没收到 change，判定为「用户取消」，
 * 只清埋点标记 —— 绝不像旧实现那样把 input 从 DOM 里摘掉。
 */
function handleWindowFocus() {
  if (pickerClosed) return;

  const session = pickerSession;
  if (pickerRestoreTimer !== null) clearTimeout(pickerRestoreTimer);
  pickerRestoreTimer = setTimeout(() => {
    pickerRestoreTimer = null;
    if (pickerClosed || session !== pickerSession) return;

    pickerClosed = true;
    clearPickerPending();
    safeTrack('file', 'file-select-cancelled', { source: 'focus' }, 'debug');
  }, 1200);
}

onMounted(() => {
  window.addEventListener('focus', handleWindowFocus, { passive: true });
  flushPending();
});

onBeforeUnmount(() => {
  unmounted = true;
  window.removeEventListener('focus', handleWindowFocus);

  if (pickerMarkerTimer !== null) {
    clearTimeout(pickerMarkerTimer);
    pickerMarkerTimer = null;
  }
  if (pickerRestoreTimer !== null) {
    clearTimeout(pickerRestoreTimer);
    pickerRestoreTimer = null;
  }
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
