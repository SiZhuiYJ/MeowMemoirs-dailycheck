<!--
  文件选择按钮。

  要点：`<input type="file">` 改为「点击时动态创建并挂到 body」，
  不再依赖组件自身的生命周期。原因见下方注释——旧写法在
  「选文件期间组件被卸载」的场景下会直接丢掉用户选好的文件。
-->
<template>
  <div class="file-upload-button">
    <el-tooltip content="发送文件" placement="top">
      <el-button circle :loading="uploading" :disabled="disabled" @click="triggerFileSelect">
        <el-icon>
          <Paperclip />
        </el-icon>
      </el-button>
    </el-tooltip>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Paperclip } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { telemetry } from '@/libs/telemetry';
import { prepareFilesForMessageUpload } from '../utils/fileUpload';

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  fileSelected: [files: File[]];
}>();

const ACCEPT = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.7z';

const uploading = ref(false);

/**
 * 选择文件期间如果组件被卸载（会话切换、列表刷新、移动端返回等），
 * 旧实现里 input 会随组件一起销毁，change 事件永远不触发，
 * 用户表现为「选完文件回来界面刷新了，文件没发出去，还得重新选」。
 * 这里把已选文件暂存到模块级变量，组件重建后自动补发。
 */
let pendingFiles: File[] = [];

function deliverFiles(files: File[]) {
  if (files.length === 0) return;
  try {
    emit('fileSelected', files);
  } catch (error) {
    pendingFiles = files;
    telemetry.captureError('file-deliver-failed', error, {
      note: '组件已卸载，文件暂存待重建后补发',
      fileCount: files.length,
    });
  }
}

async function handlePickedFiles(files: File[]) {
  if (files.length === 0) return;

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  telemetry.track('file', 'file-select', {
    count: files.length,
    totalBytes,
    names: files.slice(0, 5).map((file) => file.name),
    pageVisibility: document.visibilityState,
  }, 'info');
  telemetry.markPending('file-prepare', '文件预处理', { count: files.length, totalBytes });

  uploading.value = true;
  const startedAt = Date.now();
  try {
    const { files: validFiles, invalidFiles, failedFiles } = await prepareFilesForMessageUpload(files);

    telemetry.track('file', 'file-prepare-done', {
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

    deliverFiles(validFiles);
  } catch (error) {
    telemetry.captureError('file-prepare-failed', error, {
      durationMs: Date.now() - startedAt,
      fileCount: files.length,
    });
    ElMessage.error('文件处理失败');
  } finally {
    telemetry.clearPending('file-prepare');
    uploading.value = false;
  }
}

function triggerFileSelect() {
  if (props.disabled) return;

  // 动态创建 input 并挂到 body：即使本组件在文件选择期间被卸载，
  // change 回调依然有效（回调持有 files，与 DOM 生命周期无关）。
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = ACCEPT;
  input.style.display = 'none';

  let settled = false;
  const cleanup = () => {
    input.remove();
  };

  input.addEventListener('change', () => {
    settled = true;
    const files = Array.from(input.files || []);
    cleanup();
    void handlePickedFiles(files);
  });

  // 用户取消选择：回到前台后仍未收到 change 就清掉临时节点
  window.addEventListener('focus', () => {
    window.setTimeout(() => {
      if (!settled) {
        cleanup();
        telemetry.track('file', 'file-select-cancelled', {}, 'debug');
      }
    }, 1500);
  }, { once: true });

  document.body.appendChild(input);

  telemetry.markPending('file-picker', '等待用户选择文件', {});
  telemetry.track('file', 'file-picker-open', { visibility: document.visibilityState }, 'debug');

  input.click();
  // 选择完成后取消「等待选择」标记（change 回调里也可能已经清掉）
  window.setTimeout(() => telemetry.clearPending('file-picker'), 60_000);
}

onMounted(() => {
  // 组件重建后补发上次未送达的文件
  if (pendingFiles.length > 0) {
    const files = pendingFiles;
    pendingFiles = [];
    telemetry.track('file', 'file-resend-after-remount', { count: files.length }, 'warn');
    void handlePickedFiles(files);
  }
});
</script>

<style scoped lang="scss">
.file-upload-button {
  display: inline-flex;
  align-items: center;
}
</style>
