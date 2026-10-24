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
import { telemetry } from '@/libs/telemetry';
import router from '@/routers';
import {
  ChatDotRound,
  ChatLineRound,
  CircleCloseFilled,
  CopyDocument,
  Delete,
  Document,
  Download,
  RefreshLeft,
  UploadFilled,
  User as UserIcon,
  View,
} from '@element-plus/icons-vue';
import { useDeviceLayout } from '@/composables/use-device-layout';
import { useAuthStore } from '@/stores';
import MessageItem from './MessageItem.vue';
import FileUploadButton from './FileUploadButton.vue';
import ChatContextMenu, { type ChatContextMenuItem } from './ChatContextMenu.vue';
import ChatDialog from './ChatDialog.vue';
import { rememberBlobUrl, useFileDownloader } from '../composables/useFileDownloader';
import { useChatContextMenu } from '../composables/useChatContextMenu';
import { copyImageFromUrl, copyTextToClipboard } from '../utils/clipboard';
import { blockUser } from '../api/friends';
import ConversationDetailDialog from './ConversationDetailDialog.vue';
import type {
  ConversationDetail,
  ConversationDetailUpdateOptions,
  FileExtra,
  MessageReadStatus,
  MessageReference,
  MessageSummary,
  PendingTextMessage,
  PendingUpload,
  SendMessagePayload,
} from '../types';
import {
  formatDateSeparator,
  formatSystemMessageText,
  getConversationDisplayTitle,
  getMemberAvatarBySender,
  getMemberAvatarSourcesBySender,
  getMessagePreview,
  getMessageSenderName,
  toTimestamp,
} from '../utils/chat';
import {
  FILE_TYPE_LABELS,
  formatFileSize,
  getFilePreviewType,
  isPreviewableFileType,
  parseMessageExtra,
} from '../utils/fileMeta';
import {
  prepareFilesForMessageUpload,
  uploadFileForMessage,
  validateFile,
} from '../utils/fileUpload';
import { buildUserHomeRoute } from '../utils/navigation';

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
    kind: 'pendingText';
    key: string;
    createdAt: string;
    pendingText: PendingTextMessage;
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

const { isSmallWindow } = useDeviceLayout();

/**
 * 输入框 placeholder：窄窗口要换短的，否则空输入框会被撑成两行高。
 *
 * EP 的 autosize 在输入框为空时是拿 placeholder 去量高度的：
 *   node_modules/element-plus/es/components/input/src/utils.mjs
 *   hiddenTextarea.value = targetElement.value || targetElement.placeholder || "";
 * 所以长 placeholder 一旦折行，autosize 就把它算成两行，
 * 空输入框显示成两排、整体过高。
 *
 * 实测：「输入消息，Enter 发送，Shift + Enter 换行」约 20 个全角宽 ≈ 260px，
 * 而竖屏手机（393px 宽）的输入框实际只有约 269px，刚好临界就会折行。
 * 小窗口下换成「输入消息…」，任何宽度都不会折。
 */
const composerPlaceholder = computed(() =>
  isSmallWindow.value
    ? "输入消息…"
    : "输入消息，Enter 发送，Shift + Enter 换行",
);

const props = defineProps<{
  messages: MessageSummary[];
  /** 本地乐观发送中的文本消息（服务端确认后自动移除）。 */
  pendingTextMessages?: PendingTextMessage[];
  meUserId?: number;
  loading: boolean;
  /** 发送中：只影响发送按钮，不阻塞输入与列表滚动。 */
  sending?: boolean;
  loadingMore?: boolean;
  showBackToList?: boolean;
  replyingMessage?: MessageSummary | null;
  messageReadStatus?: Map<number, MessageReadStatus>;
  readInfoMap?: Map<number, { readText: string; readColor: string }>;
  sendMessageHandler?: (payload: SendMessagePayload) => Promise<MessageSummary | null>;
  retrySendHandler?: (tempId: number) => Promise<void>;
  discardSendHandler?: (tempId: number) => void;
  loadMessageReadStatusBatchHandler?: (messageIds: number[]) => Promise<void>;
  /** 删除一条消息（仅自己不可见）；返回是否成功。 */
  deleteMessageHandler?: (messageId: number) => Promise<boolean>;
}>();

const emit = defineEmits<{
  loadMore: [];
  sendTextMessage: [replyToMessageId?: number | null];
  markRead: [];
  backToList: [];
  updateConversation: [options?: ConversationDetailUpdateOptions];
  loadMessageReadStatus: [messageId: number];
  loadMessageReadStatusBatch: [messageIds: number[]];
  replyMessage: [message: MessageSummary];
  recallMessage: [message: MessageSummary];
  clearReplyMessage: [];
  retrySend: [tempId: number];
  discardSend: [tempId: number];
  deleteMessage: [messageId: number];
}>();

const { user } = storeToRefs(useAuthStore());
const FilePreview = defineAsyncComponent(() => import('@/components/FilePreview/index.vue'));
const scrollbarRef = useTemplateRef('scrollbarRef');
const isChatDetail = ref(false);
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

// ==============================================
// 右键菜单：任意消息 / 用户头像
// ==============================================
const { requestBlobUrl, downloadAndSaveFile } = useFileDownloader();

/** 与 FileMessage 保持一致：超过 15MB 不在线预览。 */
const PREVIEW_SIZE_LIMIT = 15 * 1024 * 1024;

/** 输入框实例：「艾特」后把焦点放回输入框，光标移到末尾。 */
const composerInputRef = useTemplateRef<{ focus: () => void }>('composerInputRef');

const {
  visible: messageMenuVisible,
  x: messageMenuX,
  y: messageMenuY,
  target: messageMenuTarget,
  open: openMessageMenu,
  close: closeMessageMenu,
} = useChatContextMenu<MessageSummary>();

const {
  visible: avatarMenuVisible,
  x: avatarMenuX,
  y: avatarMenuY,
  target: avatarMenuTarget,
  open: openAvatarMenu,
  close: closeAvatarMenu,
} = useChatContextMenu<{ userId: number; name: string }>();

/** 与 MessageItem 里的撤回窗口保持一致（服务端也是 5 分钟）。 */
const RECALL_WINDOW_MS = 5 * 60 * 1000;

function getRecallAvailability(message: MessageSummary) {
  if (message.isRecalled) return { allowed: false, hint: '已撤回' };
  if (message.senderUserId !== props.meUserId) return { allowed: false, hint: '仅自己消息' };

  const createdAt = toTimestamp(message.createdAt);
  if (!createdAt) return { allowed: false, hint: '' };
  if (Date.now() - createdAt > RECALL_WINDOW_MS) return { allowed: false, hint: '超过 5 分钟' };

  return { allowed: true, hint: '' };
}

/**
 * 群主 / 管理员是否能撤回「别人的消息」。
 *
 * 与服务端 RecallMessage 的规则保持一致：
 *   · 群主：可撤回管理员、成员的消息，不能撤回群主；
 *   · 管理员：只能撤回普通成员的消息，不能动群主和其它管理员；
 *   · 普通成员 / 单聊：没有这个权限。
 *
 * 没有权限时菜单里不会出现「撤回」项（而不是灰掉）。
 */
function canModerateMessage(message: MessageSummary) {
  const conversation = currentConversation.value;
  if (!conversation || conversation.conversationType !== 'group') return false;

  const currentMember = conversation.members.find(
    (member) => member.userId === props.meUserId,
  );
  if (!currentMember) return false;

  const currentRole = currentMember.memberRole;
  if (currentRole !== 'owner' && currentRole !== 'admin') return false;

  const targetMember = conversation.members.find(
    (member) => member.userId === message.senderUserId,
  );

  if (currentRole === 'owner') return targetMember?.memberRole !== 'owner';
  return targetMember?.memberRole === 'member';
}

/** 文件类消息（图片 / 视频 / 音频 / 文档）都带 extra。 */
function isFileMessage(message: MessageSummary) {
  return (
    message.messageType === 'image' ||
    message.messageType === 'video' ||
    message.messageType === 'audio' ||
    message.messageType === 'file'
  );
}

function getMessageFileExtra(message: MessageSummary) {
  return isFileMessage(message) ? parseMessageExtra(message.extra) : null;
}

/**
 * 消息菜单按类型动态生成：
 *   · 文本：复制文字 / 引用 / 撤回 / 删除
 *   · 图片：复制图片 / 预览 / 下载 / 引用 / 撤回 / 删除
 *   · 视频 / 音频 / 文档：预览（播放）/ 下载 / 引用 / 撤回 / 删除
 *   · 系统消息：复制内容 / 删除
 *   · 已撤回：删除
 */
const messageMenuItems = computed<ChatContextMenuItem[]>(() => {
  const message = messageMenuTarget.value;
  if (!message) return [];

  // 已撤回的提示不是正常消息，只保留「删除」让它从自己的界面消失。
  if (message.isRecalled) {
    return [
      {
        key: 'delete',
        label: '删除',
        icon: Delete,
        danger: true,
        hint: '仅自己不可见',
      },
    ];
  }

  const items: ChatContextMenuItem[] = [];
  const extra = getMessageFileExtra(message);
  const category = extra ? getFilePreviewType(extra) : 'unknown';
  const hasFile = Boolean(extra?.fileKey);
  const fileSize = extra?.fileSize ?? 0;
  const previewable = hasFile && isPreviewableFileType(category);
  const tooLarge = previewable && fileSize > PREVIEW_SIZE_LIMIT;

  if (message.messageType === 'system') {
    items.push({
      key: 'copy-text',
      label: '复制内容',
      icon: CopyDocument,
      disabled: !message.content?.trim(),
    });
  } else if (message.messageType === 'text') {
    items.push({
      key: 'copy-text',
      label: '复制文字',
      icon: CopyDocument,
      disabled: !message.content?.trim(),
    });
    items.push({
      key: 'reply',
      label: '引用',
      icon: ChatLineRound,
    });
  } else {
    if (category === 'image') {
      items.push({
        key: 'copy-image',
        label: '复制图片',
        icon: CopyDocument,
        disabled: !hasFile,
      });
    }

    items.push({
      key: 'preview',
      label:
        category === 'video'
          ? '播放视频'
          : category === 'audio'
            ? '播放音频'
            : '预览',
      icon: View,
      disabled: !previewable || tooLarge,
      hint: !hasFile
        ? '文件缺失'
        : tooLarge
          ? '文件较大'
          : !previewable
            ? '暂不支持'
            : '',
    });

    items.push({
      key: 'download',
      label: '下载',
      icon: Download,
      disabled: !hasFile,
    });

    items.push({
      key: 'reply',
      label: '引用',
      icon: ChatLineRound,
    });
  }

  const recall = getRecallAvailability(message);
  if (message.messageType !== 'system') {
    const isOwnMessage = message.senderUserId === props.meUserId;

    if (isOwnMessage) {
      // 自己的消息：仍然只有 5 分钟窗口，超时置灰（保留按钮让用户知道原因）。
      items.push({
        key: 'recall',
        label: '撤回',
        icon: RefreshLeft,
        danger: true,
        disabled: !recall.allowed,
        hint: recall.hint,
      });
    } else if (canModerateMessage(message)) {
      // 群主 / 管理员撤回他人消息：没有 5 分钟限制，也不需要置灰。
      items.push({
        key: 'recall',
        label: '撤回',
        icon: RefreshLeft,
        danger: true,
      });
    }
    // 没有管理权限时，其他人的消息不显示「撤回」。
  }

  items.push({
    key: 'delete',
    label: '删除',
    icon: Delete,
    danger: true,
    divider: true,
    hint: '仅自己不可见',
  });

  return items;
});

const avatarMenuItems = computed<ChatContextMenuItem[]>(() => {
  const target = avatarMenuTarget.value;
  if (!target) return [];

  const items: ChatContextMenuItem[] = [];
  if (target.userId !== props.meUserId) {
    items.push({
      key: 'mention',
      label: '艾特',
      icon: ChatDotRound,
      hint: `@${target.name}`,
    });
  }

  items.push({
    key: 'profile',
    label: target.userId === props.meUserId ? '查看我的主页' : '查看主页',
    icon: UserIcon,
  });

  if (target.userId !== props.meUserId) {
    items.push({
      key: 'block',
      label: '拉黑',
      icon: CircleCloseFilled,
      danger: true,
      divider: true,
      hint: target.name,
    });
  }

  return items;
});

function handleItemContextMenu(event: MouseEvent, item: RenderedChatItem) {
  if (item.kind !== 'message') return;

  // 所有真实消息（文本 / 图片 / 视频 / 音频 / 文件 / 系统 / 已撤回）
  // 都有自己的右键菜单；发送中的本地待发气泡不在此列。
  openMessageMenu(event, item.message);
}

function handleMessageAvatarContextMenu(payload: {
  event: MouseEvent;
  userId: number;
  name: string;
}) {
  openAvatarMenu(payload.event, { userId: payload.userId, name: payload.name });
}

function getMessageFileExtraOrWarn(message: MessageSummary) {
  const extra = getMessageFileExtra(message);
  if (!extra?.fileKey) {
    ElMessage.warning('文件尚未上传完成');
    return null;
  }
  return extra;
}

/** 复用下载队列里的缓存：已显示过的文件会立刻回调，不会重新下载。 */
function resolveMessageFileBlobUrl(message: MessageSummary, fileKey: string) {
  return new Promise<string>((resolve, reject) => {
    requestBlobUrl(fileKey, {
      priorityId: message.id,
      onComplete: resolve,
      onError: reject,
    });
  });
}

async function handleCopyMessageText(message: MessageSummary) {
  const text =
    message.messageType === 'system'
      ? formatSystemMessageText(message.content)
      : (message.content ?? '');

  if (!text.trim()) {
    ElMessage.warning('这条消息没有可复制的文字');
    return;
  }

  try {
    await copyTextToClipboard(text);
    ElMessage.success('文字已复制');
  } catch (error) {
    console.error('复制文字失败:', error);
    ElMessage.error(error instanceof Error ? error.message : '复制文字失败');
  }
}

async function handleCopyImageMessage(message: MessageSummary) {
  const extra = getMessageFileExtraOrWarn(message);
  if (!extra) return;

  try {
    const blobUrl = await resolveMessageFileBlobUrl(message, extra.fileKey!);
    const result = await copyImageFromUrl(blobUrl);
    ElMessage.success(
      result === 'image'
        ? '图片已复制'
        : '当前浏览器不支持复制图片，已复制图片地址',
    );
  } catch (error) {
    console.error('复制图片失败:', error);
    ElMessage.error(error instanceof Error ? error.message : '复制图片失败');
  }
}

/** 图片 / 视频 / 音频 / 文档统一走 FilePreview。 */
async function handlePreviewFileMessage(message: MessageSummary) {
  const extra = getMessageFileExtraOrWarn(message);
  if (!extra) return;

  const category = getFilePreviewType(extra);
  if (!isPreviewableFileType(category)) {
    ElMessage.warning('该类型暂不支持在线预览，请下载后查看');
    return;
  }
  if ((extra.fileSize ?? 0) > PREVIEW_SIZE_LIMIT) {
    ElMessage.warning('文件较大，请下载后查看');
    return;
  }

  try {
    const blobUrl = await resolveMessageFileBlobUrl(message, extra.fileKey!);

    // 右键预览时这张图/文件可能还没被 FileMessage 注册进图集
    // （例如懒加载的历史消息），这里补一次注册，免得预览器打开后没有内容。
    registerFileToGallery({
      name: extra.fileName,
      url: blobUrl,
      type: category,
      path: category === 'image' ? blobUrl : undefined,
      messageId: message.id,
    });
    openGallery(blobUrl);
  } catch (error) {
    console.error('预览文件失败:', error);
    ElMessage.error('文件预览失败');
  }
}

async function handleDownloadFileMessage(message: MessageSummary) {
  const extra = getMessageFileExtraOrWarn(message);
  if (!extra) return;
  await downloadAndSaveFile(extra.fileKey!, extra.fileName);
}

async function handleDeleteMessage(message: MessageSummary) {
  try {
    const handler = props.deleteMessageHandler;
    if (handler) {
      const succeeded = await handler(message.id);
      if (succeeded) ElMessage.success('消息已删除（仅自己不可见）');
      return;
    }

    emit('deleteMessage', message.id);
    ElMessage.success('消息已删除（仅自己不可见）');
  } catch (error) {
    console.error('删除消息失败:', error);
    ElMessage.error('删除消息失败');
  }
}

async function handleMessageMenuSelect(key: string) {
  const message = messageMenuTarget.value;
  closeMessageMenu();
  if (!message) return;

  switch (key) {
    case 'copy-text':
      await handleCopyMessageText(message);
      break;
    case 'copy-image':
      await handleCopyImageMessage(message);
      break;
    case 'preview':
      await handlePreviewFileMessage(message);
      break;
    case 'download':
      await handleDownloadFileMessage(message);
      break;
    case 'reply':
      emit('replyMessage', message);
      break;
    case 'recall':
      emit('recallMessage', message);
      break;
    case 'delete':
      await handleDeleteMessage(message);
      break;
  }
}

function focusComposerAtEnd() {
  composerInputRef.value?.focus();
  requestAnimationFrame(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('.composer .el-textarea__inner');
    if (!textarea) return;
    textarea.focus();
    const position = textarea.value.length;
    textarea.setSelectionRange(position, position);
  });
}

async function handleAvatarMenuSelect(key: string) {
  const target = avatarMenuTarget.value;
  closeAvatarMenu();
  if (!target) return;

  if (key === 'mention') {
    const mention = `@${target.name} `;
    const current = model.value;
    model.value = current && !/\s$/.test(current) ? `${current} ${mention}` : `${current}${mention}`;
    await nextTick();
    focusComposerAtEnd();
    return;
  }

  if (key === 'profile') {
    // 带上当前会话，从用户主页点「返回聊天」时能原路回到这个会话。
    await router.push(buildUserHomeRoute(target.userId, currentConversation.value?.id));
    return;
  }

  if (key === 'block') {
    try {
      await ElMessageBox.confirm(
        `拉黑后，${target.name} 将无法添加你为好友、与你发起单聊或搜索到你。主页仍可查看，好友状态会保留，群聊不受影响。`,
        '拉黑用户',
        {
          type: 'warning',
          confirmButtonText: '拉黑',
          cancelButtonText: '取消',
        },
      );
    } catch {
      return;
    }

    try {
      await blockUser(target.userId);
      ElMessage.success('已拉黑，可在「更多 > 黑名单」中解除');
    } catch (error) {
      ElMessage.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          '拉黑失败',
      );
    }
  }
}

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

const renderedItems = computed<RenderedChatItem[]>(() =>
  [
    ...props.messages
      .map<RenderedChatItem>((message) => ({
        kind: 'message',
        key: `message-${message.id}`,
        createdAt: message.createdAt,
        message,
      })),
    ...(props.pendingTextMessages ?? []).map<RenderedChatItem>((pendingText) => ({
      kind: 'pendingText',
      key: `pending-text-${pendingText.tempId}`,
      createdAt: pendingText.createdAt,
      pendingText,
    })),
    ...pendingUploads.value.map<RenderedChatItem>((pendingUpload) => ({
      kind: 'pending',
      key: `pending-${pendingUpload.tempId}`,
      createdAt: pendingUpload.createdAt,
      pendingUpload,
    })),
  ].sort((left, right) => {
    const leftTime = toTimestamp(left.createdAt);
    const rightTime = toTimestamp(right.createdAt);
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
  validDroppedFiles.value.length > 0 && !dropUploadBusy.value && !props.sending,
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
  if (props.sending) return;
  if (!model.value.trim()) return;
  emit('sendTextMessage', props.replyingMessage?.id ?? null);
}

/**
 * 输入框按键处理。
 * 旧实现用 @keyup.enter 直接发送，中文输入法用 Enter 上屏候选词时
 * 也会触发发送，等于「打字打到一半消息就飞出去了」。
 * 这里用 keydown + isComposing 判断，并支持 Shift+Enter 换行。
 */
function handleComposerKeydown(event: Event | KeyboardEvent) {
  if (!(event instanceof KeyboardEvent)) return;
  if (event.key !== 'Enter') return;
  // 输入法组合中（如拼音候选上屏）不发送
  if (event.isComposing || (event as KeyboardEvent & { keyCode?: number }).keyCode === 229) return;
  if (event.shiftKey) return;

  event.preventDefault();
  handleSendTextMessage();
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
    // 消息按 id 升序维护，最后一条就是当前最大 id（空列表按 0 算）
    baselineMessageId: props.messages[props.messages.length - 1]?.id ?? 0,
    uploadedFileKey: null,
    fileExtra,
  });

  return tempId;
}

/**
 * 解析「真实消息」里的文件元信息。
 *
 * ⚠️ 必须走 parseMessageExtra，不能裸 JSON.parse：服务端回包与库里的 extra 都是
 * **PascalCase**（`{"FileName":…,"FileKey":…,"ThumbnailUrl":…}`，见 chat_messages.extra），
 * 这里却是按 camelCase 用的。以前直接 JSON.parse，于是 `confirmedExtra.fileKey`
 * 永远是 undefined：
 *   · 上传落地时拿不到 fileKey → 本地那份 blob 送不进下载缓存 → 真实消息掉头把刚传完的
 *     图**重新下一次**，中间还闪一帧「加载中」（用户看到的就是「图没了、变成空白转圈」）；
 *   · isSameFileMessage 的比对字段全成了 undefined → SignalR 推送先到时匹配不上，
 *     待发气泡也就收不掉。
 */
function parseConfirmedFileExtra(message: MessageSummary) {
  return parseMessageExtra(message.extra);
}

/**
 * 把待发消息手里的本地 blob 交给下载缓存，并从「待发资源」里摘出来。
 *
 * 上传成功的这一刻，本地这份 file 就是刚发出去的东西（webp 转换 / 视频封面抽帧
 * 都在上传前做完了），直接拿来给真实消息用，画面上与待发时**完全是同一份像素**，
 * 既不用回头再下一次，也不会先闪一下占位图。摘出来是为了让 cleanupPendingResources
 * 别把它 revoke 掉 —— 它现在的归属是下载缓存。
 *
 * ⚠️ 调用时机很关键：必须在 **sendMessage 之前**（见 handleFileSelected）。
 * sendMessage 一 upsert 消息，真实气泡当场就会渲染一帧并把 FileMessage 挂起来，
 * 那一帧就是 `loadInlineMedia` 发请求的时机 —— 缓存若还没热，它会掉头去下服务器，
 * 用户看到的就是「上传完图没了，变成一个空白转圈」，等下载回来才重新出现。
 */
function primeLocalMedia(tempId: string, extra: FileExtra | null) {
  if (!extra) return;
  const pendingUpload = pendingUploads.value.find((upload) => upload.tempId === tempId);
  if (!pendingUpload) return;
  const local = pendingUpload.fileExtra;

  const adopt = (key: string | null | undefined, blobUrl: string | null | undefined) => {
    if (!key || !blobUrl || !blobUrl.startsWith('blob:')) return;
    rememberBlobUrl(key, blobUrl);
    pendingResourceMap.get(tempId)?.delete(blobUrl);
  };

  // 图片：主图；视频：封面（视频本体仍按需下载，与之前一致）
  adopt(extra.fileKey, local.localPreviewUrl);
  adopt(extra.thumbnailUrl, local.localThumbnailUrl);
}

function isSameFileMessage(pendingUpload: PendingUpload, confirmedMessage: MessageSummary) {
  if (pendingUpload.messageType !== confirmedMessage.messageType) return false;
  if (pendingUpload.senderUserId !== confirmedMessage.senderUserId) return false;
  if ((pendingUpload.replyToMessageId ?? null) !== (confirmedMessage.replyToMessageId ?? null)) return false;

  // 只认「上传开始之后才出现」的消息：同一张图连发两次 fileKey 是一样的，
  // 不设这道门槛就会把上一次的老消息当成结果，待发气泡在发送途中被提前收掉。
  if (confirmedMessage.id <= (pendingUpload.baselineMessageId ?? 0)) return false;

  const confirmedExtra = parseConfirmedFileExtra(confirmedMessage);
  if (!confirmedExtra) return false;

  // 待发消息的时间是浏览器本地生成的 ISO（带 Z），真实消息的是**不带时区**的服务端 UTC ——
  // 必须两边都按 parseServerTime 归一，否则这里会差出整个时区（UTC+8 就是 8 小时），
  // 时间窗永远不成立，图片就同时挂两个气泡（详见 utils/chat.ts 的 parseServerTime）。
  const pendingTime = toTimestamp(pendingUpload.createdAt);
  const confirmedTime = toTimestamp(confirmedMessage.createdAt);
  const closeEnough = Math.abs(confirmedTime - pendingTime) <= 2 * 60 * 1000;
  if (!closeEnough) return false;

  // 首选 fileKey：上传回包里就有、会话内唯一、服务端原样回显 —— 精确，
  // 而且不受「图片上传前被转成 webp 改名」「服务端重新编码导致字节数变化」影响。
  if (pendingUpload.uploadedFileKey && confirmedExtra.fileKey) {
    return pendingUpload.uploadedFileKey === confirmedExtra.fileKey;
  }

  // 兜底（理论上只在拿不到 fileKey 时会走到）：文件名主干 + 大小 + MIME。
  // 文件名要「去后缀」再比 —— 待发是 *.webp，服务端入库时又把原始文件名去掉了后缀。
  const stem = (name?: string | null) => (name ?? '').replace(/\.[^.]+$/, '');
  const sameName = stem(pendingUpload.fileExtra.fileName) === stem(confirmedExtra.fileName);
  const sameSize = pendingUpload.fileExtra.fileSize === confirmedExtra.fileSize;
  const sameMime = (pendingUpload.fileExtra.mimeType || '') === (confirmedExtra.mimeType || '');

  return sameName && sameSize && sameMime;
}

/**
 * 上传成功、真实消息已经落地：**立刻**收掉本地待发气泡。
 *
 * ⚠️ 历史教训，别改回「先标 processing（界面上的『准备中』），再等一个隐藏组件回话」：
 * 旧实现在这里把待发消息标成 processing，同时挂一个隐藏的 FileMessage 去把刚上传完的
 * 文件**重新从服务器下一次**，下完再 emit mediaSettled 才收气泡。那条路有两个坑，
 * 每一个都能让图片永久停在「准备中」：
 *
 *   1. 为了不闪出重复气泡，真实消息一落地就从列表里被摘掉（只留待发气泡），
 *      那条消息的 FileMessage 随即**被卸载**；而 Vue 的 emit 对已卸载组件是直接
 *      `return` 的（isUnmounted），于是「下载完成」这件事永远传不回面板；
 *   2. 同一个 fileKey 的第二个下载请求会被下载队列**静默丢弃**
 *      （旧 useFileDownloader 的去重是 `return` 而不是挂队等待），连回调都不会来。
 *
 * 现在：本地 blob 直接进缓存 → 真实消息首帧就有图（不闪、不重下）→ 待发气泡立即移除。
 * 整个过程不依赖任何「回话」，因此不存在卡住的状态。
 */
function settlePendingUpload(tempId: string, confirmedMessage: MessageSummary) {
  // 正常路径在 sendMessage 之前就 prime 过了（见 handleFileSelected），这里补一刀是给
  // 「推送先到、上传回包里的 extra 和消息里的不一致」这类情况兜底（幂等，不会覆盖已有缓存）。
  primeLocalMedia(tempId, parseConfirmedFileExtra(confirmedMessage));
  removePendingUpload(tempId);
}

function reconcilePendingUploads(confirmedMessages: MessageSummary[]) {
  if (pendingUploads.value.length === 0 || confirmedMessages.length === 0) return;

  const availablePending = [...pendingUploads.value];

  for (const confirmedMessage of confirmedMessages) {
    const matchIndex = availablePending.findIndex((pendingUpload) =>
      isSameFileMessage(pendingUpload, confirmedMessage),
    );

    if (matchIndex === -1) {
      continue;
    }

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
  }));

  window.setTimeout(() => {
    removePendingUpload(tempId);
  }, 1800);
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

  if (uploadingFiles.value || props.sending) {
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

  // 标记「有上传在进行」：页面若在此期间被刷新/卸载，埋点快照里能看到它
  telemetry.markPending('file-upload-batch', '文件上传中', {
    count: files.length,
    conversationId: currentConversation.value.id,
  });

  try {
    for (const file of files) {
      const tempId = createPendingUpload(file, replyToMessageId);
      const fileStartedAt = Date.now();

      telemetry.track('file', 'file-upload-start', {
        fileName: file.name,
        size: file.size,
        type: file.type,
        conversationId: currentConversation.value.id,
      }, 'info');

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

        // 上传回包里就有 fileKey：先记进待发消息（下面「待发气泡 → 真实消息」的
        // 匹配就靠它，见 isSameFileMessage），**并且在把消息发出去之前**把本地 blob
        // 交给下载缓存 —— sendMessage 一 upsert 消息，真实气泡当场渲染那一帧就会
        // 挂着 FileMessage 去取图；缓存没热，它就会掉头去下服务器（「图没了、转圈」）。
        updatePendingUpload(tempId, (upload) => ({
          ...upload,
          uploadedFileKey: extra.fileKey ?? null,
        }));
        primeLocalMedia(tempId, extra);

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
        telemetry.track('file', 'file-upload-done', {
          fileName: file.name,
          messageId: sentMessage.id,
          durationMs: Date.now() - fileStartedAt,
        }, 'info');
      } catch (error: unknown) {
        failedCount++;
        markPendingFailed(tempId);
        telemetry.captureError('file-upload-failed', error, {
          fileName: file.name,
          size: file.size,
          durationMs: Date.now() - fileStartedAt,
          note: '上传或发送阶段失败',
        });
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
    telemetry.captureError('file-upload-batch-failed', error, { fileCount: files.length });
    console.error('File upload error:', error);
    ElMessage.error('文件发送失败');
  } finally {
    telemetry.clearPending('file-upload-batch');
    uploadingFiles.value = false;
  }
}

/** 可见消息的已读状态按批查询，避免「每条消息一个请求」。 */
const pendingReadStatusIds = new Set<number>();
let readStatusFlushTimer: ReturnType<typeof window.setTimeout> | null = null;

function flushReadStatusBatch() {
  readStatusFlushTimer = null;
  const ids = Array.from(pendingReadStatusIds);
  pendingReadStatusIds.clear();
  if (ids.length === 0) return;
  if (props.loadMessageReadStatusBatchHandler) {
    void props.loadMessageReadStatusBatchHandler(ids);
    return;
  }
  emit('loadMessageReadStatusBatch', ids);
}

function onMessageVisible(entry: IntersectionObserverEntry) {
  const messageId = Number((entry.target as HTMLElement).dataset.messageId);
  if (!Number.isFinite(messageId) || messageId <= 0) return;

  if (!visibleMessageIds.value.has(messageId)) {
    visibleMessageIds.value = new Set(visibleMessageIds.value).add(messageId);
  }

  if (props.messageReadStatus?.has(messageId)) return;

  // 已读状态只对自己发出的消息有意义，别人的消息不必查询
  const message = messageMap.value.get(messageId);
  if (!message || !props.meUserId || message.senderUserId !== props.meUserId) return;

  pendingReadStatusIds.add(messageId);
  if (readStatusFlushTimer) return;
  readStatusFlushTimer = window.setTimeout(flushReadStatusBatch, 150);
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
  if (item.kind === 'message') return item.message.senderUserId;
  if (item.kind === 'pendingText') return item.pendingText.senderUserId;
  return item.pendingUpload.senderUserId;
}

function getItemReplyTarget(item: RenderedChatItem) {
  if (item.kind === 'message') return getReplyTarget(item.message);
  if (item.kind === 'pendingText') return item.pendingText.replyToMessage ?? null;
  return item.pendingUpload.replyToMessage ?? null;
}

function getItemReplyTargetId(item: RenderedChatItem) {
  if (item.kind === 'message') return item.message.replyToMessageId ?? null;
  if (item.kind === 'pendingText') return item.pendingText.replyToMessageId ?? null;
  return item.pendingUpload.replyToMessageId ?? null;
}

function handleRetrySend(tempId: number) {
  if (props.retrySendHandler) {
    void props.retrySendHandler(tempId);
    return;
  }
  emit('retrySend', tempId);
}

function handleDiscardSend(tempId: number) {
  if (props.discardSendHandler) {
    props.discardSendHandler(tempId);
    return;
  }
  emit('discardSend', tempId);
}

// —— 滚动位置管理 ——
/** 用户是否停留在列表底部；决定新消息到达时是否自动跟随。 */
const isAtBottom = ref(true);
/** 用户上滑后累积的新消息条数，用于「回到最新」按钮提醒。 */
const unseenNewCount = ref(0);
const SCROLL_BOTTOM_THRESHOLD = 48;

function syncScrollState() {
  const wrap = getScrollWrap();
  if (!wrap) return;
  const atBottom = isLatestMessageInView(SCROLL_BOTTOM_THRESHOLD);
  isAtBottom.value = atBottom;
  if (atBottom) unseenNewCount.value = 0;
}

/**
 * 滚动位置锚定信息。
 * 上翻加载历史时，新内容插在顶部会把正在阅读的消息顶下去，
 * 这里记录加载前的滚动高度与首条消息 id，渲染完成后把视口补偿回来。
 */
let anchorState: { height: number; top: number; firstId: number } | null = null;
let lastLoadMoreAt = 0;

function requestLoadMore() {
  const wrap = getScrollWrap();
  anchorState = {
    height: wrap?.scrollHeight ?? 0,
    top: wrap?.scrollTop ?? 0,
    firstId: props.messages[0]?.id ?? 0,
  };
  emit('loadMore');
}

/** 滚动到顶部附近时自动加载更早的历史消息。 */
function handleScroll(payload?: { scrollTop?: number }) {
  syncScrollState();

  const wrap = getScrollWrap();
  const scrollTop = payload?.scrollTop ?? wrap?.scrollTop ?? 0;

  if (scrollTop > 96) {
    // 已经离开顶部，取消待生效的锚定，避免影响后续新消息
    if (anchorState && scrollTop > anchorState.top + 200) anchorState = null;
    return;
  }
  if (props.loadingMore || props.loading) return;

  const now = Date.now();
  if (now - lastLoadMoreAt < 400) return;
  lastLoadMoreAt = now;
  requestLoadMore();
}

function handleScrollToLatest() {
  unseenNewCount.value = 0;
  isAtBottom.value = true;
  scrollToBottom('smooth');
}

watch(
  () => renderedItems.value.length,
  async (newLength, oldLength) => {
    const grew = newLength > oldLength;
    const wasAtBottom = isAtBottom.value;
    await nextTick();

    if (!grew) return;

    // 优先处理「上翻历史」：恢复滚动位置，不跳到底部
    const currentFirstId = props.messages[0]?.id ?? 0;
    if (anchorState && currentFirstId !== anchorState.firstId) {
      const state = anchorState;
      anchorState = null;
      requestAnimationFrame(() => {
        const wrap = getScrollWrap();
        if (!wrap) return;
        const heightDelta = wrap.scrollHeight - state.height;
        if (heightDelta > 0) {
          wrap.scrollTop = state.top + heightDelta;
        }
        syncScrollState();
      });
      return;
    }

    if (wasAtBottom) {
      scrollToBottom('smooth');
      unseenNewCount.value = 0;
      return;
    }

    // 用户正在上翻历史：不打断阅读，只累计提示有新消息
    const hasIncomingFromOthers = props.messages.some(
      (message) => message.senderUserId !== props.meUserId,
    );
    if (hasIncomingFromOthers) {
      unseenNewCount.value += newLength - oldLength;
    }
  },
);

// 没有更多历史时清掉锚定状态，避免污染后续渲染
watch(
  () => props.loadingMore,
  (value) => {
    if (!value && anchorState && (props.messages[0]?.id ?? 0) === anchorState.firstId) {
      anchorState = null;
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
      <el-scrollbar ref="scrollbarRef" view-class="message-list-container" @scroll="handleScroll">
        <div v-if="props.loadingMore" class="history-loading">正在加载更早的消息…</div>
        <div v-if="props.meUserId" class="message-list">
          <template v-for="group in groupedMessages" :key="group.dateLabel">
            <div class="date-separator">
              <el-divider border-style="dashed">{{ group.dateLabel }}</el-divider>
            </div>

            <MessageItem v-for="item in group.items" :key="item.key" v-viewport="onMessageVisible"
              :data-message-id="item.kind === 'message' ? item.message.id : undefined"
              :message="item.kind === 'message' ? item.message : undefined"
              :pending-text="item.kind === 'pendingText' ? item.pendingText : undefined"
              :pending-upload="item.kind === 'pending' ? item.pendingUpload : undefined"
              :src="getMemberAvatarBySender(currentConversation, getItemSenderId(item))" :meUserId="props.meUserId"
              :thumbnail-src="getMemberAvatarSourcesBySender(currentConversation, getItemSenderId(item)).thumbnailSrc"
              :is-mine="getItemSenderId(item) === props.meUserId" :reply-target="getItemReplyTarget(item)"
              :reply-target-id="getItemReplyTargetId(item)" :allow-inline-media-load="shouldPreloadInlineMedia(item)"
              :highlighted="item.kind === 'message' && highlightedMessageId === item.message.id"
              v-bind="item.kind === 'message' ? getReadDisplay(item.message.id) : emptyReadDisplay"
              @contextmenu="handleItemContextMenu($event, item)"
              @avatar-context-menu="handleMessageAvatarContextMenu" @reply="emit('replyMessage', $event)"
              @recall="emit('recallMessage', $event)" @retry-send="handleRetrySend"
              @discard-send="handleDiscardSend" @jump-to-message="jumpToMessage" />
          </template>
        </div>
      </el-scrollbar>

      <transition name="el-fade-in">
        <button v-if="!isAtBottom && props.messages.length > 0" class="scroll-to-latest" type="button"
          @click="handleScrollToLatest">
          <span>{{ unseenNewCount > 0 ? `${unseenNewCount} 条新消息` : '回到最新' }}</span>
        </button>
      </transition>

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
          <el-button v-if="props.showBackToList" class="back-to-list" @click="emit('backToList')">
            会话列表
          </el-button>
          <h3>{{ conversationHeaderTitle }}</h3>
        </div>
        <el-button class="open-detail" :icon="Document" @click="isChatDetail = true">
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
          <el-button link class="replying-cancel" @click="emit('clearReplyMessage')">
            取消引用
          </el-button>
        </div>

        <div class="composer-main">
          <FileUploadButton :disabled="uploadingFiles" :context-key="currentConversation?.id ?? null"
            @file-selected="handleFileSelected" />
          <el-input ref="composerInputRef" v-model="model" type="textarea" :autosize="{ minRows: 1, maxRows: 6 }" resize="none"
            :placeholder="composerPlaceholder" @keydown="handleComposerKeydown" />
          <el-button type="primary" :loading="props.sending" :disabled="uploadingFiles || !model.trim()"
            @click="handleSendTextMessage">
            发送
          </el-button>
        </div>
      </div>

      <ConversationDetailDialog v-model="isChatDetail" :conversation="currentConversation"
        @update:conversation="emit('updateConversation', $event)"
        @load-more="emit('loadMore')" />

      <FilePreview v-if="galleryVisible" v-model="galleryVisible" :file-list="galleryFileList"
        v-model:current-index="galleryIndex" />

      <ChatContextMenu v-model="messageMenuVisible" :x="messageMenuX" :y="messageMenuY" :items="messageMenuItems"
        aria-label="消息操作" @select="handleMessageMenuSelect" />
      <ChatContextMenu v-model="avatarMenuVisible" :x="avatarMenuX" :y="avatarMenuY" :items="avatarMenuItems"
        aria-label="用户头像操作" @select="handleAvatarMenuSelect" />

      <ChatDialog v-model="dropUploadDialogVisible" title="确认上传文件" content-width="640px"
        :closable="!dropUploadBusy" :close-on-click-modal="!dropUploadBusy" :close-on-press-escape="!dropUploadBusy"
        :show-close="!dropUploadBusy" @closed="clearDroppedFiles">
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
            <el-button type="primary" :loading="dropUploadBusy" :disabled="!canConfirmDropUpload"
              @click="confirmDropUpload">
              上传 {{ validDroppedFiles.length }} 个文件
            </el-button>
          </div>
        </template>
      </ChatDialog>
    </div>

    <div v-else class="empty">请选择一个会话开始聊天。</div>
  </main>
</template>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

.date-separator {
  margin: 0 var(--chat-pad, 12px);
}

.history-loading {
  padding: 10px var(--chat-pad, 12px);
  color: #909399;
  font-size: 11px;
  text-align: center;
}

.scroll-to-latest {
  position: absolute;
  right: 18px;
  // 浮在输入区之上：输入区高度由全局 --chat-bar-h 给出
  // （大屏 32px 控件 + 12px 内边距 = 56px；移动端 24px 控件 + 6px 内边距 = 36px）
  bottom: calc(var(--chat-bar-h, 56px) + var(--chat-gap, 12px));
  z-index: 15;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--chat-accent, #9a4f8d);
  border-radius: 999px;
  color: var(--chat-accent, #9a4f8d);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  cursor: pointer;
  background: var(--chat-accent-soft, #f7e8f4);
  box-shadow: 0 8px 22px rgba(154, 79, 141, 0.18);
  transition: transform 0.15s ease, background-color 0.15s ease;

  &:hover {
    transform: translateY(-1px);
    background: color-mix(in srgb, var(--chat-accent-soft, #f7e8f4) 82%, #fff);
  }
}

.composer-main {
  :deep(.el-textarea) {
    min-width: 0;
  }

  // 输入框高度 = line-height + 上下内边距。与按钮同高：
  //   大屏：20 + 6*2 = 32px；移动端：20 + 2*2 = 24px（见下方 device-mobile）
  :deep(.el-textarea__inner) {
    padding: 6px 10px;
    line-height: 20px;
  }
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
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}

.drop-file-dialog {
  display: grid;
  gap: 12px;
}

.drop-file-question {
  color: #111827;
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
}

.drop-file-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  color: #6b7280;
  font-size: 12px;
  line-height: 18px;
}

.drop-file-list {
  display: grid;
  gap: 8px;
  // 弹层本身已有唯一滚动区（.chat-dialog-scrollbar），列表不再套第二层滚动。
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
  font-size: 13px;
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
  font-size: 11px;
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
  font-size: 11px;
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
  gap: var(--chat-gap, 8px);
  align-items: stretch;
}

.composer-main {
  display: flex;
  align-items: center;
  gap: var(--chat-gap, 6px);

  .el-input {
    min-width: 0;
  }
}

.replying-banner {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--chat-gap, 12px);
  padding: var(--chat-pad, 12px);
  border-left: 3px solid var(--chat-accent, #9a4f8d);
  border-radius: 8px;
  background: var(--chat-accent-soft, #f7e8f4);
}

.replying-banner-main {
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border-radius: 6px;
  transition: background-color 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--chat-accent-soft, #f7e8f4) 72%, #fff);
  }
}

.replying-label {
  color: var(--chat-accent, #9a4f8d);
  font-size: 11px;
  line-height: 18px;
}

.replying-sender {
  color: var(--chat-accent, #9a4f8d);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
}

.replying-preview {
  overflow: hidden;
  color: var(--chat-muted, #6b7280);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.replying-cancel {
  flex-shrink: 0;
}

// ==============================================
// 移动端（手机 + 平板）：24px 控件 / 6px 间距
// ==============================================
// 与全局 --chat-control-h 对齐：输入框高度 = 行高 20 + 上下内边距 2*2 = 24px，
// 正好和 24px 的按钮、圆形文件按钮齐平。
@include rp.device-mobile {
  .composer-main :deep(.el-textarea__inner) {
    padding: 2px 8px;
    line-height: 20px;
  }

  .date-separator {
    margin: 0 var(--chat-pad, 6px);
  }

  .scroll-to-latest {
    right: 8px;
    padding: 5px 10px;
    font-size: 11px;
    line-height: 16px;
  }

  .reply-action+.reply-action {
    margin-left: 6px;
  }

  // 「小屏压缩」：拖拽上传的提示框、引用条、拖拽文件列表都按窄屏收
  .drop-upload-indicator {
    min-width: 150px;
    padding: 22px 24px;
  }

  .replying-banner {
    grid-template-columns: 1fr;
    gap: 6px;
    padding: 6px;
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
