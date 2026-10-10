<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
  useTemplateRef,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';
import { Document, UploadFilled } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores';
import MessageItem from './MessageItem.vue';
import FileMessage from './FileMessage.vue';
import FileUploadButton from './FileUploadButton.vue';
import ConversationDetailDialog from './ConversationDetailDialog.vue';
import type {
  ConversationDetail,
  ConversationDetailUpdateOptions,
  FileExtra,
  MessageReadStatus,
  MessageReference,
  MessageSummary,
  PendingUpload,
  SendMessagePayload,
} from '../types';
import {
  formatDateSeparator,
  getConversationDisplayTitle,
  getMemberAvatarBySender,
  getMemberAvatarSourcesBySender,
  getMessagePreview,
  getMessageSenderName,
} from '../utils/chat';
import {
  formatFileSize,
  getFilePreviewType,
} from '../utils/fileMeta';
import {
  prepareFilesForMessageUpload,
  uploadFileForMessage,
  validateFile,
} from '../utils/fileUpload';

const model = defineModel<string>({ default: '' });
const currentConversation = defineModel<ConversationDetail>('conversationDetail');

interface GalleryFile {
  name: string;
  url: string;
  type: string;
  path?: string;
  messageId?: number;
}

interface DroppedFileItem {
  file: File;
  name: string;
  sizeText: string;
  typeText: string;
  valid: boolean;
  error?: string;
}

type RenderedChatItem =
  | {
    kind: 'message';
    key: string;
    createdAt: string;
    message: MessageSummary;
  }
  | {
    kind: 'pending';
    key: string;
    createdAt: string;
    pendingUpload: PendingUpload;
  };

interface MessageGroup {
  dateLabel: string;
  items: RenderedChatItem[];
}

const props = defineProps<{
  messages: MessageSummary[];
  meUserId?: number;
  loading: boolean;
  showBackToList?: boolean;
  replyingMessage?: MessageSummary | null;
  messageReadStatus?: Map<number, MessageReadStatus>;
  readInfoMap?: Map<number, { readText: string; readColor: string }>;
  sendMessageHandler?: (payload: SendMessagePayload) => Promise<MessageSummary | null>;
}>();

const emit = defineEmits<{
  loadMore: [];
  sendTextMessage: [replyToMessageId?: number | null];
  markRead: [];
  backToList: [];
  updateConversation: [options?: ConversationDetailUpdateOptions];
  loadMessageReadStatus: [messageId: number];
  replyMessage: [message: MessageSummary];
  recallMessage: [message: MessageSummary];
  clearReplyMessage: [];
}>();

const { user } = storeToRefs(useAuthStore());
const FilePreview = defineAsyncComponent(() => import('@/components/FilePreview/index.vue'));
const scrollbarRef = useTemplateRef('scrollbarRef');
const isChatDetail = ref(false);
const pendingAutoScroll = ref(true);
const uploadingFiles = ref(false);
const isFileDragActive = ref(false);
const dropUploadDialogVisible = ref(false);
const droppedFiles = ref<File[]>([]);
const preparingDroppedFiles = ref(false);
const pendingUploads = ref<PendingUpload[]>([]);
const galleryVisible = ref(false);
const galleryFileList = ref<GalleryFile[]>([]);
const galleryIndex = ref(0);
const visibleMessageIds = ref<Set<number>>(new Set());

// 预加载消息数量
const INLINE_MEDIA_PRELOAD_MESSAGE_LIMIT = 15;

const pendingResourceMap = new Map<string, Set<string>>();
const emptyReadDisplay = { readText: '', readColor: '#909399' };
const highlightedMessageId = ref<number | null>(null);
let highlightTimer: ReturnType<typeof window.setTimeout> | null = null;

const FILE_TYPE_LABELS: Record<ReturnType<typeof getFilePreviewType>, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  word: 'Word 文档',
  excel: 'Excel 表格',
  pptx: 'PPT 演示',
  pdf: 'PDF',
  text: '文本',
  md: 'Markdown',
  doc: 'Word 文档',
  xls: 'Excel 表格',
  ppt: 'PPT 演示',
  archive: '压缩包',
  unknown: '文件',
};

function registerFileToGallery(file: GalleryFile) {
  const existingIndex = galleryFileList.value.findIndex((item) => item.url === file.url);
  if (existingIndex >= 0) {
    const merged = { ...galleryFileList.value[existingIndex], ...file };
    galleryFileList.value.splice(existingIndex, 1);
    insertGalleryFile(merged);
    return;
  }
  insertGalleryFile(file);
}

function insertGalleryFile(file: GalleryFile) {
  const targetMessageId = file.messageId ?? -1;
  const insertAt = galleryFileList.value.findIndex((item) => (item.messageId ?? -1) < targetMessageId);
  if (insertAt === -1) {
    galleryFileList.value.push(file);
    return;
  }
  galleryFileList.value.splice(insertAt, 0, file);
}

function openGallery(fileUrl?: string) {
  if (fileUrl) {
    const index = galleryFileList.value.findIndex((item) => item.url === fileUrl);
    galleryIndex.value = index >= 0 ? index : 0;
  }
  galleryVisible.value = true;
}

provide('gallery', {
  register: registerFileToGallery,
  open: openGallery,
});

const conversationHeaderTitle = computed(() =>
  currentConversation.value
    ? getConversationDisplayTitle(currentConversation.value, user.value?.userId)
    : '',
);

const messageMap = computed(() => {
  const map = new Map<number, MessageSummary>();
  for (const message of props.messages) {
    map.set(message.id, message);
  }
  return map;
});

const hiddenConfirmedMessageIds = computed(() =>
  new Set(
    pendingUploads.value
      .map((pendingUpload) => pendingUpload.confirmedMessageId)
      .filter((messageId): messageId is number => typeof messageId === 'number' && messageId > 0),
  ),
);

const pendingMediaPreloads = computed(() =>
  pendingUploads.value.flatMap((pendingUpload) => {
    if (!pendingUpload.confirmedMessageId) return [];
    const confirmedMessage = messageMap.value.get(pendingUpload.confirmedMessageId);
    if (!confirmedMessage) return [];
    return [{ tempId: pendingUpload.tempId, message: confirmedMessage }];
  }),
);

const renderedItems = computed<RenderedChatItem[]>(() =>
  [
    ...props.messages
      .filter((message) => !hiddenConfirmedMessageIds.value.has(message.id))
      .map<RenderedChatItem>((message) => ({
        kind: 'message',
        key: `message-${message.id}`,
        createdAt: message.createdAt,
        message,
      })),
    ...pendingUploads.value.map<RenderedChatItem>((pendingUpload) => ({
      kind: 'pending',
      key: `pending-${pendingUpload.tempId}`,
      createdAt: pendingUpload.createdAt,
      pendingUpload,
    })),
  ].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt) || 0;
    const rightTime = Date.parse(right.createdAt) || 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.key.localeCompare(right.key);
  }),
);

const recentInlineMediaMessageIds = computed(() =>
  new Set(
    props.messages
      .slice(-INLINE_MEDIA_PRELOAD_MESSAGE_LIMIT)
      .map((message) => message.id),
  ),
);

const groupedMessages = computed<MessageGroup[]>(() => {
  const groups: MessageGroup[] = [];
  let currentDateLabel = '';
  let currentGroup: RenderedChatItem[] = [];

  for (const item of renderedItems.value) {
    const dateLabel = formatDateSeparator(new Date(item.createdAt));
    if (dateLabel !== currentDateLabel) {
      if (currentGroup.length > 0) {
        groups.push({ dateLabel: currentDateLabel, items: currentGroup });
      }
      currentDateLabel = dateLabel;
      currentGroup = [item];
    } else {
      currentGroup.push(item);
    }
  }

  if (currentGroup.length > 0) {
    groups.push({ dateLabel: currentDateLabel, items: currentGroup });
  }

  return groups;
});

const showDropOverlay = computed(() =>
  Boolean(currentConversation.value) &&
  isFileDragActive.value &&
  !dropUploadDialogVisible.value,
);

const droppedFileItems = computed<DroppedFileItem[]>(() =>
  droppedFiles.value.map((file) => {
    const validation = validateFile(file);
    const previewType = getFilePreviewType({
      fileName: file.name,
      mimeType: file.type,
    });

    return {
      file,
      name: file.name,
      sizeText: formatFileSize(file.size),
      typeText: FILE_TYPE_LABELS[previewType] || '文件',
      valid: validation.valid,
      error: validation.error,
    };
  }),
);

const validDroppedFiles = computed(() =>
  droppedFileItems.value.filter((item) => item.valid).map((item) => item.file),
);

const invalidDroppedFileCount = computed(() =>
  droppedFileItems.value.filter((item) => !item.valid).length,
);

const droppedFileTotalSize = computed(() =>
  formatFileSize(droppedFiles.value.reduce((total, file) => total + file.size, 0)),
);

const dropUploadBusy = computed(() =>
  preparingDroppedFiles.value || uploadingFiles.value,
);

const canConfirmDropUpload = computed(() =>
  validDroppedFiles.value.length > 0 && !dropUploadBusy.value && !props.loading,
);

function getScrollWrap() {
  return (scrollbarRef.value?.wrapRef as HTMLElement | undefined) ?? null;
}

function isLatestMessageInView(threshold = 24) {
  const wrap = getScrollWrap();
  if (!wrap) return true;
  return wrap.scrollHeight - (wrap.scrollTop + wrap.clientHeight) <= threshold;
}

function scrollToBottom(behavior: ScrollBehavior = 'auto') {
  const wrap = getScrollWrap();
  if (!wrap) return;
  wrap.scrollTo({ top: wrap.scrollHeight, behavior });
}

function clearHighlightedMessage() {
  if (highlightTimer) {
    window.clearTimeout(highlightTimer);
    highlightTimer = null;
  }
  highlightedMessageId.value = null;
}

async function jumpToMessage(messageId?: number | null) {
  if (!messageId) return;

  await nextTick();
  const wrap = getScrollWrap();
  const target = wrap?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`) ?? null;

  if (!target) {
    ElMessage.info('原消息不在当前已加载范围内');
    return;
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightedMessageId.value = messageId;

  if (highlightTimer) {
    window.clearTimeout(highlightTimer);
  }

  highlightTimer = window.setTimeout(() => {
    if (highlightedMessageId.value === messageId) {
      highlightedMessageId.value = null;
    }
    highlightTimer = null;
  }, 2000);
}

function handleSendTextMessage() {
  emit('sendTextMessage', props.replyingMessage?.id ?? null);
}

function getReplyTarget(message: MessageSummary): MessageSummary | MessageReference | null {
  if (!message.replyToMessageId) {
    return message.replyToMessage ?? null;
  }
  return messageMap.value.get(message.replyToMessageId) ?? message.replyToMessage ?? null;
}

function registerPendingResource(tempId: string, url?: string) {
  if (!url) return;
  const resourceSet = pendingResourceMap.get(tempId) ?? new Set<string>();
  resourceSet.add(url);
  pendingResourceMap.set(tempId, resourceSet);
}

function cleanupPendingResources(tempId: string) {
  const resourceSet = pendingResourceMap.get(tempId);
  if (!resourceSet) return;
  resourceSet.forEach((url) => URL.revokeObjectURL(url));
  pendingResourceMap.delete(tempId);
}

function clearPendingUploads() {
  for (const pendingUpload of pendingUploads.value) {
    cleanupPendingResources(pendingUpload.tempId);
  }
  pendingUploads.value = [];
}

function createPendingUpload(file: File, replyToMessageId?: number | null) {
  const tempId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const localPreviewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
  const previewType = getFilePreviewType({
    fileName: file.name,
    mimeType: file.type,
  });
  const replyToMessage = replyToMessageId
    ? messageMap.value.get(replyToMessageId) ?? props.replyingMessage ?? null
    : null;

  registerPendingResource(tempId, localPreviewUrl);

  const messageType: PendingUpload['messageType'] =
    previewType === 'image'
      ? 'image'
      : previewType === 'video'
        ? 'video'
        : previewType === 'audio'
          ? 'audio'
          : 'file';

  const fileExtra: FileExtra = {
    fileName: file.name,
    fileSize: file.size,
    fileUrl: localPreviewUrl || '',
    mimeType: file.type,
    localPreviewUrl,
  };

  pendingUploads.value.push({
    tempId,
    senderUserId: props.meUserId ?? user.value?.userId ?? 0,
    senderNickName: user.value?.nickName ?? user.value?.userAccount ?? null,
    messageType,
    createdAt: new Date().toISOString(),
    replyToMessageId: replyToMessageId ?? null,
    replyToMessage,
    status: 'uploading',
    progress: 0,
    confirmedMessageId: null,
    fileExtra,
  });

  return tempId;
}

function parseConfirmedFileExtra(message: MessageSummary) {
  try {
    return message.extra ? JSON.parse(message.extra) as FileExtra : null;
  } catch {
    return null;
  }
}

function shouldWaitForConfirmedMedia(message: MessageSummary) {
  if (message.messageType === 'image') return true;
  if (message.messageType !== 'video') return false;
  return Boolean(parseConfirmedFileExtra(message)?.thumbnailUrl);
}

function isSameFileMessage(pendingUpload: PendingUpload, confirmedMessage: MessageSummary) {
  if (pendingUpload.messageType !== confirmedMessage.messageType) return false;
  if (pendingUpload.senderUserId !== confirmedMessage.senderUserId) return false;
  if ((pendingUpload.replyToMessageId ?? null) !== (confirmedMessage.replyToMessageId ?? null)) return false;

  const confirmedExtra = parseConfirmedFileExtra(confirmedMessage);
  if (!confirmedExtra) return false;

  const sameName = pendingUpload.fileExtra.fileName === confirmedExtra.fileName;
  const sameSize = pendingUpload.fileExtra.fileSize === confirmedExtra.fileSize;
  const sameMime = (pendingUpload.fileExtra.mimeType || '') === (confirmedExtra.mimeType || '');
  const pendingTime = Date.parse(pendingUpload.createdAt) || 0;
  const confirmedTime = Date.parse(confirmedMessage.createdAt) || 0;
  const closeEnough = Math.abs(confirmedTime - pendingTime) <= 2 * 60 * 1000;

  return sameName && sameSize && sameMime && closeEnough;
}

function settlePendingUpload(tempId: string, confirmedMessage: MessageSummary) {
  if (!shouldWaitForConfirmedMedia(confirmedMessage)) {
    removePendingUpload(tempId);
    return;
  }

  updatePendingUpload(tempId, (upload) => ({
    ...upload,
    status: 'processing',
    progress: 100,
    confirmedMessageId: confirmedMessage.id,
  }));
}

function reconcilePendingUploads(confirmedMessages: MessageSummary[]) {
  if (pendingUploads.value.length === 0 || confirmedMessages.length === 0) return;

  const availablePending = pendingUploads.value.filter((pendingUpload) => !pendingUpload.confirmedMessageId);

  for (const confirmedMessage of confirmedMessages) {
    const matchIndex = availablePending.findIndex((pendingUpload) =>
      isSameFileMessage(pendingUpload, confirmedMessage),
    );

    if (matchIndex === -1) continue;

    const matchedUpload = availablePending[matchIndex];
    if (matchedUpload) {
      settlePendingUpload(matchedUpload.tempId, confirmedMessage);
      availablePending.splice(matchIndex, 1);
    }
  }
}

function updatePendingUpload(tempId: string, updater: (upload: PendingUpload) => PendingUpload) {
  const index = pendingUploads.value.findIndex((upload) => upload.tempId === tempId);
  if (index === -1) return;
  const currentUpload = pendingUploads.value[index];
  if (!currentUpload) return;
  pendingUploads.value.splice(index, 1, updater(currentUpload));
}

function updatePendingProgress(tempId: string, progress: number) {
  updatePendingUpload(tempId, (upload) => ({
    ...upload,
    progress: Math.max(0, Math.min(100, progress)),
  }));
}

function updatePendingThumbnail(tempId: string, thumbnailUrl: string) {
  registerPendingResource(tempId, thumbnailUrl);
  updatePendingUpload(tempId, (upload) => ({
    ...upload,
    fileExtra: {
      ...upload.fileExtra,
      localThumbnailUrl: thumbnailUrl,
    },
  }));
}

function removePendingUpload(tempId: string) {
  const index = pendingUploads.value.findIndex((upload) => upload.tempId === tempId);
  if (index === -1) return;
  pendingUploads.value.splice(index, 1);
  cleanupPendingResources(tempId);
}

function markPendingFailed(tempId: string) {
  updatePendingUpload(tempId, (upload) => ({
    ...upload,
    status: 'failed',
    confirmedMessageId: null,
  }));

  window.setTimeout(() => {
    removePendingUpload(tempId);
  }, 1800);
}

function handlePendingMediaSettled({ messageId }: { messageId: number; ready: boolean }) {
  const matchedUpload = pendingUploads.value.find((upload) => upload.confirmedMessageId === messageId);
  if (!matchedUpload) return;
  removePendingUpload(matchedUpload.tempId);
}

function shouldPreloadInlineMedia(item: RenderedChatItem) {
  if (item.kind !== 'message') return true;

  const { message } = item;
  if (message.messageType !== 'image' && message.messageType !== 'video') {
    return true;
  }

  return recentInlineMediaMessageIds.value.has(message.id) || visibleMessageIds.value.has(message.id);
}

function hasDraggedFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function resetFileDragState() {
  isFileDragActive.value = false;
}

function handleDragEnter(event: DragEvent) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (!currentConversation.value || dropUploadDialogVisible.value) return;
  isFileDragActive.value = true;
}

function handleDragOver(event: DragEvent) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
  if (currentConversation.value && !dropUploadDialogVisible.value) {
    isFileDragActive.value = true;
  }
}

function handleDragLeave(event: DragEvent) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (!currentConversation.value) return;

  const currentTarget = event.currentTarget as HTMLElement | null;
  const nextTarget = event.relatedTarget as Node | null;
  if (currentTarget && nextTarget && currentTarget.contains(nextTarget)) return;

  resetFileDragState();
}

function handleDrop(event: DragEvent) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  resetFileDragState();

  if (!currentConversation.value?.id) {
    ElMessage.warning('请先选择一个会话');
    return;
  }

  if (uploadingFiles.value || props.loading) {
    ElMessage.warning('正在发送文件，请稍后再试');
    return;
  }

  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length === 0) return;

  droppedFiles.value = files;
  dropUploadDialogVisible.value = true;
}

function closeDropUploadDialog() {
  if (dropUploadBusy.value) return;
  dropUploadDialogVisible.value = false;
}

function clearDroppedFiles() {
  if (dropUploadBusy.value) return;
  droppedFiles.value = [];
}

async function confirmDropUpload() {
  if (!currentConversation.value?.id) {
    ElMessage.warning('请先选择一个会话');
    return;
  }

  if (validDroppedFiles.value.length === 0) {
    ElMessage.warning('没有可上传的文件');
    return;
  }

  preparingDroppedFiles.value = true;
  try {
    const { files, invalidFiles, failedFiles } = await prepareFilesForMessageUpload(validDroppedFiles.value);

    invalidFiles.forEach(({ name, error }) => {
      ElMessage.warning(`${name}: ${error}`);
    });
    failedFiles.forEach(({ name }) => {
      ElMessage.error(`${name}: 处理失败`);
    });

    if (files.length === 0) {
      ElMessage.warning('没有可上传的文件');
      return;
    }

    dropUploadDialogVisible.value = false;
    droppedFiles.value = [];
    await handleFileSelected(files);
  } finally {
    preparingDroppedFiles.value = false;
  }
}

async function handleFileSelected(files: File[]) {
  if (!currentConversation.value?.id) {
    ElMessage.error('请先选择一个会话');
    return;
  }

  if (!props.sendMessageHandler) {
    ElMessage.error('发送消息处理器未配置');
    return;
  }

  const replyToMessageId = props.replyingMessage?.id ?? null;
  uploadingFiles.value = true;
  let successCount = 0;
  let failedCount = 0;

  try {
    for (const file of files) {
      const tempId = createPendingUpload(file, replyToMessageId);

      try {
        const { extra, messageType } = await uploadFileForMessage(currentConversation.value.id, file, {
          onProgress: (progress) => {
            updatePendingProgress(tempId, progress);
          },
          onThumbnailReady: (thumbnailUrl) => {
            updatePendingThumbnail(tempId, thumbnailUrl);
          },
        });

        updatePendingProgress(tempId, 100);

        const payload: SendMessagePayload = {
          messageType,
          extra,
          replyToMessageId,
        };

        const sentMessage = await props.sendMessageHandler(payload);
        if (!sentMessage) {
          throw new Error('发送消息失败');
        }

        settlePendingUpload(tempId, sentMessage);
        successCount++;
      } catch (error: unknown) {
        failedCount++;
        markPendingFailed(tempId);
        console.error(`Failed to upload file ${file.name}:`, error);
        const message = error instanceof Error ? error.message : '上传失败';
        ElMessage.error(`${file.name}: ${message}`);
      }
    }

    if (successCount > 0 && failedCount === 0) {
      ElMessage.success(files.length === 1 ? '文件发送成功' : `${successCount} 个文件发送成功`);
    } else if (successCount > 0) {
      ElMessage.warning(`${successCount} 个文件发送成功，${failedCount} 个失败`);
    }
  } catch (error: unknown) {
    console.error('File upload error:', error);
    ElMessage.error('文件发送失败');
  } finally {
    uploadingFiles.value = false;
  }
}

function onMessageVisible(entry: IntersectionObserverEntry) {
  const messageId = Number((entry.target as HTMLElement).dataset.messageId);
  if (!Number.isFinite(messageId) || messageId <= 0) return;

  if (!visibleMessageIds.value.has(messageId)) {
    visibleMessageIds.value = new Set(visibleMessageIds.value).add(messageId);
  }

  if (!props.messageReadStatus?.has(messageId)) {
    emit('loadMessageReadStatus', messageId);
  }
}

function getReadDisplay(messageId: number) {
  if (props.readInfoMap) {
    return props.readInfoMap.get(messageId) || emptyReadDisplay;
  }

  const status = props.messageReadStatus?.get(messageId);
  if (!status || status.totalRecipients === 0) {
    return emptyReadDisplay;
  }

  const isAllRead = status.readCount >= status.totalRecipients;
  return {
    readText: `${status.readCount}/${status.totalRecipients} 已读`,
    readColor: isAllRead ? '#67C23A' : '#909399',
  };
}

function getItemSenderId(item: RenderedChatItem) {
  return item.kind === 'message' ? item.message.senderUserId : item.pendingUpload.senderUserId;
}

function getItemReplyTarget(item: RenderedChatItem) {
  return item.kind === 'message'
    ? getReplyTarget(item.message)
    : item.pendingUpload.replyToMessage ?? null;
}

function getItemReplyTargetId(item: RenderedChatItem) {
  return item.kind === 'message'
    ? item.message.replyToMessageId ?? null
    : item.pendingUpload.replyToMessageId ?? null;
}

watch(
  () => renderedItems.value.length,
  async (newLength, oldLength) => {
    if (newLength > oldLength) {
      pendingAutoScroll.value = isLatestMessageInView();
    }
    await nextTick();
    if (newLength > oldLength && pendingAutoScroll.value) {
      scrollToBottom('smooth');
    }
  },
);

watch(
  () => props.messages,
  (messages) => {
    reconcilePendingUploads(messages);
  },
  { deep: true },
);

watch(
  () => currentConversation.value?.id,
  async () => {
    dropUploadDialogVisible.value = false;
    droppedFiles.value = [];
    resetFileDragState();
    clearHighlightedMessage();
    clearPendingUploads();
    visibleMessageIds.value = new Set();
    await nextTick();
    scrollToBottom();
  },
);

onBeforeUnmount(() => {
  clearHighlightedMessage();
  clearPendingUploads();
});
</script>

<template>
  <main class="main-panel" @dragenter="handleDragEnter" @dragover="handleDragOver" @dragleave="handleDragLeave"
    @drop="handleDrop">
    <div v-if="currentConversation" class="conversation-detail">
      <el-scrollbar ref="scrollbarRef" view-class="message-list-container">
        <div v-if="props.meUserId" class="message-list">
          <template v-for="group in groupedMessages" :key="group.dateLabel">
            <div class="date-separator">
              <el-divider border-style="dashed">{{ group.dateLabel }}</el-divider>
            </div>

            <MessageItem v-for="item in group.items" :key="item.key" v-viewport="onMessageVisible"
              :data-message-id="item.kind === 'message' ? item.message.id : undefined"
              :message="item.kind === 'message' ? item.message : undefined"
              :pending-upload="item.kind === 'pending' ? item.pendingUpload : undefined"
              :src="getMemberAvatarBySender(currentConversation, getItemSenderId(item))" :meUserId="props.meUserId"
              :thumbnail-src="getMemberAvatarSourcesBySender(currentConversation, getItemSenderId(item)).thumbnailSrc"
              :is-mine="getItemSenderId(item) === props.meUserId" :reply-target="getItemReplyTarget(item)"
              :reply-target-id="getItemReplyTargetId(item)" :allow-inline-media-load="shouldPreloadInlineMedia(item)"
              :highlighted="item.kind === 'message' && highlightedMessageId === item.message.id"
              v-bind="item.kind === 'message' ? getReadDisplay(item.message.id) : emptyReadDisplay"
              @reply="emit('replyMessage', $event)" @recall="emit('recallMessage', $event)"
              @media-settled="handlePendingMediaSettled" @jump-to-message="jumpToMessage" />
          </template>
        </div>
      </el-scrollbar>

      <div v-if="pendingMediaPreloads.length > 0" class="media-preload-layer" aria-hidden="true">
        <FileMessage v-for="item in pendingMediaPreloads" :key="`preload-${item.tempId}-${item.message.id}`"
          :message="item.message" :show-download="false" src="" @media-settled="handlePendingMediaSettled" />
      </div>

      <div v-if="showDropOverlay" class="drop-upload-overlay">
        <div class="drop-upload-indicator">
          <el-icon :size="44">
            <UploadFilled />
          </el-icon>
          <div class="drop-upload-title">松开发送文件</div>
        </div>
      </div>

      <div class="chat-header">
        <div class="chat-header-main">
          <el-button v-if="props.showBackToList" color="#111827" class="back-to-list" @click="emit('backToList')">
            会话列表
          </el-button>
          <h3>{{ conversationHeaderTitle }}</h3>
        </div>
        <el-button color="#111827" class="open-detail" :icon="Document" @click="isChatDetail = true">
          详情
        </el-button>
      </div>

      <div class="composer">
        <div v-if="props.replyingMessage" class="replying-banner">
          <button class="replying-banner-main" type="button" @click="jumpToMessage(props.replyingMessage.id)">
            <div class="replying-label">引用消息</div>
            <div class="replying-sender">{{ getMessageSenderName(props.replyingMessage) }}</div>
            <div class="replying-preview">{{ getMessagePreview(props.replyingMessage) }}</div>
          </button>
          <el-button link color="#111827" class="replying-cancel" @click="emit('clearReplyMessage')">
            取消引用
          </el-button>
        </div>

        <div class="composer-main">
          <FileUploadButton :disabled="uploadingFiles || props.loading"
            @file-selected="handleFileSelected" />
          <el-input v-model="model" clearable placeholder="输入消息" @keyup.enter="handleSendTextMessage" />
          <el-button color="#111827" :disabled="props.loading || uploadingFiles" @click="handleSendTextMessage">
            发送
          </el-button>
          <el-button color="#111827" :disabled="props.loading" @click="emit('markRead')">
            标记已读
          </el-button>
        </div>
      </div>

      <ConversationDetailDialog v-model="isChatDetail" :conversation="currentConversation"
        @update:conversation="emit('updateConversation', $event)"
        @load-more="emit('loadMore')" />

      <FilePreview v-if="galleryVisible" v-model="galleryVisible" :file-list="galleryFileList"
        v-model:current-index="galleryIndex" />

      <el-dialog v-model="dropUploadDialogVisible" title="确认上传文件" width="560px" :close-on-click-modal="!dropUploadBusy"
        :close-on-press-escape="!dropUploadBusy" :show-close="!dropUploadBusy" @closed="clearDroppedFiles">
        <div class="drop-file-dialog">
          <div class="drop-file-question">是否上传这些文件到当前会话？</div>
          <div class="drop-file-summary">
            <span>共 {{ droppedFileItems.length }} 个文件，{{ droppedFileTotalSize }}</span>
            <span v-if="invalidDroppedFileCount > 0">
              其中 {{ invalidDroppedFileCount }} 个不可上传，将自动跳过
            </span>
          </div>

          <div class="drop-file-list">
            <div v-for="item in droppedFileItems" :key="`${item.name}-${item.file.lastModified}-${item.file.size}`"
              class="drop-file-row" :class="{ invalid: !item.valid }">
              <div class="drop-file-icon">
                <el-icon :size="22">
                  <Document />
                </el-icon>
              </div>
              <div class="drop-file-info">
                <div class="drop-file-name" :title="item.name">{{ item.name }}</div>
                <div class="drop-file-meta">
                  <span>{{ item.typeText }}</span>
                  <span>{{ item.sizeText }}</span>
                </div>
              </div>
              <span class="drop-file-status" :class="{ valid: item.valid, invalid: !item.valid }">
                {{ item.valid ? '可上传' : item.error }}
              </span>
            </div>
          </div>
        </div>

        <template #footer>
          <div class="drop-dialog-footer">
            <el-button :disabled="dropUploadBusy" @click="closeDropUploadDialog">取消</el-button>
            <el-button color="#111827" :loading="dropUploadBusy" :disabled="!canConfirmDropUpload"
              @click="confirmDropUpload">
              上传 {{ validDroppedFiles.length }} 个文件
            </el-button>
          </div>
        </template>
      </el-dialog>
    </div>

    <div v-else class="empty">请选择一个会话开始聊天。</div>
  </main>
</template>

<style scoped lang="scss">
.date-separator {
  margin: 0 12px;
}

.media-preload-layer {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
}

.drop-upload-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: rgba(17, 24, 39, 0.18);
  backdrop-filter: blur(2px);
  pointer-events: none;
}

.drop-upload-indicator {
  display: grid;
  place-items: center;
  gap: 12px;
  min-width: 180px;
  padding: 28px 32px;
  border: 1px solid rgba(255, 255, 255, 0.65);
  border-radius: 8px;
  color: #111827;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 20px 48px rgba(17, 24, 39, 0.2);
}

.drop-upload-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
}

.drop-file-dialog {
  display: grid;
  gap: 12px;
}

.drop-file-question {
  color: #111827;
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}

.drop-file-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  color: #6b7280;
  font-size: 13px;
  line-height: 18px;
}

.drop-file-list {
  display: grid;
  gap: 8px;
  max-height: 320px;
  overflow: auto;
  padding-right: 2px;
}

.drop-file-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;

  &.invalid {
    border-color: #fecaca;
    background: #fff7f7;
  }
}

.drop-file-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: #374151;
  background: #f3f4f6;
}

.drop-file-info {
  min-width: 0;
}

.drop-file-name {
  overflow: hidden;
  color: #111827;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drop-file-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: #6b7280;
  font-size: 12px;
  line-height: 18px;
}

.drop-file-status {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  max-width: 150px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.valid {
    border-color: #bbf7d0;
    color: #15803d;
    background: #f0fdf4;
  }

  &.invalid {
    border-color: #fecaca;
    color: #b91c1c;
    background: #fef2f2;
  }
}

.drop-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.composer {
  display: grid;
  gap: 8px;
  align-items: stretch;
}

.composer-main {
  display: flex;
  align-items: center;
  gap: 6px;

  .el-input {
    min-width: 0;
  }
}

.replying-banner {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-left: 3px solid #111827;
  border-radius: 8px;
  background: rgba(243, 244, 246, 0.94);
}

.replying-banner-main {
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
}

.replying-label {
  color: #6b7280;
  font-size: 12px;
  line-height: 18px;
}

.replying-sender {
  color: #111827;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}

.replying-preview {
  overflow: hidden;
  color: #4b5563;
  font-size: 13px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.replying-cancel {
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .date-separator {
    margin: 0 6px;
  }

  .drop-upload-indicator {
    min-width: 150px;
    padding: 22px 24px;
  }

  .replying-banner {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .replying-cancel {
    justify-self: flex-end;
  }

  .drop-file-row {
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 10px;
  }

  .drop-file-icon {
    width: 38px;
    height: 38px;
  }

  .drop-file-status {
    grid-column: 2;
    justify-self: flex-start;
    max-width: 100%;
  }
}
</style>
