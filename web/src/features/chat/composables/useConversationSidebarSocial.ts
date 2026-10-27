import {
  acceptFriendRequest,
  createFriendRequest,
  getBlockedUsers,
  getFriendRequests,
  getFriends,
  rejectFriendRequest,
  searchFriendUsers,
  unblockUser,
} from "../api/friends";
import {
  createGroupJoinRequest,
  searchGroupConversation,
} from "../api/conversations";
import type {
  BlockedUser,
  FriendRequest,
  FriendSearchResult,
  Friendship,
  GroupSearchResult,
} from "../types";
import { formatChatTime, toTimestamp } from "../utils/chat";
import {
  getConversationAvatarSources as getConversationAssetSources,
  getUserAvatarSources,
} from "@/utils/avatar";
import { computed, onMounted, ref, watch } from "vue";

export type SidebarActionCommand =
  | "groupJoin"
  | "addFriend"
  | "friendRequest"
  | "blacklist";

const friendRequestStatusMap: Record<FriendRequest["requestStatus"], string> = {
  pending: "待处理",
  accepted: "已通过",
  rejected: "已拒绝",
  cancelled: "已取消",
  expired: "已过期",
};

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const responseMessage = (
      error as { response?: { data?: { message?: unknown } } }
    ).response?.data?.message;
    if (typeof responseMessage === "string" && responseMessage.trim()) {
      return responseMessage;
    }

    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

function getRequestStatusType(status: FriendRequest["requestStatus"]) {
  switch (status) {
    case "pending":
      return "warning";
    case "accepted":
      return "success";
    case "rejected":
      return "danger";
    default:
      return "info";
  }
}

function resolveFriendRequestTarget(request: FriendRequest) {
  return request.direction === "received" ? request.requester : request.receiver;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightKeyword(text: string, keyword: string) {
  if (!text || !keyword) return escapeHtml(text);

  const normalizedText = text.toLocaleLowerCase();
  const normalizedKeyword = keyword.toLocaleLowerCase();
  let start = 0;
  let highlighted = "";

  while (start < text.length) {
    const index = normalizedText.indexOf(normalizedKeyword, start);
    if (index < 0) {
      highlighted += escapeHtml(text.slice(start));
      break;
    }

    highlighted += escapeHtml(text.slice(start, index));
    highlighted += `<span class="match-highlight">${escapeHtml(
      text.slice(index, index + keyword.length),
    )}</span>`;
    start = index + keyword.length;
  }

  return highlighted;
}

export function useConversationSidebarSocial(options: {
  friendRequestVersion: () => number;
  friendshipVersion: () => number;
}) {
  const friendRequestDialogVisible = ref(false);
  const friendRequestLoading = ref(false);
  const handlingRequestId = ref<number | null>(null);
  const friendRequests = ref<FriendRequest[]>([]);
  const friendSearchDialogVisible = ref(false);
  const friendSearchLoading = ref(false);
  const friendSearchSubmittingId = ref<number | null>(null);
  const friendSearchKeyword = ref("");
  const friendSearchRequestMessage = ref("");
  const friendSearchResults = ref<FriendSearchResult[]>([]);
  const friendSearchSearched = ref(false);
  const groupJoinDialogVisible = ref(false);
  const groupSearchLoading = ref(false);
  const groupJoinSubmitting = ref(false);
  const groupJoinConversationIdInput = ref("");
  const groupJoinRequestMessage = ref("");
  const groupSearchResult = ref<GroupSearchResult | null>(null);
  const groupSearchSearched = ref(false);
  const friendLoading = ref(false);
  const friends = ref<Friendship[]>([]);
  const blacklistDialogVisible = ref(false);
  const blacklistLoading = ref(false);
  const blacklist = ref<BlockedUser[]>([]);
  const blacklistUnblockingId = ref<number | null>(null);

  const trimmedFriendSearchKeyword = computed(() =>
    friendSearchKeyword.value.trim(),
  );

  const canSearchFriend = computed(
    () => trimmedFriendSearchKeyword.value.length > 0,
  );

  const normalizedGroupJoinConversationId = computed(() => {
    const value = Number.parseInt(groupJoinConversationIdInput.value.trim(), 10);
    return Number.isInteger(value) && value > 0 ? value : 0;
  });

  const canSearchGroup = computed(
    () => normalizedGroupJoinConversationId.value > 0,
  );

  const canSubmitGroupJoin = computed(
    () =>
      groupSearchResult.value !== null &&
      !groupSearchResult.value.isMember &&
      !groupSearchResult.value.hasPendingJoinRequest,
  );

  const sortedFriendRequests = computed(() =>
    [...friendRequests.value].sort(
      (left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt),
    ),
  );

  const pendingFriendRequestCount = computed(
    () =>
      friendRequests.value.filter(
        (item) =>
          item.direction === "received" && item.requestStatus === "pending",
      ).length,
  );

  const canCloseFriendSearchDialog = computed(
    () => friendSearchSubmittingId.value === null,
  );

  const canCloseGroupJoinDialog = computed(() => !groupJoinSubmitting.value);

  watch(friendSearchKeyword, () => {
    friendSearchResults.value = [];
    friendSearchSearched.value = false;
  });

  watch(groupJoinConversationIdInput, () => {
    groupSearchResult.value = null;
    groupSearchSearched.value = false;
  });

  async function loadFriends() {
    friendLoading.value = true;
    try {
      const { data } = await getFriends();
      friends.value = data;
    } catch (error) {
      ElMessage.error(getErrorMessage(error, "加载好友列表失败"));
    } finally {
      friendLoading.value = false;
    }
  }

  async function loadRequests(options: { silent?: boolean } = {}) {
    const { silent = false } = options;
    friendRequestLoading.value = true;
    try {
      const { data } = await getFriendRequests();
      friendRequests.value = data;
    } catch (error) {
      if (!silent) {
        ElMessage.error(getErrorMessage(error, "加载好友申请失败"));
      }
    } finally {
      friendRequestLoading.value = false;
    }
  }

  async function loadBlacklist(options: { silent?: boolean } = {}) {
    const { silent = false } = options;
    blacklistLoading.value = true;
    try {
      const { data } = await getBlockedUsers();
      blacklist.value = data;
    } catch (error) {
      if (!silent) {
        ElMessage.error(getErrorMessage(error, "加载黑名单失败"));
      }
    } finally {
      blacklistLoading.value = false;
    }
  }

  async function refreshFriendData(
    includeRequests = friendRequestDialogVisible.value,
  ) {
    const tasks: Promise<unknown>[] = [
      loadFriends(),
      loadBlacklist({ silent: true }),
    ];
    if (includeRequests) {
      tasks.push(loadRequests());
    }
    await Promise.all(tasks);
  }

  async function openBlacklistDialog() {
    blacklistDialogVisible.value = true;
    await loadBlacklist();
  }

  async function handleUnblockUser(item: BlockedUser) {
    if (blacklistUnblockingId.value !== null) return;

    try {
      await ElMessageBox.confirm(
        `解除拉黑后，${getBlockedUserLabel(item)} 可以重新添加你为好友、与你聊天，并在搜索中找到你。`,
        "解除拉黑",
        {
          type: "warning",
          confirmButtonText: "解除拉黑",
          cancelButtonText: "取消",
        },
      );
    } catch {
      return;
    }

    blacklistUnblockingId.value = item.userId;
    try {
      await unblockUser(item.userId);
      ElMessage.success("已解除拉黑");
      await Promise.all([
        loadBlacklist({ silent: true }),
        loadFriends(),
        loadRequests({ silent: true }),
      ]);
    } catch (error) {
      ElMessage.error(getErrorMessage(error, "解除拉黑失败"));
    } finally {
      blacklistUnblockingId.value = null;
    }
  }

  function getBlockedUserLabel(item: BlockedUser) {
    return item.nickName?.trim() || item.userAccount?.trim() || String(item.userId);
  }

  function getBlockedUserMeta(item: BlockedUser) {
    return item.userAccount?.trim() || `ID: ${item.userId}`;
  }

  function getBlockedUserAvatar(item: BlockedUser) {
    return getUserAvatarSources(item.userId, item.avatarKey);
  }

  function formatBlockedAt(createdAt: string) {
    return formatChatTime(createdAt);
  }

  async function openFriendRequestDialog() {
    friendRequestDialogVisible.value = true;
    await refreshFriendData(true);
  }

  function resetFriendSearchDialog() {
    friendSearchDialogVisible.value = false;
    friendSearchKeyword.value = "";
    friendSearchRequestMessage.value = "";
    friendSearchResults.value = [];
    friendSearchSearched.value = false;
    friendSearchSubmittingId.value = null;
  }

  function openAddFriendDialog() {
    resetFriendSearchDialog();
    friendSearchDialogVisible.value = true;
  }

  function resetGroupJoinDialog() {
    groupJoinDialogVisible.value = false;
    groupJoinConversationIdInput.value = "";
    groupJoinRequestMessage.value = "";
    groupSearchResult.value = null;
    groupSearchSearched.value = false;
  }

  function openGroupJoinDialog() {
    resetGroupJoinDialog();
    groupJoinDialogVisible.value = true;
  }

  function getFriendSearchName(item: FriendSearchResult) {
    return item.nickName?.trim() || item.userAccount?.trim() || String(item.userId);
  }

  function getFriendSearchMeta(item: FriendSearchResult) {
    return item.userAccount?.trim() || `ID: ${item.userId}`;
  }

  function renderFriendSearchName(item: FriendSearchResult) {
    const nickName = item.nickName?.trim();
    const keyword = trimmedFriendSearchKeyword.value;

    if (!nickName || !keyword) {
      return escapeHtml(getFriendSearchName(item));
    }

    if (!nickName.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())) {
      return escapeHtml(getFriendSearchName(item));
    }

    return highlightKeyword(nickName, keyword);
  }

  function getFriendSearchActionText(item: FriendSearchResult) {
    if (item.isFriend) return "已是好友";
    if (item.hasPendingSentRequest) return "已发送申请";
    if (item.hasPendingReceivedRequest) return "同意并加好友";
    return "添加好友";
  }

  function getFriendSearchAvatar(item: FriendSearchResult) {
    return getUserAvatarSources(item.userId, item.avatarKey);
  }

  function getGroupSearchTitle(item: GroupSearchResult) {
    return item.title?.trim() || `群聊 #${item.id}`;
  }

  function getGroupSearchAvatar(item: GroupSearchResult) {
    return getConversationAssetSources(item.id, item.avatarKey);
  }

  async function executeFriendSearch(options: { silent?: boolean } = {}) {
    const { silent = false } = options;
    const keyword = trimmedFriendSearchKeyword.value;
    if (!keyword) {
      if (!silent) {
        ElMessage.warning("请输入昵称或账号");
      }
      friendSearchResults.value = [];
      friendSearchSearched.value = false;
      return;
    }

    friendSearchLoading.value = true;
    friendSearchSearched.value = true;
    try {
      const { data } = await searchFriendUsers(keyword);
      friendSearchResults.value = data;
    } catch (error) {
      friendSearchResults.value = [];
      if (!silent) {
        ElMessage.error(getErrorMessage(error, "搜索好友失败"));
      }
    } finally {
      friendSearchLoading.value = false;
    }
  }

  async function handleSendFriendRequest(item: FriendSearchResult) {
    if (
      friendSearchSubmittingId.value !== null ||
      item.isFriend ||
      item.hasPendingSentRequest
    ) {
      return;
    }

    friendSearchSubmittingId.value = item.userId;
    try {
      const { data } = await createFriendRequest({
        receiverUserId: item.userId,
        requestMessage: friendSearchRequestMessage.value.trim() || undefined,
        requestSource: "search",
      });

      ElMessage.success(
        data.requestStatus === "accepted" ? "已自动成为好友" : "好友申请已发送",
      );

      await refreshFriendData(friendRequestDialogVisible.value);
      await executeFriendSearch({ silent: true });
    } catch (error) {
      ElMessage.error(getErrorMessage(error, "发送好友申请失败"));
    } finally {
      friendSearchSubmittingId.value = null;
    }
  }

  async function executeGroupSearch(options: { silent?: boolean } = {}) {
    const { silent = false } = options;
    const conversationId = normalizedGroupJoinConversationId.value;
    if (!conversationId) {
      if (!silent) {
        ElMessage.warning("请输入有效的群聊 ID");
      }
      groupSearchResult.value = null;
      groupSearchSearched.value = false;
      return;
    }

    groupSearchLoading.value = true;
    groupSearchSearched.value = true;
    try {
      const { data } = await searchGroupConversation(conversationId);
      groupSearchResult.value = data;
    } catch (error) {
      groupSearchResult.value = null;
      if (!silent) {
        ElMessage.error(getErrorMessage(error, "搜索群聊失败"));
      }
    } finally {
      groupSearchLoading.value = false;
    }
  }

  async function handleSubmitGroupJoin() {
    if (
      !canSubmitGroupJoin.value ||
      groupJoinSubmitting.value ||
      !groupSearchResult.value
    ) {
      return;
    }

    groupJoinSubmitting.value = true;
    try {
      await createGroupJoinRequest(groupSearchResult.value.id, {
        requestMessage: groupJoinRequestMessage.value.trim() || undefined,
      });
      ElMessage.success("加群申请已提交");
      resetGroupJoinDialog();
    } catch (error) {
      ElMessage.error(getErrorMessage(error, "提交加群申请失败"));
    } finally {
      groupJoinSubmitting.value = false;
    }
  }

  async function handleAcceptRequest(item: FriendRequest) {
    handlingRequestId.value = item.id;
    try {
      await acceptFriendRequest(item.id);
      ElMessage.success("已通过好友申请");
      await refreshFriendData(true);
    } catch (error) {
      ElMessage.error(getErrorMessage(error, "处理好友申请失败"));
    } finally {
      handlingRequestId.value = null;
    }
  }

  async function handleRejectRequest(item: FriendRequest) {
    try {
      const result = await ElMessageBox.prompt("可填写拒绝原因", "拒绝好友申请", {
        inputPlaceholder: "拒绝原因（可选）",
        inputValidator: () => true,
        confirmButtonText: "确认拒绝",
        cancelButtonText: "取消",
      });

      handlingRequestId.value = item.id;
      await rejectFriendRequest(item.id, {
        rejectReason: result.value?.trim() || undefined,
      });
      ElMessage.success("已拒绝好友申请");
      await loadRequests();
    } catch (error) {
      if (error !== "cancel") {
        ElMessage.error(getErrorMessage(error, "拒绝好友申请失败"));
      }
    } finally {
      handlingRequestId.value = null;
    }
  }

  /**
   * 好友申请列表里的「对方」：
   * 收到的申请显示申请人，发出的申请显示接收人。
   */
  function getFriendRequestUser(request: FriendRequest) {
    return resolveFriendRequestTarget(request);
  }

  function getFriendRequestAvatar(request: FriendRequest) {
    const target = getFriendRequestUser(request);
    return getUserAvatarSources(target.userId, target.avatarKey);
  }

  function getFriendLabel(request: FriendRequest) {
    const target = getFriendRequestUser(request);
    return target.nickName || target.userAccount || String(target.userId);
  }

  function getFriendMeta(request: FriendRequest) {
    const target = getFriendRequestUser(request);
    return target.userAccount || `ID: ${target.userId}`;
  }

  function formatFriendRequestTime(createdAt: string) {
    return formatChatTime(createdAt);
  }

  function handleActionCommand(command: SidebarActionCommand) {
    switch (command) {
      case "groupJoin":
        openGroupJoinDialog();
        break;
      case "addFriend":
        openAddFriendDialog();
        break;
      case "friendRequest":
        void openFriendRequestDialog();
        break;
      case "blacklist":
        void openBlacklistDialog();
        break;
    }
  }

  onMounted(() => {
    void loadFriends();
    void loadRequests({ silent: true });
    void loadBlacklist({ silent: true });
  });

  watch(
    () => options.friendshipVersion(),
    () => {
      void refreshFriendData(friendRequestDialogVisible.value);
    },
  );

  watch(
    () => options.friendRequestVersion(),
    () => {
      void loadRequests({ silent: !friendRequestDialogVisible.value });
    },
  );

  return {
    friendLoading,
    friends,
    blacklistDialogVisible,
    blacklistLoading,
    blacklist,
    blacklistUnblockingId,
    pendingFriendRequestCount,
    friendSearchDialogVisible,
    friendSearchLoading,
    friendSearchSubmittingId,
    friendSearchKeyword,
    friendSearchRequestMessage,
    friendSearchResults,
    friendSearchSearched,
    canSearchFriend,
    canCloseFriendSearchDialog,
    friendRequestDialogVisible,
    friendRequestLoading,
    sortedFriendRequests,
    handlingRequestId,
    friendRequestStatusMap,
    groupJoinDialogVisible,
    groupSearchLoading,
    groupJoinSubmitting,
    groupJoinConversationIdInput,
    groupJoinRequestMessage,
    groupSearchResult,
    groupSearchSearched,
    canSearchGroup,
    canSubmitGroupJoin,
    canCloseGroupJoinDialog,
    handleActionCommand,
    refreshFriendData,
    resetFriendSearchDialog,
    executeFriendSearch,
    handleSendFriendRequest,
    getFriendSearchName,
    getFriendSearchMeta,
    renderFriendSearchName,
    getFriendSearchActionText,
    getFriendSearchAvatar,
    getRequestStatusType,
    getFriendRequestUser,
    getFriendRequestAvatar,
    getFriendLabel,
    getFriendMeta,
    formatFriendRequestTime,
    handleAcceptRequest,
    handleRejectRequest,
    loadBlacklist,
    openBlacklistDialog,
    handleUnblockUser,
    getBlockedUserLabel,
    getBlockedUserMeta,
    getBlockedUserAvatar,
    formatBlockedAt,
    resetGroupJoinDialog,
    executeGroupSearch,
    handleSubmitGroupJoin,
    getGroupSearchTitle,
    getGroupSearchAvatar,
  };
}
