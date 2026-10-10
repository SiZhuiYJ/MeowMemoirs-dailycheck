<script setup lang="ts">
import ConversationSidebarCreatePanel from "./ConversationSidebarCreatePanel.vue";
import ConversationSidebarList from "./ConversationSidebarList.vue";
import type { ConversationSummary } from "../types";

const createTitle = defineModel<string>("createTitle", {
  required: true,
});
const createMemberUserIds = defineModel<number[]>("createMemberUserIds", {
  required: true,
});

const props = defineProps<{
  selectedConversationId: number;
  conversations: ConversationSummary[];
  isMobile: boolean;
  friendRequestVersion: number;
  friendshipVersion: number;
}>();

const emit = defineEmits<{
  createConversation: [];
  selectConversation: [item: ConversationSummary];
}>();
</script>

<template>
  <aside class="left-panel">
    <ConversationSidebarList
      :selected-conversation-id="selectedConversationId"
      :conversations="conversations"
      :is-mobile="isMobile"
      @select-conversation="emit('selectConversation', $event)"
    />
    <ConversationSidebarCreatePanel
      v-model:create-title="createTitle"
      v-model:create-member-user-ids="createMemberUserIds"
      :friend-request-version="friendRequestVersion"
      :friendship-version="friendshipVersion"
      @create-conversation="emit('createConversation')"
    />
  </aside>
</template>
