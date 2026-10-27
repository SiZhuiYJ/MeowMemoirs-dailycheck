<script setup lang="ts">
/**
 * 文件详情面板的**内容**（缩略图 icon、大小、发送时间、下载/预览按钮）。
 *
 * 单独拆出来是为了让外壳（FileMessageDetail.vue）只负责套 ChatDialog 的
 * 「顶部栏 / 内容栏 / 底部栏」，文件名、大小、按钮这些字段与样式都留在这里，
 * 以后换外壳不会牵动内容。
 *
 * 按钮区在手机档改成两列铺满（见文件末尾的 device-mobile 块）：弹层里
 * 左右两个按钮各占一半，比缩在左边一小撮更好点。
 */
import { computed } from 'vue';
import { Download, View } from '@element-plus/icons-vue';
import SvgIcon from '@/components/SvgIcon/index.vue';
import { formatChatDateTime } from '../utils/chat';
import { formatFileSize } from '../utils/fileMeta';

const props = withDefaults(
  defineProps<{
    /** 字节数。 */
    fileSize: number;
    /** 中文类型文案，例如「PDF」「音频」。 */
    typeLabel: string;
    /** 缩略图图标（SvgIcon 的 iconClass），与消息卡片上的图标保持一致。 */
    iconClass: string;
    /** 发送时间（ISO 字符串）；缺省则不显示该行。 */
    sentAt?: string | null;
    /** 预览不可用（该类型不支持 / 文件过大）。 */
    previewDisabled?: boolean;
    /** 预览不可用的原因，显示在按钮上方。 */
    previewHint?: string;
    /** 下载不可用（拿不到 fileKey 等异常情况）。 */
    downloadDisabled?: boolean;
  }>(),
  {
    sentAt: '',
    previewDisabled: false,
    previewHint: '',
    downloadDisabled: false,
  },
);

const emit = defineEmits<{
  download: [];
  preview: [];
}>();

const sizeText = computed(() => formatFileSize(props.fileSize));
const sentAtText = computed(() => formatChatDateTime(props.sentAt));
</script>

<template>
  <div class="file-detail-body">
    <div class="file-detail-hero">
      <div class="file-detail-icon">
        <svg-icon :icon-class="iconClass" size="40px" />
      </div>
      <div class="file-detail-type">{{ typeLabel }}</div>
    </div>

    <dl class="file-detail-rows">
      <div class="file-detail-row">
        <dt>文件大小</dt>
        <dd>{{ sizeText }}</dd>
      </div>
      <div v-if="sentAtText" class="file-detail-row">
        <dt>发送时间</dt>
        <dd>{{ sentAtText }}</dd>
      </div>
    </dl>

    <p v-if="previewHint" class="file-detail-hint">{{ previewHint }}</p>

    <div class="file-detail-actions">
      <el-button class="file-detail-action" :disabled="downloadDisabled" @click="emit('download')">
        <el-icon>
          <Download />
        </el-icon>
        <span>下载</span>
      </el-button>
      <el-button class="file-detail-action" type="primary" :disabled="previewDisabled" @click="emit('preview')">
        <el-icon>
          <View />
        </el-icon>
        <span>预览</span>
      </el-button>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

.file-detail-body {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.file-detail-hero {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.file-detail-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  border-radius: 10px;
  background: var(--chat-inset);

  // 图标按盒子的百分比缩放：极窄屏（320px 抽屉）下也不会顶破
  :deep(.svg-icon) {
    width: 62%;
    height: 62%;
  }
}

.file-detail-type {
  min-width: 0;
  overflow: hidden;
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--chat-text-secondary);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--chat-inset);
}

.file-detail-rows {
  display: grid;
  gap: 8px;
  margin: 0;
}

.file-detail-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: 12px;

  dt {
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 20px;
  }

  dd {
    margin: 0;
    overflow: hidden;
    color: var(--el-text-color-primary);
    font-size: 13px;
    line-height: 20px;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.file-detail-hint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 18px;
}

.file-detail-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.file-detail-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

// 手机 / 平板：下载与预览各占一半，整行更好点按。
@include rp.device-mobile {
  .file-detail-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .file-detail-action {
    width: 100%;
  }
}
</style>
