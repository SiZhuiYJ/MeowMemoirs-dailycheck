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
  /** 推送状态，展示在「更多」下拉菜单里（原顶部工具栏）。 */
  statusText: string;
  /** 是否正在推送（实时已连接或轮询中），决定菜单里显示「停止推送」还是「开启推送」。 */
  polling: boolean;
  /** 切换推送时禁用按钮，避免重复点击。 */
  pushLoading: boolean;
}>();

const emit = defineEmits<{
  createConversation: [];
  selectConversation: [item: ConversationSummary];
  togglePin: [item: ConversationSummary];
  toggleMute: [item: ConversationSummary];
  deleteConversation: [item: ConversationSummary];
  back: [];
  refresh: [];
  togglePush: [];
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
      @toggle-pin="emit('togglePin', $event)"
      @toggle-mute="emit('toggleMute', $event)"
      @delete-conversation="emit('deleteConversation', $event)"
    />
    <ConversationSidebarCreatePanel
      v-model:create-title="createTitle"
      v-model:create-member-user-ids="createMemberUserIds"
      :current-conversation-id="selectedConversationId"
      :friend-request-version="friendRequestVersion"
      :friendship-version="friendshipVersion"
      :status-text="statusText"
      :polling="polling"
      :push-loading="pushLoading"
      @back="emit('back')"
      @refresh="emit('refresh')"
      @toggle-push="emit('togglePush')"
      @create-conversation="emit('createConversation')"
    />
  </aside>
</template>
