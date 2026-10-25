<script setup lang="ts">
/**
 * 文件消息详情面板（外壳）。
 *
 * 承载「文件消息（音频 / 文档 / 压缩包…）点开之后」的全部操作：
 * 下载按钮从消息卡片里撤掉、收进这里，预览也从这里发起。
 * 内容由 FileMessageDetailBody.vue 提供，本文件只负责套上聊天页统一的
 * ChatDialog 外壳。
 *
 * ## 形态
 *
 * 以前是「手机 el-drawer 底部抽屉 / 平板·电脑 el-dialog 居中对话框」两套外壳；
 * 现在统一成自适应高度的 ChatDialog（顶部 .chat-header / 中间 .el-scrollbar /
 * 底部 .composer）：内容少时是一张居中卡片，内容多才撑满窗口，三种设备结构一致：
 *
 *   - 不再需要按 isPhoneTier / isPhone 切外壳，少一条判定分支；
 *   - 抽屉高度按内容撑开的问题、超长文件名被关闭按钮压住的问题一并消失；
 *   - 弹层里只有一个滚动区（.chat-dialog-scrollbar），不再出现双层滚动。
 */
import FileMessageDetailBody from './FileMessageDetailBody.vue';
import ChatDialog from './ChatDialog.vue';

const props = withDefaults(
  defineProps<{
    /** 文件名，同时作为标题栏文本（过宽省略）。 */
    fileName: string;
    /** 字节数。 */
    fileSize: number;
    /** 中文类型文案，例如「PDF」「音频」。 */
    typeLabel: string;
    /** 缩略图图标（SvgIcon 的 iconClass）。 */
    iconClass: string;
    /** 发送时间（ISO 字符串）。 */
    sentAt?: string | null;
    /** 预览不可用（该类型不支持 / 文件过大）。 */
    previewDisabled?: boolean;
    /** 预览不可用的原因。 */
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

const visible = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  download: [];
  preview: [];
}>();
</script>

<template>
  <ChatDialog v-model="visible" :title="fileName" content-width="520px">
    <FileMessageDetailBody :file-size="fileSize" :type-label="typeLabel" :icon-class="iconClass" :sent-at="sentAt"
      :preview-disabled="previewDisabled" :preview-hint="previewHint" :download-disabled="downloadDisabled"
      @download="emit('download')" @preview="emit('preview')" />

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </ChatDialog>
</template>
