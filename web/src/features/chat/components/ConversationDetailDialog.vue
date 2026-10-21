<script setup lang="ts">
import ProgressiveAvatar from "@/components/ProgressiveAvatar/index.vue";
import { Bell, MuteNotification } from "@element-plus/icons-vue";
import { createAvatarUploadFormData } from "@/utils/avatar";
import { computed, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores";
import IsPin from "./IsPin.vue";
import type {
  ConversationDetail,
  ConversationDetailUpdateOptions,
  ConversationMember,
  Friendship,
  GroupJoinRequest,
  GroupMuteMode,
  UserRole,
} from "../types";
import {
  approveGroupJoinRequest,
  disbandConversation,
  getConversationJoinRequests,
  inviteConversationMembers,
  kickConversationMember,
  muteConversationMember,
  rejectGroupJoinRequest,
  unmuteConversationMember,
  updateConversationMemberRole,
} from "../api/conversations";
import {
  deleteFriend as deleteFriendApi,
  getFriends,
  updateFriendRemark as updateFriendRemarkApi,
} from "../api/friends";
import { uploadConversationAvatar as uploadConversationAvatarApi } from "../api/files";
import {
  formatChatTime,
  getConversationAvatarSources,
  getConversationAvatarText,
  getConversationDisplayTitle,
  getDirectPeer,
  getMemberAvatarSources,
  getMemberAvatarUrl,
  groupRoleMap,
} from "../utils/chat";

interface MuteOption {
  value: string;
  label: string;
  mode: GroupMuteMode;
  durationMinutes?: number;
}

const props = defineProps<{
  modelValue: boolean;
  conversation: ConversationDetail;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  "update:conversation": [options?: ConversationDetailUpdateOptions];
  "load-more": [];
}>();

const { user } = storeToRefs(useAuthStore());

const avatarInputRef = ref<HTMLInputElement | null>(null);
const uploadingAvatar = ref(false);
const roleUpdatingUserId = ref<number | null>(null);
const kickingUserId = ref<number | null>(null);
const mutingUserId = ref<number | null>(null);
const disbanding = ref(false);

const inviteDialogVisible = ref(false);
const inviting = ref(false);
const inviteSelection = ref<number[]>([]);
const friendLoading = ref(false);
const friends = ref<Friendship[]>([]);
const joinRequestDialogVisible = ref(false);
const joinRequestLoading = ref(false);
const joinRequestHandlingId = ref<number | null>(null);
const joinRequests = ref<GroupJoinRequest[]>([]);

const muteDialogVisible = ref(false);
const pendingMuteMember = ref<ConversationMember | null>(null);
const selectedMuteOptionValue = ref("");
const friendRemarkInput = ref("");
const savingFriendRemark = ref(false);
const deletingFriend = ref(false);

const muteOptions: MuteOption[] = [
  { value: "temporary-10", label: "10 分钟", mode: "temporary", durationMinutes: 10 },
  { value: "temporary-60", label: "1 小时", mode: "temporary", durationMinutes: 60 },
  { value: "temporary-1440", label: "24 小时", mode: "temporary", durationMinutes: 60 * 24 },
  { value: "permanent", label: "永久禁言", mode: "permanent" },
];

const title = computed(() => getConversationDisplayTitle(props.conversation, user.value?.userId));
const avatarSources = computed(() => getConversationAvatarSources(props.conversation));
const isGroupConversation = computed(() => props.conversation.conversationType === "group");
const directPeer = computed(
  () =>
  (!isGroupConversation.value
    ? getDirectPeer(props.conversation, user.value?.userId) ??
    props.conversation.members.find((item) => item.userId !== user.value?.userId) ??
    null
    : null),
);
const currentMember = computed(
  () => props.conversation.members.find((item) => item.userId === user.value?.userId) ?? null,
);
const currentMemberRole = computed<UserRole | null>(() => currentMember.value?.memberRole ?? null);
const canChangeGroupAvatar = computed(
  () => isGroupConversation.value && ["owner", "admin"].includes(currentMemberRole.value || ""),
);
const canManageMemberRoles = computed(
  () => isGroupConversation.value && currentMemberRole.value === "owner",
);
const canManageJoinRequests = computed(
  () =>
    isGroupConversation.value &&
    props.conversation.isActive &&
    ["owner", "admin"].includes(currentMemberRole.value || ""),
);
const canInviteMembers = computed(
  () => isGroupConversation.value && props.conversation.isActive && currentMember.value !== null,
);
const canDisbandConversation = computed(
  () => isGroupConversation.value && currentMemberRole.value === "owner",
);
const isDirectFriend = computed(
  () => !isGroupConversation.value && props.conversation.isFriend,
);
const friendRemarkValue = computed(() => friendRemarkInput.value.trim());
const friendRemarkDirty = computed(
  () => friendRemarkValue.value !== (props.conversation.friendRemark?.trim() ?? ""),
);
const canSaveFriendRemark = computed(
  () =>
    !isGroupConversation.value &&
    directPeer.value !== null &&
    isDirectFriend.value &&
    friendRemarkDirty.value &&
    !savingFriendRemark.value &&
    !deletingFriend.value,
);
const muteTargetName = computed(() =>
  pendingMuteMember.value ? getMemberName(pendingMuteMember.value) : "",
);
const muteConfirmLoading = computed(
  () => pendingMuteMember.value !== null && mutingUserId.value === pendingMuteMember.value.userId,
);

const sortedMembers = computed(() => {
  const orderMap: Record<UserRole, number> = {
    owner: 0,
    admin: 1,
    member: 2,
  };

  return [...props.conversation.members].sort((left, right) => {
    const orderDiff = orderMap[left.memberRole] - orderMap[right.memberRole];
    if (orderDiff !== 0) return orderDiff;
    return Date.parse(left.joinedAt) - Date.parse(right.joinedAt);
  });
});

const activeMemberUserIds = computed(() => new Set(props.conversation.members.map((item) => item.userId)));
const inviteableFriends = computed(() =>
  friends.value
    .map((item) => item.friend)
    .filter((item) => !activeMemberUserIds.value.has(item.userId))
    .sort((left, right) =>
      (left.nickName || left.userAccount || String(left.userId)).localeCompare(
        right.nickName || right.userAccount || String(right.userId),
        "zh-CN",
      ),
    ),
);
const inviteOptions = computed(() =>
  inviteableFriends.value.map((item) => ({
    userId: item.userId,
    label: item.nickName || item.userAccount || String(item.userId),
    meta: item.userAccount || `ID: ${item.userId}`,
  })),
);

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

function applyConversationDetail(detail: ConversationDetail) {
  Object.assign(props.conversation, {
    ...detail,
    members: detail.members,
  });
}

function getMemberName(member: ConversationMember) {
  return member.nickName || member.userAccount || String(member.userId);
}

function resetFriendRemarkEditor() {
  friendRemarkInput.value = props.conversation.friendRemark?.trim() ?? "";
}

async function handleSaveFriendRemark() {
  if (!canSaveFriendRemark.value || !directPeer.value) return;

  savingFriendRemark.value = true;
  try {
    const { data } = await updateFriendRemarkApi(directPeer.value.userId, {
      friendRemark: friendRemarkValue.value || undefined,
    });

    props.conversation.friendRemark = data.friendRemark ?? null;
    props.conversation.title =
      data.friendRemark?.trim() || getMemberName(directPeer.value);

    resetFriendRemarkEditor();
    emit("update:conversation");
    ElMessage.success(friendRemarkValue.value ? "Remark updated" : "Remark cleared");
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "Failed to update remark"));
  } finally {
    savingFriendRemark.value = false;
  }
}

async function handleDeleteFriend() {
  if (!directPeer.value || deletingFriend.value || !isDirectFriend.value) return;

  try {
    await ElMessageBox.confirm(
      `Delete friend "${getMemberName(directPeer.value)}"? You can still view message history, but you will no longer be able to start a new direct chat via the friendship.`,
      "Delete Friend",
      {
        type: "warning",
        confirmButtonText: "Delete",
        cancelButtonText: "Cancel",
      },
    );

    deletingFriend.value = true;
    await deleteFriendApi(directPeer.value.userId);

    props.conversation.isFriend = false;
    props.conversation.friendRemark = null;
    props.conversation.title = getMemberName(directPeer.value);

    resetFriendRemarkEditor();
    emit("update:conversation");
    ElMessage.success("Friend deleted");
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.error(getErrorMessage(error, "Failed to delete friend"));
    }
  } finally {
    deletingFriend.value = false;
  }
}

function canModerateMember(member: ConversationMember) {
  if (!isGroupConversation.value || member.userId === user.value?.userId) return false;

  switch (currentMemberRole.value) {
    case "owner":
      return member.memberRole !== "owner";
    case "admin":
      return member.memberRole === "member";
    default:
      return false;
  }
}

async function loadFriends() {
  if (!isGroupConversation.value || !currentMember.value) return;

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

function resetMuteDialog() {
  muteDialogVisible.value = false;
  pendingMuteMember.value = null;
  selectedMuteOptionValue.value = "";
}

function resetInviteDialog() {
  inviteDialogVisible.value = false;
  inviteSelection.value = [];
}

function resetJoinRequestDialog() {
  joinRequestDialogVisible.value = false;
  joinRequests.value = [];
  joinRequestHandlingId.value = null;
}

function toggleMuted() {
  props.conversation.isMuted = !props.conversation.isMuted;
  emit("update:conversation", { persist: true });
}

function togglePinned() {
  props.conversation.isPinned = !props.conversation.isPinned;
  emit("update:conversation", { persist: true });
}

function openAvatarPicker() {
  if (!canChangeGroupAvatar.value || uploadingAvatar.value) return;
  avatarInputRef.value?.click();
}

async function handleAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";

  if (!file || !canChangeGroupAvatar.value) return;

  uploadingAvatar.value = true;
  try {
    const formData = await createAvatarUploadFormData(file);
    const { data } = await uploadConversationAvatarApi(props.conversation.id, formData);
    props.conversation.avatarKey = data.key;
    emit("update:conversation");
    ElMessage.success("群头像已更新");
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "群头像上传失败"));
  } finally {
    uploadingAvatar.value = false;
  }
}

function getNextMemberRole(member: ConversationMember): "admin" | "member" | null {
  if (member.memberRole === "admin") return "member";
  if (member.memberRole === "member") return "admin";
  return null;
}

async function handleToggleMemberRole(member: ConversationMember) {
  const nextRole = getNextMemberRole(member);
  if (!canManageMemberRoles.value || !nextRole) return;

  roleUpdatingUserId.value = member.userId;
  try {
    const { data } = await updateConversationMemberRole(props.conversation.id, member.userId, {
      memberRole: nextRole,
    });
    applyConversationDetail(data);
    emit("update:conversation");
    ElMessage.success(nextRole === "admin" ? "已设为管理员" : "已设为普通成员");
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "成员权限更新失败"));
  } finally {
    roleUpdatingUserId.value = null;
  }
}

function isMemberMuted(member: ConversationMember) {
  if (!member.isMuted) return false;
  if (!member.mutedUntil) return true;
  return Date.parse(member.mutedUntil) > Date.now();
}

function formatMuteStatus(member: ConversationMember) {
  if (!isMemberMuted(member)) return "可正常发言";
  if (member.mutedMode === "permanent" || !member.mutedUntil) return "永久禁言中";
  return `禁言至 ${formatChatTime(member.mutedUntil)}`;
}

async function openInviteDialog() {
  if (!canInviteMembers.value || inviting.value) return;

  await loadFriends();
  inviteSelection.value = [];

  if (inviteableFriends.value.length === 0) {
    ElMessage.info("你当前没有可邀请入群的好友");
    return;
  }

  inviteDialogVisible.value = true;
}

function getJoinRequestName(item: GroupJoinRequest) {
  return item.requester.nickName || item.requester.userAccount || String(item.requester.userId);
}

function getJoinRequestMeta(item: GroupJoinRequest) {
  return item.requester.userAccount || `ID: ${item.requester.userId}`;
}

async function loadJoinRequests() {
  if (!canManageJoinRequests.value) return;

  joinRequestLoading.value = true;
  try {
    const { data } = await getConversationJoinRequests(props.conversation.id);
    joinRequests.value = data;
    props.conversation.pendingJoinRequestCount = data.length;
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "加载加群申请失败"));
  } finally {
    joinRequestLoading.value = false;
  }
}

async function openJoinRequestDialog() {
  if (!canManageJoinRequests.value || joinRequestLoading.value) return;

  await loadJoinRequests();
  joinRequestDialogVisible.value = true;
}

async function submitInviteMembers() {
  if (!inviteSelection.value.length) {
    ElMessage.warning("请选择要邀请的好友");
    return;
  }

  inviting.value = true;
  try {
    const { data } = await inviteConversationMembers(props.conversation.id, {
      memberUserIds: inviteSelection.value,
    });
    applyConversationDetail(data);
    emit("update:conversation");
    ElMessage.success("邀请已发起");
    resetInviteDialog();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "邀请成员失败"));
  } finally {
    inviting.value = false;
  }
}

async function handleApproveJoinRequest(item: GroupJoinRequest) {
  if (!canManageJoinRequests.value) return;

  joinRequestHandlingId.value = item.id;
  try {
    const { data } = await approveGroupJoinRequest(props.conversation.id, item.id);
    applyConversationDetail(data);
    emit("update:conversation");
    await loadJoinRequests();
    ElMessage.success("已通过加群申请");
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "通过加群申请失败"));
  } finally {
    joinRequestHandlingId.value = null;
  }
}

async function handleRejectJoinRequest(item: GroupJoinRequest) {
  if (!canManageJoinRequests.value) return;

  try {
    const result = await ElMessageBox.prompt("可填写拒绝原因", "拒绝加群申请", {
      inputPlaceholder: "拒绝原因（可选）",
      inputValidator: () => true,
      confirmButtonText: "确认拒绝",
      cancelButtonText: "取消",
    });

    joinRequestHandlingId.value = item.id;
    const { data } = await rejectGroupJoinRequest(props.conversation.id, item.id, {
      rejectReason: result.value?.trim() || undefined,
    });
    applyConversationDetail(data);
    emit("update:conversation");
    await loadJoinRequests();
    ElMessage.success("已拒绝加群申请");
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.error(getErrorMessage(error, "拒绝加群申请失败"));
    }
  } finally {
    joinRequestHandlingId.value = null;
  }
}

async function handleKickMember(member: ConversationMember) {
  if (!canModerateMember(member)) return;

  try {
    await ElMessageBox.confirm(
      `确认将“${getMemberName(member)}”移出群聊吗？`,
      "移出成员",
      {
        type: "warning",
        confirmButtonText: "确认移出",
        cancelButtonText: "取消",
      },
    );

    kickingUserId.value = member.userId;
    const { data } = await kickConversationMember(props.conversation.id, member.userId);
    applyConversationDetail(data);
    emit("update:conversation");
    ElMessage.success("成员已移出群聊");
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.error(getErrorMessage(error, "移出成员失败"));
    }
  } finally {
    kickingUserId.value = null;
  }
}

function handleMuteMember(member: ConversationMember) {
  if (!canModerateMember(member)) return;

  pendingMuteMember.value = member;
  selectedMuteOptionValue.value = muteOptions[0]?.value ?? "";
  muteDialogVisible.value = true;
}

async function confirmMuteMember() {
  const member = pendingMuteMember.value;
  if (!member) return;

  const targetOption = muteOptions.find((item) => item.value === selectedMuteOptionValue.value);
  if (!targetOption) {
    ElMessage.warning("请选择禁言时长");
    return;
  }

  mutingUserId.value = member.userId;
  try {
    const { data } = await muteConversationMember(props.conversation.id, member.userId, {
      mode: targetOption.mode,
      durationMinutes: targetOption.durationMinutes,
    });
    applyConversationDetail(data);
    emit("update:conversation");
    ElMessage.success(targetOption.mode === "permanent" ? "已设为永久禁言" : "成员已禁言");
    resetMuteDialog();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "禁言失败"));
  } finally {
    mutingUserId.value = null;
  }
}

async function handleUnmuteMember(member: ConversationMember) {
  if (!canModerateMember(member)) return;

  mutingUserId.value = member.userId;
  try {
    const { data } = await unmuteConversationMember(props.conversation.id, member.userId);
    applyConversationDetail(data);
    emit("update:conversation");
    ElMessage.success("已解除禁言");
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "解除禁言失败"));
  } finally {
    mutingUserId.value = null;
  }
}

async function handleDisbandConversation() {
  if (!canDisbandConversation.value || disbanding.value) return;

  try {
    await ElMessageBox.confirm("解散后将无法恢复，确认要解散该群聊吗？", "解散群聊", {
      type: "warning",
      confirmButtonText: "确认解散",
      cancelButtonText: "取消",
    });

    disbanding.value = true;
    const { data } = await disbandConversation(props.conversation.id);
    applyConversationDetail(data);
    ElMessage.success("群聊已解散");
    emit("update:modelValue", false);
    emit("update:conversation", { clearCurrent: true });
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.error(getErrorMessage(error, "解散群聊失败"));
    }
  } finally {
    disbanding.value = false;
  }
}

watch(
  () => [props.conversation.id, props.conversation.friendRemark],
  () => {
    resetFriendRemarkEditor();
  },
  { immediate: true },
);

watch(
  () => props.modelValue,
  (value) => {
    if (value && isGroupConversation.value) {
      void loadFriends();
      return;
    }

    if (!value) {
      resetInviteDialog();
      resetJoinRequestDialog();
      resetMuteDialog();
      resetFriendRemarkEditor();
    }
  },
  { immediate: true },
);
</script>

<template>
  <el-dialog :model-value="modelValue" title="会话详情" width="min(92vw, 700px)"
    @update:model-value="emit('update:modelValue', $event)">
    <div class="conversation-detail-dialog">

      <div class="avatar-container">
        <div class="avatar-section">
          <ProgressiveAvatar class="avatar-preview" :src="avatarSources.src" :thumbnail-src="avatarSources.thumbnailSrc"
            :size="96" :is-preview=true shape="square">
            {{ getConversationAvatarText(conversation) }}
          </ProgressiveAvatar>

          <div v-if="isGroupConversation" class="avatar-actions">
            <el-button color="#111827" plain :loading="uploadingAvatar" :disabled="!canChangeGroupAvatar"
              @click="openAvatarPicker">
              更换群头像
            </el-button>
            <span class="avatar-tip">
              {{ canChangeGroupAvatar ? "支持上传常见图片格式" : "仅群主或管理员可更换群头像" }}
            </span>
          </div>
          <input ref="avatarInputRef" class="hidden-input" type="file" accept="image/*" @change="handleAvatarChange">
        </div>

        <div class="detail-meta">
          <p class="meta-item">会话标题：{{ title }}</p>
          <p class="meta-item">会话类型：{{ conversation.conversationType === "group" ? "群聊" : "单聊" }}</p>
          <p class="meta-item">会话 ID：{{ conversation.id }}</p>
          <p class="meta-item">创建时间：{{ formatChatTime(conversation.createdAt) }}</p>
          <p class="meta-item">更新时间：{{ formatChatTime(conversation.updatedAt) }}</p>
        </div>
      </div>

      <div v-if="isGroupConversation" class="group-management-section">
        <div class="section-header">
          <span>群管理</span>
          <span class="section-tip">所有群成员都可以邀请自己的好友入群</span>
        </div>
        <div class="management-actions">
          <el-badge :value="conversation.pendingJoinRequestCount" :show-zero="false" :offset="[-6, 4]">
            <el-button color="#111827" plain :disabled="!canManageJoinRequests" :loading="joinRequestLoading"
              @click="openJoinRequestDialog">
              加群申请
            </el-button>
          </el-badge>
          <el-button color="#111827" plain :disabled="!canInviteMembers" :loading="inviting" @click="openInviteDialog">
            邀请成员
          </el-button>
          <el-button color="#dc2626" plain :disabled="!canDisbandConversation" :loading="disbanding"
            @click="handleDisbandConversation">
            解散群聊
          </el-button>
        </div>
      </div>

      <div v-else-if="directPeer" class="direct-friend-section">
        <div class="section-header">
          <span>好友信息</span>
          <el-tag size="small" :type="isDirectFriend ? 'success' : 'info'">
            {{ isDirectFriend ? "好友" : "已删除" }}
          </el-tag>
        </div>

        <div class="direct-friend-card">
          <div class="direct-friend-main">
            <ProgressiveAvatar class="direct-friend-avatar" :src="getMemberAvatarUrl(directPeer)" :is-preview=true
              :thumbnail-src="getMemberAvatarSources(directPeer).thumbnailSrc" :size="56" shape="square">
              {{ getMemberName(directPeer).slice(0, 1) }}
            </ProgressiveAvatar>
            <div class="direct-friend-text">
              <div class="direct-friend-name-row">
                <strong class="direct-friend-name">{{ getMemberName(directPeer) }}</strong>
                <el-tag v-if="conversation.friendRemark" size="small" type="warning">
                  备注: {{ conversation.friendRemark }}
                </el-tag>
              </div>
              <div v-if="directPeer.userAccount" class="direct-friend-meta">
                账号: {{ directPeer.userAccount }}
              </div>
              <div class="direct-friend-meta">用户 ID: {{ directPeer.userId }}</div>
            </div>
          </div>

          <div class="direct-friend-editor">
            <el-input v-model="friendRemarkInput" maxlength="64" show-word-limit clearable placeholder="添加备注"
              :disabled="savingFriendRemark || deletingFriend || !isDirectFriend"
              @keyup.enter="handleSaveFriendRemark" />
            <div class="direct-friend-actions">
              <el-button color="#111827" plain :loading="savingFriendRemark" :disabled="!canSaveFriendRemark"
                @click="handleSaveFriendRemark">
                保存备注
              </el-button>
              <el-button color="#dc2626" plain :loading="deletingFriend" :disabled="!isDirectFriend"
                @click="handleDeleteFriend">
                删除好友
              </el-button>
            </div>
            <p class="direct-friend-tip">
              删除会保留当前的消息记录，但您将无法通过该好友关系开始新的直接聊天。
            </p>
          </div>
        </div>
      </div>

      <div v-if="isGroupConversation" class="members-section">
        <div class="section-header">
          <span>成员列表</span>
          <span v-if="canManageMemberRoles" class="section-tip">群主可切换管理员和普通成员</span>
        </div>

        <div class="member-list">
          <div v-for="item in sortedMembers" :key="item.userId" class="member-row">
            <div class="member-main">
              <ProgressiveAvatar class="conversation-avatar" :src="getMemberAvatarUrl(item)" :is-preview=true
                :thumbnail-src="getMemberAvatarSources(item).thumbnailSrc" :size="48" shape="square">
                {{ (item.nickName || item.userAccount || String(item.userId)).slice(0, 1) }}
              </ProgressiveAvatar>
              <div class="member-text">
                <div class="member-name-row">
                  <span class="member-name">{{ getMemberName(item) }}</span>
                  <el-tag size="small"
                    :type="item.memberRole === 'owner' ? 'danger' : item.memberRole === 'admin' ? 'warning' : 'info'">
                    {{ groupRoleMap[item.memberRole] || item.memberRole }}
                  </el-tag>
                  <el-tag v-if="isMemberMuted(item)" size="small" type="danger">
                    {{ formatMuteStatus(item) }}
                  </el-tag>
                </div>
                <div class="member-subtext">加入时间：{{ formatChatTime(item.joinedAt) }}</div>
                <div v-if="item.userAccount" class="member-subtext">账号：{{ item.userAccount }}</div>
              </div>
            </div>

            <div class="member-ops">
              <el-button v-if="canManageMemberRoles && item.memberRole !== 'owner' && item.userId !== user?.userId"
                size="small" color="#111827" plain :loading="roleUpdatingUserId === item.userId"
                @click="handleToggleMemberRole(item)">
                {{ item.memberRole === "admin" ? "设为普通成员" : "设为管理员" }}
              </el-button>

              <el-button v-if="canModerateMember(item)" size="small" type="warning" plain
                :loading="mutingUserId === item.userId"
                @click="isMemberMuted(item) ? handleUnmuteMember(item) : handleMuteMember(item)">
                {{ isMemberMuted(item) ? "解除禁言" : "禁言" }}
              </el-button>

              <el-button v-if="canModerateMember(item)" size="small" type="danger" plain
                :loading="kickingUserId === item.userId" @click="handleKickMember(item)">
                移出群聊
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <div class="action-icons">
        <el-icon @click="toggleMuted">
          <MuteNotification v-if="conversation.isMuted" />
          <Bell v-else />
        </el-icon>
        <IsPin v-model:is-pinned="conversation.isPinned" @toggle-pinned="togglePinned" />
        <el-button color="#111827" class="load-more" @click="emit('load-more')">加载更早消息</el-button>
      </div>
    </div>
  </el-dialog>

  <el-dialog v-model="inviteDialogVisible" title="邀请好友入群" width="min(92vw, 460px)" append-to-body
    :close-on-click-modal="!inviting" :close-on-press-escape="!inviting" :show-close="!inviting"
    @closed="resetInviteDialog">
    <div class="invite-dialog-body">
      <p class="invite-dialog-text">只能邀请你自己的好友入群。</p>
      <el-select v-model="inviteSelection" class="invite-select" multiple filterable clearable collapse-tags
        collapse-tags-tooltip :loading="friendLoading" placeholder="选择要邀请的好友">
        <el-option v-for="item in inviteOptions" :key="item.userId" :label="item.label" :value="item.userId">
          <div class="friend-option">
            <span>{{ item.label }}</span>
            <span class="friend-option-meta">{{ item.meta }}</span>
          </div>
        </el-option>
      </el-select>
      <el-empty v-if="!friendLoading && inviteableFriends.length === 0" description="暂无可邀请的好友" />
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button :disabled="inviting" @click="resetInviteDialog">取消</el-button>
        <el-button color="#111827" :loading="inviting" :disabled="!inviteSelection.length" @click="submitInviteMembers">
          确认邀请
        </el-button>
      </div>
    </template>
  </el-dialog>

  <el-dialog v-model="joinRequestDialogVisible" title="加群申请" width="min(92vw, 560px)" append-to-body
    :close-on-click-modal="joinRequestHandlingId === null" :close-on-press-escape="joinRequestHandlingId === null"
    :show-close="joinRequestHandlingId === null" @closed="resetJoinRequestDialog">
    <div class="join-request-panel">
      <div class="join-request-toolbar">
        <el-button plain :loading="joinRequestLoading" @click="loadJoinRequests">刷新</el-button>
      </div>

      <el-empty v-if="!joinRequestLoading && joinRequests.length === 0" description="暂无待处理的加群申请" />

      <el-scrollbar v-else max-height="360px">
        <div v-for="item in joinRequests" :key="item.id" class="join-request-row">
          <div class="join-request-main">
            <div class="join-request-title">
              <strong>{{ getJoinRequestName(item) }}</strong>
              <el-tag size="small" type="warning">待处理</el-tag>
            </div>
            <div class="join-request-meta">账号：{{ getJoinRequestMeta(item) }}</div>
            <div v-if="item.requestMessage" class="join-request-meta">附言：{{ item.requestMessage }}</div>
            <div class="join-request-meta">申请时间：{{ formatChatTime(item.createdAt) }}</div>
          </div>

          <div class="join-request-ops">
            <el-button size="small" type="primary" :loading="joinRequestHandlingId === item.id"
              @click="handleApproveJoinRequest(item)">
              通过
            </el-button>
            <el-button size="small" type="danger" plain :loading="joinRequestHandlingId === item.id"
              @click="handleRejectJoinRequest(item)">
              拒绝
            </el-button>
          </div>
        </div>
      </el-scrollbar>
    </div>
  </el-dialog>

  <el-dialog v-model="muteDialogVisible" title="设置禁言" width="min(92vw, 420px)" append-to-body
    :close-on-click-modal="!muteConfirmLoading" :close-on-press-escape="!muteConfirmLoading"
    :show-close="!muteConfirmLoading" @closed="resetMuteDialog">
    <div class="mute-dialog-body">
      <p class="mute-dialog-text">选择对“{{ muteTargetName }}”的禁言时长</p>
      <el-select v-model="selectedMuteOptionValue" placeholder="请选择禁言时长" class="mute-select">
        <el-option v-for="item in muteOptions" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button :disabled="muteConfirmLoading" @click="resetMuteDialog">取消</el-button>
        <el-button color="#111827" :loading="muteConfirmLoading" :disabled="!selectedMuteOptionValue"
          @click="confirmMuteMember">
          确认禁言
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

.conversation-detail-dialog {
  display: grid;
  gap: 20px;
}

.avatar-container {
  display: grid;
  gap: 10px;
  grid-template-columns: max-content 1fr;
}

.avatar-section {
  display: grid;
  justify-items: center;
  gap: 10px;
}

.avatar-preview {
  overflow: hidden;
  border-radius: 16px;
  background: #f3f4f6;
}

.avatar-actions {
  display: grid;
  justify-items: center;
  gap: 8px;
}

.avatar-tip {
  color: #6b7280;
  font-size: 11px;
  line-height: 18px;
}

.hidden-input {
  display: none;
}

.detail-meta,
.group-management-section {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 12px;
  background: #f9fafb;
}

.meta-item {
  margin: 0;
  color: #111827;
  font-size: 13px;
  line-height: 20px;
}

.management-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.direct-friend-section {
  display: grid;
  gap: 12px;
}

.direct-friend-card {
  display: grid;
  gap: 16px;
  padding: 16px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
}

.direct-friend-main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 14px;
  align-items: center;
}

.direct-friend-avatar {
  flex-shrink: 0;
}

.direct-friend-text,
.direct-friend-editor {
  display: grid;
  gap: 8px;
}

.direct-friend-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.direct-friend-name {
  color: #111827;
  font-size: 14px;
  line-height: 22px;
}

.direct-friend-meta {
  color: #6b7280;
  font-size: 12px;
  line-height: 18px;
  word-break: break-all;
}

.direct-friend-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.direct-friend-tip {
  margin: 0;
  color: #6b7280;
  font-size: 11px;
  line-height: 18px;
}

.members-section {
  display: grid;
  gap: 12px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  color: #111827;
  font-size: 13px;
  font-weight: 600;
}

.section-tip {
  color: #6b7280;
  font-size: 11px;
  font-weight: 400;
}

.member-list {
  display: grid;
  gap: 10px;
  max-height: 320px;
  overflow: auto;
}

.member-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
}

.member-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.member-text {
  min-width: 0;
}

.member-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.member-name {
  overflow: hidden;
  color: #111827;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-subtext {
  color: #6b7280;
  font-size: 11px;
  line-height: 18px;
}

.member-ops {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.action-icons {
  display: flex;
  align-items: center;
  gap: 14px;
  color: #111827;
  font-size: 18px;
}

.load-more {
  justify-self: flex-start;
}

.invite-dialog-body,
.mute-dialog-body {
  display: grid;
  gap: 14px;
}

.invite-dialog-text,
.mute-dialog-text {
  margin: 0;
  color: #4b5563;
  font-size: 13px;
  line-height: 20px;
}

.invite-select,
.mute-select {
  width: 100%;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.join-request-panel {
  display: grid;
  gap: 12px;
}

.join-request-toolbar {
  display: flex;
  justify-content: flex-end;
}

.join-request-row {
  display: grid;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid #e5e7eb;
}

.join-request-row:last-child {
  border-bottom: none;
}

.join-request-main {
  display: grid;
  gap: 6px;
}

.join-request-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.join-request-meta {
  color: #6b7280;
  font-size: 12px;
  line-height: 18px;
}

.join-request-ops {
  display: flex;
  gap: 8px;
}

.friend-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.friend-option-meta {
  color: #9ca3af;
  font-size: 11px;
}

// 单列化调整：手机 / 平板档（600~1200 的横屏手机与平板）同样需要，故用 device-mobile。
@include rp.device-mobile {
  .direct-friend-main {
    grid-template-columns: 1fr;
  }

  .direct-friend-actions {
    width: 100%;
  }

  .member-row {
    align-items: flex-start;
  }

  .member-ops {
    justify-content: flex-start;
  }

  .section-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
