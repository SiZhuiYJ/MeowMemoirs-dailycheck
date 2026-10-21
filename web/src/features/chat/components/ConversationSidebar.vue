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
  /** 手机档单栏结构：会话列表独占一屏（平板/电脑档是双栏，恒为 false）。 */
  isSinglePanel: boolean;
  loading?: boolean;
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
      :single-panel="isSinglePanel"
      :loading="props.loading"
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
