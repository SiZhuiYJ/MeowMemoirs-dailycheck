// composables/useChatCore.ts
import { ref, watch, onBeforeUnmount, computed } from "vue";
import { useAuthStore } from "@/stores";
import { storeToRefs } from "pinia";
import { useConversations } from "./useConversations";
import { useMessages } from "./useMessages";
import { useMessageRead } from "./useMessageRead";
import { useChatPush } from "./useChatPush";
import type {
  ConversationDetailUpdateOptions,
  ConversationSummary,
  MessageSummary,
  SendMessagePayload,
} from "../types";

/** 单次批量查询已读状态的最大消息数，避免超长 URL。 */
const MAX_READ_STATUS_BATCH = 200;

export function useChatCore() {
  const { user } = storeToRefs(useAuthStore());
  const meUserId = ref(useAuthStore().user?.userId);
  const friendRequestVersion = ref(0);
  const friendshipVersion = ref(0);

  watch(
    () => user.value?.userId,
    (val) => {
      meUserId.value = val;
    },
  );

  const replyingMessage = ref<MessageSummary | null>(null);

  function setReplyingMessage(message: MessageSummary) {
    replyingMessage.value = message;
  }

  function clearReplyingMessage() {
    replyingMessage.value = null;
  }

  // 子模块
  const conversationsModule = useConversations();
  const messagesModule = useMessages(
    () => conversationsModule.selectedConversationId.value,
  );
  const readModule = useMessageRead(
    () => conversationsModule.selectedConversationId.value,
    () => meUserId.value,
  );

  function applyLocalReadState(lastReadMessageId?: number | null) {
    const conversationId = conversationsModule.selectedConversationId.value;
    if (!conversationId) return;

    conversationsModule.clearUnread(conversationId);

    const currentConversation = conversationsModule.currentConversation.value;
    if (!currentConversation || currentConversation.id !== conversationId) return;

    const selfUserId = meUserId.value;
    if (!selfUserId) return;

    const selfMember = currentConversation.members.find(
      (member) => member.userId === selfUserId,
    );
    if (selfMember) {
      selfMember.lastReadMessageId =
        lastReadMessageId ?? selfMember.lastReadMessageId ?? null;
    }
  }

  /**
   * 上报当前会话已读位置。
   * 只在「窗口可见 + 已读位置前进」时才发请求，避免后台标签页和轮询反复上报。
   */
  async function markCurrentConversationRead() {
    const conversationId = conversationsModule.selectedConversationId.value;
    if (!conversationId) return;

    if (typeof document !== "undefined" && document.hidden) return;

    const lastMsg =
      messagesModule.messages.value[messagesModule.messages.value.length - 1];
    if (!lastMsg) return;

    // 已读位置应停在「最后一条别人发的消息」上：
    // 只标记自己的消息没有意义（服务端本来就不算自己发的为未读），
    // 而直接跳过又会让更早的未读一直留着。
    const lastIncoming = [...messagesModule.messages.value]
      .reverse()
      .find(
        (message) => message.senderUserId !== meUserId.value && !message.isRecalled,
      );

    if (!lastIncoming) {
      applyLocalReadState(lastMsg.id);
      return;
    }

    const result = await readModule.markRead(lastIncoming.id);
    applyLocalReadState(result?.lastReadMessageId ?? lastIncoming.id);
  }

  // 组合 loading / error：只反映「阻塞式」加载，后台刷新不再让界面进入加载态
  const loading = computed(
    () => conversationsModule.loading.value || messagesModule.loading.value,
  );
  const refreshing = computed(
    () =>
      conversationsModule.refreshing.value ||
      messagesModule.loadingMore.value ||
      messagesModule.sending.value,
  );

  // 推送模块（依赖以上模块的方法）
  const pushModule = useChatPush({
    fetchConversations: (options) => conversationsModule.loadConversations(options),
    syncCurrentMessages: messagesModule.syncLatest,
    markRead: markCurrentConversationRead,
    hasConversation: () => !!conversationsModule.currentConversation.value,
    getConversationId: () => conversationsModule.selectedConversationId.value,
    getToken: () => useAuthStore().accessToken || "",
    getBaseUrl: () => import.meta.env.VITE_API_BASE_URL || "",
    upsertMessage: (message) => {
      messagesModule.upsertMessage(message);
    },
    onMessageRead: (data) => {
      // 合并成一次批量请求，避免每条回执一个 HTTP 请求
      readModule.queueReadStatusRefresh(data.messageId);
    },
    onIncomingMessage: (payload) => {
      if (!payload.message) return;
      conversationsModule.applyMessageToSummary(
        payload.conversationId,
        payload.message,
        { unreadCount: payload.unreadCount },
      );
    },
    onFriendRequestsUpdated: () => {
      friendRequestVersion.value += 1;
    },
    onFriendshipsUpdated: () => {
      friendshipVersion.value += 1;
    },
    getAllConversationIds: () =>
      conversationsModule.conversations.value.map((c) => c.id),
  });

  /** 批量加载已读状态：一次请求代替「每条消息一个请求」。 */
  async function loadOwnMessageReadStatuses() {
    const selfUserId = meUserId.value;
    if (!selfUserId) return;

    const ids = messagesModule.messages.value
      .filter((message) => message.senderUserId === selfUserId && message.id > 0)
      .map((message) => message.id);

    if (ids.length === 0) return;
    const trimmed = ids.length > MAX_READ_STATUS_BATCH
      ? ids.slice(-MAX_READ_STATUS_BATCH)
      : ids;
    await readModule.loadBatchMessageReadStatus(trimmed);
  }

  // 选择会话：重置状态 -> 拉详情 -> 拉消息 -> 标记已读 -> 订阅 -> 批量已读状态
  async function selectConversation(item: ConversationSummary) {
    clearReplyingMessage();
    messagesModule.resetMessages();
    readModule.clearReadStatus();

    const detail = await conversationsModule.selectConversation(item);
    if (!detail) return null;

    conversationsModule.clearUnread(detail.id);
    await messagesModule.loadMessages();
    await markCurrentConversationRead();
    await pushModule.subscribeConversation(detail.id);
    await loadOwnMessageReadStatuses();

    return detail;
  }

  // 发送消息：本地立即落一条会话预览，不再整表重拉会话列表
  async function sendMessage(payload: SendMessagePayload) {
    const effectivePayload: SendMessagePayload = {
      ...payload,
      replyToMessageId: payload.replyToMessageId ?? replyingMessage.value?.id ?? null,
    };

    const newMsg = await messagesModule.sendMessage(effectivePayload);
    const conversationId = conversationsModule.selectedConversationId.value;

    if (newMsg) {
      if (effectivePayload.replyToMessageId) {
        clearReplyingMessage();
      }
      if (conversationId) {
        conversationsModule.applyMessageToSummary(conversationId, newMsg);
      }
      // 非阻塞：只查这一条的已读状态
      void readModule.loadMessageReadStatus(newMsg.id);
    }
    return newMsg;
  }

  async function retrySendMessage(tempId: number) {
    const conversationId = conversationsModule.selectedConversationId.value;
    await messagesModule.retrySendMessage(tempId);
    const lastOwn = [...messagesModule.messages.value]
      .reverse()
      .find((message) => message.senderUserId === meUserId.value);
    if (lastOwn) {
      if (conversationId) {
        conversationsModule.applyMessageToSummary(conversationId, lastOwn);
      }
      void readModule.loadMessageReadStatus(lastOwn.id);
    }
  }

  // 创建会话的表单状态
  const createTitle = ref("");
  const createMemberUserIds = ref<number[]>([]);
  const composeText = ref("");

  watch(
    () => conversationsModule.selectedConversationId.value,
    (conversationId, previousConversationId) => {
      if (conversationId !== previousConversationId) {
        clearReplyingMessage();
      }
    },
  );

  watch(
    () => messagesModule.messages.value,
    (messages) => {
      if (!replyingMessage.value) return;
      const latestReplyTarget = messages.find(
        (message) => message.id === replyingMessage.value?.id,
      );
      if (!latestReplyTarget || latestReplyTarget.isRecalled) {
        clearReplyingMessage();
        return;
      }
      replyingMessage.value = latestReplyTarget;
    },
  );

  async function handleCreateConversation() {
    const memberUserIds = createMemberUserIds.value
      .filter((x) => Number.isFinite(x) && x > 0)
      .filter((value, index, array) => array.indexOf(value) === index);
    const conversationType = memberUserIds.length > 1 ? "group" : "direct";
    const detail = await conversationsModule.createConversation({
      conversationType,
      title: createTitle.value || undefined,
      memberUserIds,
    });
    if (detail) {
      createTitle.value = "";
      createMemberUserIds.value = [];
    }
  }

  async function handleSendText(replyToMessageId?: number | null) {
    const content = composeText.value.trim();
    if (!content) return;

    const pendingBefore = messagesModule.pendingTextMessages.value.length;
    const effectiveReplyToMessageId =
      replyToMessageId ?? replyingMessage.value?.id ?? null;

    const sentMessage = await messagesModule.sendMessage({
      messageType: "text",
      content,
      replyToMessageId: effectiveReplyToMessageId,
    });

    const conversationId = conversationsModule.selectedConversationId.value;
    if (sentMessage) {
      if (replyingMessage.value?.id === effectiveReplyToMessageId) {
        clearReplyingMessage();
      }
      if (conversationId) {
        conversationsModule.applyMessageToSummary(conversationId, sentMessage);
      }
      void readModule.loadMessageReadStatus(sentMessage.id);
    }

    // 无论成功还是「已本地暂存待重试」，输入框都清空；
    // 真正失败时消息会以「发送失败」留在列表里并可重试。
    
    const hasLocalPending =
      messagesModule.pendingTextMessages.value.length > pendingBefore;
    if (sentMessage || hasLocalPending) {
      composeText.value = "";
    }
  }

  async function handleRecallMessage(message: MessageSummary) {
    const recalledMessage = await messagesModule.recallMessage(message.id);
    if (recalledMessage) {
      if (replyingMessage.value?.id === recalledMessage.id) {
        clearReplyingMessage();
      }
      const conversationId = conversationsModule.selectedConversationId.value;
      if (conversationId) {
        conversationsModule.applyMessageToSummary(conversationId, recalledMessage);
      }
    }
    return recalledMessage;
  }

  async function handleConversationDetailUpdate(
    options?: ConversationDetailUpdateOptions,
  ) {
    if (options?.persist && conversationsModule.currentConversation.value) {
      await conversationsModule.updateConversation(
        conversationsModule.currentConversation.value,
      );
      return;
    }

    await conversationsModule.loadConversations({ silent: true });

    if (options?.clearCurrent) {
      clearReplyingMessage();
      conversationsModule.currentConversation.value = null;
      messagesModule.resetMessages();
      readModule.clearReadStatus();
    }
  }

  const togglePush = (force?: boolean) => pushModule.togglePush(force);

  onBeforeUnmount(() => {
    pushModule.stopPush();
  });

  return {
    // 状态
    meUserId,
    loading,
    refreshing,
    totalUnreadCount: conversationsModule.totalUnreadCount,
    conversations: conversationsModule.conversations,
    currentConversation: conversationsModule.currentConversation,
    selectedConversationId: conversationsModule.selectedConversationId,
    messages: messagesModule.messages,
    pendingTextMessages: messagesModule.pendingTextMessages,
    sending: messagesModule.sending,
    loadingMore: messagesModule.loadingMore,
    messageReadStatus: readModule.messageReadStatus,
    replyingMessage,

    // 方法
    loadConversations: conversationsModule.loadConversations,
    selectConversation,
    updateConversation: conversationsModule.updateConversation,
    updateConversationMemberRole: conversationsModule.updateConversationMemberRole,
    handleConversationDetailUpdate,
    loadMore: messagesModule.loadMore,
    sendTextMessage: handleSendText,
    sendMessage,
    retrySendMessage,
    discardPendingTextMessage: messagesModule.discardPendingTextMessage,
    recallMessage: handleRecallMessage,
    markRead: markCurrentConversationRead,
    syncLatestMessages: messagesModule.syncLatest,
    setReplyingMessage,
    clearReplyingMessage,

    // 推送相关
    polling: pushModule.polling,
    realtimeConnected: pushModule.realtimeConnected,
    statusText: pushModule.statusText,
    togglePush,

    // 表单
    createTitle,
    createMemberUserIds,
    composeText,
    friendRequestVersion,
    friendshipVersion,
    handleCreateConversation,

    // 已读状态辅助方法
    getReadInfo: readModule.getReadInfo,
    loadMessageReadStatus: readModule.loadMessageReadStatus,
    loadBatchMessageReadStatus: readModule.loadBatchMessageReadStatus,
  };
}
