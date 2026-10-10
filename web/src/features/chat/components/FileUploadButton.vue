<template>
  <div class="file-upload-button">
    <el-tooltip content="发送文件" placement="top">
      <el-button circle @click="triggerFileSelect" :loading="uploading" :disabled="disabled">
        <el-icon>
          <Paperclip />
        </el-icon>
      </el-button>
    </el-tooltip>
    <input ref="fileInputRef" type="file" multiple
      accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.7z" style="display: none"
      @change="handleFileSelect" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Paperclip } from '@element-plus/icons-vue';
import { prepareFilesForMessageUpload } from '../utils/fileUpload';

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  fileSelected: [files: File[]];
}>();

const fileInputRef = ref<HTMLInputElement>();
const uploading = ref(false);

function triggerFileSelect() {
  if (props.disabled) return;
  fileInputRef.value?.click();
}

async function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);

  if (files.length === 0) {
    input.value = '';
    return;
  }

  uploading.value = true;
  try {
    const { files: validFiles, invalidFiles, failedFiles } = await prepareFilesForMessageUpload(files);

    invalidFiles.forEach(({ name, error }) => {
      ElMessage.warning(`${name}: ${error}`);
    });
    failedFiles.forEach(({ name }) => {
      ElMessage.error(`${name}: 处理失败`);
    });

    if (validFiles.length > 0) {
      emit('fileSelected', validFiles);
    }
  } finally {
    // 清空input，允许重复选择同一文件
    input.value = '';
    uploading.value = false;
  }
}
</script>

<style scoped lang="scss">
.file-upload-button {
  display: inline-flex;
  align-items: center;
}
</style>
