import { getUserAvatarUrl } from "@/utils/avatar";
import { computed, watch, type Ref } from "vue";
import type { Friendship } from "../types";

export interface ConversationFriendOption {
  userId: number;
  label: string;
  meta: string;
  avatarKey?: string | null;
}

function normalizeMemberUserIds(value: number[]) {
  return value
    .filter((item) => Number.isFinite(item) && item > 0)
    .filter((item, index, array) => array.indexOf(item) === index);
}

function areSameMemberUserIds(left: number[], right: number[]) {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

export function useConversationCreateForm(options: {
  createTitle: Ref<string>;
  createMemberUserIds: Ref<number[]>;
  friends: Ref<Friendship[]>;
}) {
  const { createTitle, createMemberUserIds, friends } = options;

  const friendOptions = computed<ConversationFriendOption[]>(() =>
    friends.value
      .map((item) => ({
        userId: item.friend.userId,
        label:
          item.friend.nickName?.trim() ||
          item.friend.userAccount?.trim() ||
          String(item.friend.userId),
        meta: item.friendRemark || item.friend.userAccount?.trim() || `ID: ${item.friend.userId}`,
        avatarKey: item.friend.avatarKey,
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN")),
  );

  const friendOptionMap = computed(
    () => new Map(friendOptions.value.map((item) => [item.userId, item])),
  );

  const isGroupConversation = computed(
    () => createMemberUserIds.value.length > 1,
  );

  const canCreateConversation = computed(
    () => createMemberUserIds.value.length > 0,
  );

  watch(
    createMemberUserIds,
    (value) => {
      const normalized = normalizeMemberUserIds(value);
      if (!areSameMemberUserIds(value, normalized)) {
        createMemberUserIds.value = normalized;
        return;
      }

      if (normalized.length <= 1 && createTitle.value) {
        createTitle.value = "";
      }
    },
    { deep: true, immediate: true },
  );

  function getFriendAvatarSources(userId: number) {
    const item = friendOptionMap.value.get(userId);
    return {
      src: getUserAvatarUrl(item?.userId, item?.avatarKey),
      thumbnailSrc: getUserAvatarUrl(item?.userId, item?.avatarKey, {
        thumbnail: true,
      }),
    };
  }

  function getSelectedFriendInitial(userId: number) {
    return friendOptionMap.value.get(userId)?.label.slice(0, 1) ?? String(userId);
  }

  return {
    friendOptions,
    isGroupConversation,
    canCreateConversation,
    getFriendAvatarSources,
    getSelectedFriendInitial,
  };
}
