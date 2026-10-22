<script setup lang="ts">
/**
 * 文件详情面板的**内容**（缩略图 icon、大小、发送时间、下载/预览按钮）。
 *
 * 单独拆出来是为了让「抽屉」和「对话框」两种外壳**共用同一份内容**：
 * 外壳（FileMessageDetail.vue）只负责决定用 el-drawer 还是 el-dialog，
 * 字段和按钮样式不会因为写了两份而漂移。
 *
 * 不用 `<component :is>` 动态组件的原因：那样得从 element-plus 里**显式导入**
 * ElDrawer / ElDialog，而本项目的 Element Plus 是按需引入（unplugin-vue-components
 * + ElementPlusResolver），样式跟着模板标签注入 —— 动态组件绕开了静态分析，
 * 抽屉的 CSS 根本不会被引入，表现就是弹层不贴底（position 仍是 static）。
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
      <el-button class="file-detail-action" color="#111827" :disabled="previewDisabled" @click="emit('preview')">
        <el-icon>
          <View />
        </el-icon>
        <span>预览</span>
      </el-button>
    </div>
  </div>
</template>

<style scoped lang="scss">
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
  background: #f3f4f6;

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
  color: #4b5563;
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: #eef0f3;
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
</style>
