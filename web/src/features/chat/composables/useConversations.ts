// composables/useConversations.ts
import { ref, computed } from "vue";
import { useAuthStore } from "@/stores";
import { storeToRefs } from "pinia";
import {
  createConversation as createConversationApi,
  deleteConversationHistory as deleteConversationHistoryApi,
  getConversation as getConversationApi,
  getConversations as getConversationsApi,
  updateConversation as updateConversationApi,
  updateConversationMemberRole as updateConversationMemberRoleApi,
  updateConversationPreferences as updateConversationPreferencesApi,
} from "../api/conversations";
import { toTimestamp } from "../utils/chat";
import { useErrorHandler } from "./useErrorHandler";
import type {
  ConversationSummary,
  ConversationDetail,
  ConversationMember,
  CreateConversationPayload,
  MessageSummary,
  UpdateConversationMemberRolePayload,
  UpdateConversationPreferences,
} from "../types";

export function useConversations() {
  const { user } = storeToRefs(useAuthStore());
  const { setError, clearError } = useErrorHandler();

  const conversations = ref<ConversationSummary[]>([]);
  const currentConversation = ref<ConversationDetail | null>(null);
  /** 阻塞式加载：仅在首次进入/切换会话时置位，避免后台刷新把界面打成加载态。 */
  const loading = ref(false);
  /** 后台静默刷新中。 */
  const refreshing = ref(false);

  /** 直聊标题缓存：conversationId -> 展示名。避免每次刷新都重新请求会话详情。 */
  const directTitleCache = new Map<number, string>();
  let hydratingTitles = false;

  const selectedConversationId = computed(
    () => currentConversation.value?.id || 0,
  );

  function getMemberDisplayName(member?: ConversationMember | null) {
    if (!member) return "";
    return (
      member.nickName?.trim() ||
      member.userAccount?.trim() ||
      String(member.userId)
    );
  }

  function getDirectPeerDisplayName(detail: ConversationDetail) {
    if (detail.friendRemark?.trim()) {
      return detail.friendRemark.trim();
    }
    const currentUserId = user.value?.userId;
    const peer = detail.members.find((m) => m.userId !== currentUserId);
    return getMemberDisplayName(peer);
  }

  function updateConversationSummaryTitle(
    conversationId: number,
    title: string,
  ) {
    const target = conversations.value.find(
      (item) => item.id === conversationId,
    );
    if (target) target.title = title;
  }

  /** 会话展示用的最近活跃时间：优先最后一条消息时间，其次会话更新时间。 */
  function getConversationActivityTime(item: ConversationSummary) {
    const lastMessageTime = item.lastMessage?.createdAt
      ? toTimestamp(item.lastMessage.createdAt)
      : NaN;
    if (!Number.isNaN(lastMessageTime)) return lastMessageTime;
    const updatedAt = item.updatedAt ? toTimestamp(item.updatedAt) : NaN;
    return Number.isNaN(updatedAt) ? 0 : updatedAt;
  }

  /**
   * 统一排序：置顶优先，其次按最近活跃时间倒序，最后按 id 倒序兜底。
   * 排序在前端本地完成，保证「自己刚发的消息」立即把会话顶上去，
   * 不用等服务端返回。
   */
  function sortConversations() {
    conversations.value = [...conversations.value].sort((left, right) => {
      if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
      const timeDiff = getConversationActivityTime(right) - getConversationActivityTime(left);
      if (timeDiff !== 0) return timeDiff;
      return right.id - left.id;
    });
  }

  /**
   * 直聊会话没有标题时，用对端昵称补齐。
   * 旧实现：在 loadConversations 里 await 全部直聊的详情请求，
   * 每次刷新（包括每 5 秒的轮询）都会重复请求一遍，直接把首屏和发送拖慢。
   * 新实现：后台执行 + 结果缓存 + 只处理缺标题的会话 + 限制并发。
   */
  async function hydrateDirectConversationTitles(items: ConversationSummary[]) {
    if (hydratingTitles) return;

    const directItems = items.filter(
      (item) => item.conversationType === "direct",
    );
    if (directItems.length === 0) return;

    // 先套用缓存，命中缓存的会话不再发请求
    const pending: ConversationSummary[] = [];
    for (const item of directItems) {
      if (item.title?.trim()) continue;
      const cached = directTitleCache.get(item.id);
      if (cached) {
        item.title = cached;
        continue;
      }
      pending.push(item);
    }
    if (pending.length === 0) return;

    hydratingTitles = true;
    const CONCURRENCY = 3;
    try {
      for (let index = 0; index < pending.length; index += CONCURRENCY) {
        const chunk = pending.slice(index, index + CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map((item) => getConversationApi(item.id)),
        );
        results.forEach((result, offset) => {
          if (result.status !== "fulfilled") return;
          const detail = result.value.data;
          const displayName = getDirectPeerDisplayName(detail);
          const target = chunk[offset];
          if (!displayName || !target) return;
          directTitleCache.set(target.id, displayName);
          updateConversationSummaryTitle(target.id, displayName);
        });
      }
    } finally {
      hydratingTitles = false;
    }
  }

  /**
   * 拉取会话列表。
   * silent=true 用于轮询/推送触发的后台刷新：不显示加载态、失败不弹提示。
   */
  async function loadConversations(options?: { silent?: boolean }) {
    const silent = options?.silent === true;
    if (silent) {
      refreshing.value = true;
    } else {
      loading.value = true;
      clearError();
    }

    try {
      const items = (await getConversationsApi({ showError: !silent })).data;
      conversations.value = items;
      sortConversations();
      // 不阻塞：标题补齐在后台进行
      void hydrateDirectConversationTitles(items);
    } catch (error: any) {
      if (!silent) setError(error, "加载会话失败");
    } finally {
      if (silent) refreshing.value = false;
      else loading.value = false;
    }
  }

  async function selectConversation(item: ConversationSummary) {
    clearError();
    // 已有详情且是同一会话时直接复用，避免重复请求造成的闪烁
    if (currentConversation.value?.id === item.id) return currentConversation.value;

    loading.value = true;
    try {
      const detail = (await getConversationApi(item.id)).data;
      currentConversation.value = detail;
      if (detail.conversationType === "direct") {
        const directName = getDirectPeerDisplayName(detail);
        if (directName) {
          currentConversation.value.title = directName;
          directTitleCache.set(detail.id, directName);
          updateConversationSummaryTitle(detail.id, directName);
        }
      }
      return detail;
    } catch (error: any) {
      setError(error, "加载会话失败");
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function createConversation(payload: CreateConversationPayload) {
    loading.value = true;
    clearError();
    try {
      const detail = (await createConversationApi(payload)).data;
      await loadConversations({ silent: true });
      await selectConversation({
        id: detail.id,
        conversationType: detail.conversationType,
        title: detail.title,
        avatarKey: detail.avatarKey,
        avatarUserId: detail.avatarUserId,
        isActive: detail.isActive,
        isPinned: detail.isPinned,
        isMuted: detail.isMuted,
        updatedAt: detail.updatedAt,
        unreadCount: 0,
        lastMessage: null,
      });
      return detail;
    } catch (error: any) {
      setError(error, "创建会话失败");
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function updateConversation(detail: ConversationDetail) {
    clearError();
    try {
      await updateConversationApi(detail.id, {
        title: detail.title,
        avatarKey: detail.avatarKey,
        isActive: detail.isActive,
        isPinned: detail.isPinned,
        isMuted: detail.isMuted,
      });
      await loadConversations({ silent: true });
      // 更新当前会话引用（如果仍选中同一会话）
      if (currentConversation.value?.id === detail.id) {
        currentConversation.value = { ...currentConversation.value, ...detail };
      }
    } catch (error: any) {
      setError(error, "更新会话失败");
    }
  }

  async function updateConversationMemberRole(
    conversationId: number,
    memberUserId: number,
    memberRole: UpdateConversationMemberRolePayload["memberRole"],
  ) {
    clearError();
    try {
      const detail = (await updateConversationMemberRoleApi(conversationId, memberUserId, { memberRole })).data;
      if (currentConversation.value?.id === conversationId) {
        currentConversation.value = detail;
      }
      await loadConversations({ silent: true });
      return detail;
    } catch (error: any) {
      setError(error, "更新成员权限失败");
      return null;
    }
  }

  /**
   * 更新当前用户的个人会话设置（置顶 / 消息免打扰）。
   *
   * 只提交 isPinned / isMuted：服务端 UpdateConversation 会按「字段真正变化」
   * 判断是否属于修改群资料，因此普通成员也不会被误判成改群资料而收到 403。
   *
   * 先做本地乐观更新，失败再回滚，避免右键菜单点完后列表要等一个往返才动。
   */
  async function setConversationPreference(
    item: ConversationSummary,
    patch: UpdateConversationPreferences,
  ) {
    const previous = { isPinned: item.isPinned, isMuted: item.isMuted };

    if (typeof patch.isPinned === "boolean") item.isPinned = patch.isPinned;
    if (typeof patch.isMuted === "boolean") item.isMuted = patch.isMuted;
    sortConversations();

    try {
      const detail = (await updateConversationPreferencesApi(item.id, patch)).data;
      item.isPinned = detail.isPinned;
      item.isMuted = detail.isMuted;

      if (currentConversation.value?.id === item.id) {
        currentConversation.value.isPinned = detail.isPinned;
        currentConversation.value.isMuted = detail.isMuted;
      }

      sortConversations();
    } catch (error: any) {
      item.isPinned = previous.isPinned;
      item.isMuted = previous.isMuted;
      sortConversations();
      setError(error, "更新会话设置失败");
    }
  }

  /**
   * 删除会话聊天记录（仅自己不可见，伪删除）。
   *
   * 服务端会隐藏该会话并把历史清除游标推到最新；本地直接把它从列表移除，
   * 当前打开的就是它时清空 currentConversation，由上层决定是否关闭面板。
   */
  async function deleteConversationHistory(item: ConversationSummary) {
    clearError();
    try {
      await deleteConversationHistoryApi(item.id);
      conversations.value = conversations.value.filter(
        (conversation) => conversation.id !== item.id,
      );

      if (currentConversation.value?.id === item.id) {
        currentConversation.value = null;
      }

      return true;
    } catch (error: any) {
      setError(error, "删除会话失败");
      return false;
    }
  }

  /**
   * 本地应用一条新消息到会话列表（乐观更新）。
   * 用于自己刚发出的消息：立即更新预览、排序与未读数，不必整表重拉。
   */
  function applyMessageToSummary(
    conversationId: number,
    message: MessageSummary,
    options?: { unreadCount?: number },
  ) {
    const target = conversations.value.find((item) => item.id === conversationId);
    if (!target) return;

    const isCurrent = currentConversation.value?.id === conversationId;
    const isMine = message.senderUserId === user.value?.userId;

    // 撤回消息的 id 可能等于 lastMessage（最后一条被撤回）——
    // 相等时要刷新预览；但若已经有更新的消息（例如管理撤回后紧跟的系统提示），
    // 不能再用这条旧消息把预览覆盖回去。
    const currentLastId = target.lastMessage?.id ?? 0;
    const isStale = message.id > 0 && message.id < currentLastId;
    if (isStale) return;

    target.lastMessage = message;
    target.updatedAt = message.createdAt;

    if (isCurrent) {
      target.unreadCount = 0;
    } else if (typeof options?.unreadCount === "number") {
      target.unreadCount = options.unreadCount;
    } else if (!isMine && !message.isRecalled && message.messageType !== "system") {
      // 与服务端未读口径一致：撤回事件、系统提示都不算未读
      target.unreadCount = (target.unreadCount ?? 0) + 1;
    }

    sortConversations();
  }

  /** 清零未读数（进入会话/标记已读后调用）。 */
  function clearUnread(conversationId: number) {
    const target = conversations.value.find((item) => item.id === conversationId);
    if (target && target.unreadCount !== 0) target.unreadCount = 0;
  }

  /** 未读总数，用于页面标题/角标。 */
  const totalUnreadCount = computed(() =>
    conversations.value.reduce(
      (total, item) => total + (item.isMuted ? 0 : item.unreadCount ?? 0),
      0,
    ),
  );

  return {
    conversations,
    currentConversation,
    loading,
    refreshing,
    totalUnreadCount,
    selectedConversationId,
    loadConversations,
    selectConversation,
    createConversation,
    updateConversation,
    updateConversationMemberRole,
    setConversationPreference,
    deleteConversationHistory,
    getDirectPeerDisplayName,
    updateConversationSummaryTitle,
    applyMessageToSummary,
    clearUnread,
    sortConversations,
  };
}
