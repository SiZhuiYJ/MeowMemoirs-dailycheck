<script setup lang="ts">
import ProgressiveAvatar from '@/components/ProgressiveAvatar/index.vue';
import { computed } from 'vue';
import { CircleCheck } from '@element-plus/icons-vue';
import type {
  MessageReference,
  MessageSummary,
  PendingTextMessage,
  PendingUpload,
} from '../types';
import {
  formatSystemMessageText,
  formatChatTimeShort,
  getMessagePreview,
  getMessageSenderName,
  getRecalledMessageText,
  parseServerTime,
} from '../utils/chat';
import FileMessage from './FileMessage.vue';

const props = defineProps<{
  message?: MessageSummary | null;
  /** 乐观发送中的本地文本消息（尚未拿到服务端 id）。 */
  pendingText?: PendingTextMessage | null;
  pendingUpload?: PendingUpload | null;
  meUserId: number;
  src: string;
  thumbnailSrc?: string;
  isMine: boolean;
  readText: string;
  readColor: string;
  replyTarget?: MessageSummary | MessageReference | null;
  replyTargetId?: number | null;
  allowInlineMediaLoad?: boolean;
  highlighted?: boolean;
}>();

const emit = defineEmits<{
  reply: [message: MessageSummary];
  recall: [message: MessageSummary];
  jumpToMessage: [messageId: number];
  retrySend: [tempId: number];
  discardSend: [tempId: number];
  /** 右键用户头像：打开「艾特 / 查看主页」菜单。 */
  avatarContextMenu: [payload: { event: MouseEvent; userId: number; name: string }];
}>();

const RECALL_WINDOW_MS = 5 * 60 * 1000;

const hasMessage = computed(() => Boolean(props.message || props.pendingText));
const isUploading = computed(() => props.pendingUpload?.status === 'uploading');
const isFailed = computed(() => props.pendingUpload?.status === 'failed');

const isTextSending = computed(() => props.pendingText?.status === 'sending');
const isTextFailed = computed(() => props.pendingText?.status === 'failed');

const messageType = computed(() =>
  props.pendingText?.messageType ??
  props.pendingUpload?.messageType ??
  props.message?.messageType ??
  'file',
);
/**
 * 文件类气泡的两种宽度策略（见 features/chat/style/index.scss 里 .msg-item 的注释）：
 *
 *   isFileBubble  卡片（音频 / 文档）：**撑满可用宽度**（最多 300px、最少 100px）。
 *                 卡片里是图标 + 文件名 + 元信息，撑开才排得下、也才整齐。
 *   isMediaBubble 媒体（图片 / 视频）：**贴合媒体自身尺寸**（同样夹在 300px / 100px 之间）。
 *                 图片只有 169px 宽时气泡就该是 169px —— 否则它会被放在一个 300px 宽的
 *                 透明盒子里，看起来贴在左边，离自己的头像隔着一大段空白。
 *
 * 文本气泡两者都不挂，继续贴合文字宽度。
 */
const isMediaBubble = computed(() =>
  messageType.value === 'image' || messageType.value === 'video',
);
const isFileBubble = computed(() =>
  isMediaBubble.value || messageType.value === 'audio' || messageType.value === 'file',
);
const senderName = computed(() =>
  props.pendingText?.senderNickName ||
  props.pendingUpload?.senderNickName ||
  props.message?.senderNickName ||
  String(
    props.pendingText?.senderUserId ??
    props.pendingUpload?.senderUserId ??
    props.message?.senderUserId ??
    '',
  ),
);
const createdAtText = computed(() =>
  formatChatTimeShort(
    props.pendingText?.createdAt ??
    props.pendingUpload?.createdAt ??
    props.message?.createdAt ??
    new Date().toISOString(),
  ),
);
const uploadProgress = computed(() => Math.round(props.pendingUpload?.progress ?? 0));
const canReply = computed(() => {
  const message = props.message;
  return Boolean(message && !message.isRecalled);
});
const isRecallWithinTimeLimit = computed(() => {
  if (!props.message) return false;
  const createdAt = parseServerTime(props.message.createdAt);
  if (!createdAt) return false;
  return Date.now() - createdAt.getTime() <= RECALL_WINDOW_MS;
});
const canRecall = computed(() => {
  const message = props.message;
  return Boolean(
    message &&
    props.isMine &&
    !message.isRecalled &&
    isRecallWithinTimeLimit.value,
  );
});
const recalledText = computed(() => props.message ? getRecalledMessageText(props.message) : '');
const isSystemMessage = computed(() =>
  Boolean(props.message && !props.message.isRecalled && props.message.messageType === 'system'),
);
const headerText = computed(() => {
  if (isTextSending.value) return '发送中';
  if (isTextFailed.value) return '发送失败';
  if (isUploading.value) return '发送中';
  if (isFailed.value) return '发送失败';
  if (props.message?.id) return `#${props.message.id}`;
  return '本地上传';
});

/** 气泡内容：本地乐观消息优先取 pendingText。 */
const bubbleContent = computed(
  () => props.message?.content ?? props.pendingText?.content ?? '',
);

function handleJumpToReply() {
  if (!props.replyTargetId) return;
  emit('jumpToMessage', props.replyTargetId);
}

function handleReply() {
  if (!props.message) return;
  emit('reply', props.message);
}

function handleRecall() {
  if (!props.message) return;
  emit('recall', props.message);
}

function handleRetrySend() {
  if (!props.pendingText) return;
  emit('retrySend', props.pendingText.tempId);
}

function handleDiscardSend() {
  if (!props.pendingText) return;
  emit('discardSend', props.pendingText.tempId);
}

/**
 * 右键头像：把发送者信息抛给消息面板，由面板决定菜单项。
 * 在这里 preventDefault/stopPropagation，避免同时弹出图片消息菜单和浏览器原生菜单。
 */
function handleAvatarContextMenu(event: MouseEvent) {
  const senderUserId = Number(
    props.pendingText?.senderUserId ??
    props.pendingUpload?.senderUserId ??
    props.message?.senderUserId ??
    0,
  );
  if (!senderUserId) return;

  event.preventDefault();
  event.stopPropagation();
  emit('avatarContextMenu', {
    event,
    userId: senderUserId,
    name: senderName.value,
  });
}
</script>

<template>
  <div v-if="hasMessage && props.message?.isRecalled"
    :class="['msg-item', 'system-notice-item', { highlighted: props.highlighted }]">
    <div class="recalled-message system-notice-text">
      {{ recalledText }}
    </div>
  </div>
  <div v-else-if="isSystemMessage" :class="['msg-item', 'system-notice-item', { highlighted: props.highlighted }]">
    <div class="system-notice-body">
      <div class="system-notice-text">
        {{ formatSystemMessageText(props.message?.content) }}
      </div>
      <div class="system-notice-time">{{ createdAtText }}</div>
    </div>
  </div>
  <div v-else
    :class="['msg-item', {
      mine: props.isMine,
      highlighted: props.highlighted,
      'local-pending': isTextSending,
      'local-failed': isTextFailed,
      'has-file': isFileBubble && !isMediaBubble,
      'has-media': isMediaBubble,
    }]">
    <ProgressiveAvatar class="message-avatar" :src="props.src || undefined"
      :thumbnail-src="props.thumbnailSrc || props.src || undefined" :size="40" shape="square"
      @contextmenu.prevent.stop="handleAvatarContextMenu">
      {{ senderName.slice(0, 1) }}
    </ProgressiveAvatar>
    <div class="content">
      <div class="meta header">
        <span class="header-text">
          {{ headerText }} · {{ senderName }} · {{ messageType }}
        </span>
        <div class="header-actions">
          <el-button v-if="canReply" link size="small" class="reply-action" @click="handleReply">
            引用
          </el-button>
          <el-button v-if="canRecall" link type="danger" size="small" class="reply-action" @click="handleRecall">
            撤回
          </el-button>
        </div>
      </div>

      <button v-if="props.replyTarget || props.replyTargetId" class="reply-card" type="button"
        @click="handleJumpToReply">
        <div class="reply-card-sender">
          {{ props.replyTarget ? getMessageSenderName(props.replyTarget) : `消息 #${props.replyTargetId}` }}
        </div>
        <div class="reply-card-preview">
          {{ props.replyTarget ? getMessagePreview(props.replyTarget) : '原消息不可用' }}
        </div>
      </button>

      <div class="bubble-wrap">
        <template v-if="isFileBubble">
          <FileMessage :message="props.message" :pending-upload="props.pendingUpload" :src
            :allow-inline-media-load="props.allowInlineMediaLoad" />
        </template>

        <div v-else-if="messageType === 'text'" class="bubble">
          {{ bubbleContent || '[空消息]' }}
        </div>

        <template v-else-if="props.message?.messageType === 'system'">
          <span class="system-message">{{ props.message.content || '[系统通知]' }}</span>
        </template>

        <template v-else>
          {{ bubbleContent || props.message?.extra || '[未知消息类型]' }}
        </template>

        <div class="meta foot">
          <span>{{ createdAtText }}</span>
          <template v-if="isTextSending">
            <span class="client-status uploading">发送中…</span>
          </template>
          <template v-else-if="isTextFailed">
            <span class="client-status failed">发送失败</span>
            <el-button link size="small" class="retry-action" @click="handleRetrySend">
              重试
            </el-button>
            <el-button link type="danger" size="small" class="retry-action" @click="handleDiscardSend">
              删除
            </el-button>
          </template>
          <span v-else-if="isUploading" class="client-status uploading">上传 {{ uploadProgress }}%</span>
          <span v-else-if="isFailed" class="client-status failed">发送失败</span>
          <template v-else-if="props.message && props.meUserId && props.message.senderUserId === props.meUserId">
            <el-icon>
              <CircleCheck :color="props.readColor" />
            </el-icon>
            <span v-if="props.readText" class="read-count">{{ props.readText }}</span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.content {
  min-width: 0;
}

.header {
  justify-content: space-between;
  gap: 12px;
}

.header-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
}

.reply-action {
  padding: 0;
}

.reply-action+.reply-action {
  margin-left: 8px;
}

.bubble-wrap {
  min-width: 0;
}

.reply-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 100%;
  margin-bottom: 3px;
  padding: 8px 10px;
  border: 0;
  border-left: 3px solid var(--chat-reply-border, #9ca3af);
  border-radius: 6px;
  border-bottom-left-radius: 0;
  border-top-left-radius: 0;
  color: var(--chat-muted, #6b7280);
  text-align: left;
  cursor: pointer;
  background: var(--chat-reply-bg, #e9ecef);
  transition: background-color 0.15s ease;

  &:hover {
    background: var(--chat-reply-hover, #e1e5e9);
  }
}

.reply-card-sender {
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  color: #4b5563;
}

.reply-card-preview {
  overflow: hidden;
  font-size: 11px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-status {
  // 原本 8px，实际几乎无法辨认
  font-size: 10px;
  font-weight: 500;

  &.uploading {
    color: #9a4f8d;
  }

  &.failed {
    color: #dc2626;
  }
}

.retry-action {
  padding: 0;
}

.retry-action+.retry-action {
  margin-left: 6px;
}

// 本地乐观消息：发送中略降透明度，失败时描边提示
.msg-item.local-pending :deep(.bubble),
.msg-item.local-pending .bubble {
  opacity: 0.66;
}

.msg-item.local-failed :deep(.bubble),
.msg-item.local-failed .bubble {
  border: 1px solid #fecaca;
  background: #fff5f5;
}

.recalled-message {
  padding: 12px 14px;
  border-radius: 10px;
  color: #6b7280;
  font-size: 13px;
  line-height: 20px;
  background: #f3f4f6;
}

.system-notice-item {
  display: flex;
  justify-content: center;
  max-width: 100%;
  width: 100%;
}

.system-notice-body {
  display: grid;
  justify-items: center;
  gap: 4px;
}

.system-notice-text {
  padding: 4px 12px;
  border-radius: 999px;
  color: #4b5563;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  background: rgba(107, 114, 128, 0.12);
}

.system-notice-time {
  color: #9ca3af;
  font-size: 10px;
  line-height: 16px;
}

.msg-item.mine .reply-card {
  border-left: 0;
  border-right: 3px solid var(--chat-accent, #9a4f8d);
  background: var(--chat-reply-self-bg, #eddfea);
  border-top-left-radius: 6px;
  border-bottom-left-radius: 6px;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;

  &:hover {
    background: var(--chat-reply-self-hover, #ebd5e7);
  }
}

.msg-item.mine .reply-card .reply-card-sender {
  color: var(--chat-accent, #9a4f8d);
}

.msg-item.mine .recalled-message {
  background: var(--chat-accent-soft, #f7e8f4);
}

// 点击引用跳转到原消息时，用主题色呼吸描边 + 主题浅底提示
.msg-item.highlighted :deep(.video-message),
.msg-item.highlighted :deep(.audio-message),
.msg-item.highlighted :deep(.document-message),
.msg-item.highlighted :deep(.image-message),
.msg-item.highlighted .bubble,
.msg-item.highlighted .reply-card,
.msg-item.highlighted .recalled-message,
.msg-item.highlighted .system-notice-text {
  box-shadow: 0 0 0 1px rgb(154 79 141 / 28%);
  animation: highlighted-blink 1.1s ease-in-out infinite alternate;
}

.msg-item.highlighted .bubble,
.msg-item.highlighted .reply-card,
.msg-item.highlighted .recalled-message,
.msg-item.highlighted .system-notice-text {
  background-color: var(--chat-highlight-bg, #e9d8e6) !important;
}

@keyframes highlighted-blink {
  from {
    box-shadow:
      0 0 1px 1px rgb(154 79 141 / 28%),
      0 0 6px rgb(154 79 141 / 18%);
    filter: brightness(1);
  }

  to {
    box-shadow:
      0 0 2px 2px rgb(154 79 141 / 55%),
      0 0 14px rgb(154 79 141 / 32%);
    filter: brightness(1.02);
  }
}
</style>
