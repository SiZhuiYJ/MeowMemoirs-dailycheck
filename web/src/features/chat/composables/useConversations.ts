// composables/useConversations.ts
import { ref, computed } from "vue";
import { useAuthStore } from "@/stores";
import { storeToRefs } from "pinia";
import {
  createConversation as createConversationApi,
  getConversation as getConversationApi,
  getConversations as getConversationsApi,
  updateConversation as updateConversationApi,
  updateConversationMemberRole as updateConversationMemberRoleApi,
} from "../api/conversations";
import { useErrorHandler } from "./useErrorHandler";
import type {
  ConversationSummary,
  ConversationDetail,
  ConversationMember,
  CreateConversationPayload,
  UpdateConversationMemberRolePayload,
} from "../types";

export function useConversations() {
  const { user } = storeToRefs(useAuthStore());
  const { setError, clearError } = useErrorHandler();

  const conversations = ref<ConversationSummary[]>([]);
  const currentConversation = ref<ConversationDetail | null>(null);
  const loading = ref(false);

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

  async function hydrateDirectConversationTitles(items: ConversationSummary[]) {
    const directItems = items.filter(
      (item) => item.conversationType === "direct",
    );
    if (directItems.length === 0) return;

    const detailResults = await Promise.allSettled(
      directItems.map((item) => getConversationApi(item.id)),
    );

    detailResults.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const detail = result.value.data;
      const displayName = getDirectPeerDisplayName(detail);
      if (!displayName) return;
      const conversationId = directItems[index]?.id;
      if (conversationId)
        updateConversationSummaryTitle(conversationId, displayName);
    });
  }

  async function loadConversations() {
    loading.value = true;
    clearError();
    try {
      const items = (await getConversationsApi()).data;
      conversations.value = items;
      await hydrateDirectConversationTitles(items);
    } catch (error: any) {
      setError(error, "加载会话失败");
    } finally {
      loading.value = false;
    }
  }

  async function selectConversation(item: ConversationSummary) {
    loading.value = true;
    clearError();
    try {
      const detail = (await getConversationApi(item.id)).data;
      currentConversation.value = detail;
      if (detail.conversationType === "direct") {
        const directName = getDirectPeerDisplayName(detail);
        if (directName) {
          currentConversation.value.title = directName;
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
      await loadConversations();
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
    loading.value = true;
    clearError();
    try {
      await updateConversationApi(detail.id, {
        title: detail.title,
        avatarKey: detail.avatarKey,
        isActive: detail.isActive,
        isPinned: detail.isPinned,
        isMuted: detail.isMuted,
      });
      await loadConversations();
      // 更新当前会话引用（如果仍选中同一会话）
      if (currentConversation.value?.id === detail.id) {
        currentConversation.value = { ...currentConversation.value, ...detail };
      }
    } catch (error: any) {
      setError(error, "更新会话失败");
    } finally {
      loading.value = false;
    }
  }

  async function updateConversationMemberRole(
    conversationId: number,
    memberUserId: number,
    memberRole: UpdateConversationMemberRolePayload["memberRole"],
  ) {
    loading.value = true;
    clearError();
    try {
      const detail = (await updateConversationMemberRoleApi(conversationId, memberUserId, { memberRole })).data;
      if (currentConversation.value?.id === conversationId) {
        currentConversation.value = detail;
      }
      await loadConversations();
      return detail;
    } catch (error: any) {
      setError(error, "更新成员权限失败");
      return null;
    } finally {
      loading.value = false;
    }
  }

  return {
    conversations,
    currentConversation,
    loading,
    selectedConversationId,
    loadConversations,
    selectConversation,
    createConversation,
    updateConversation,
    updateConversationMemberRole,
    getDirectPeerDisplayName,
    updateConversationSummaryTitle,
  };
}
