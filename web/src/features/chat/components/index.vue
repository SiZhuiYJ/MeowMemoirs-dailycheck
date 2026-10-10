<!-- index.vue -->
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useChatCore } from '../composables/useChatCore';
import ChatToolbar from './ChatToolbar.vue';
import ConversationSidebar from './ConversationSidebar.vue';
import MessagePanel from './MessagePanel.vue';
import type { ConversationSummary } from '../types';
import router from '@/routers';

const chat = useChatCore();
const isMobile = ref(false);

function syncViewport() {
  isMobile.value = window.innerWidth <= 768;
}

const showConversationList = computed(() => {
  if (!isMobile.value) return true;
  return !chat.selectedConversationId.value;
});

async function handleSelectConversation(item: ConversationSummary) {
  await chat.selectConversation(item);
}

function handleBackToList() {
  chat.clearReplyingMessage();
  chat.currentConversation.value = null;
  chat.messages.value = [];
}

onMounted(async () => {
  syncViewport();
  window.addEventListener('resize', syncViewport);
  await chat.loadConversations();
  await chat.togglePush(true); // 内部 connectRealtime 会自动订阅所有会话
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewport);
  chat.togglePush(false); // 停止推送
});

// 为 MessagePanel 预计算已读展示信息（可选优化）
const readInfoMap = computed<Map<number, { readText: string; readColor: string }>>(() => {
  const map = new Map<number, { readText: string; readColor: string }>();
  for (const msg of chat.messages.value) {
    map.set(msg.id, chat.getReadInfo(msg));
  }
  return map;
});
</script>

<template>
  <div class="chat-page">

    <ChatToolbar :status-text="chat.statusText.value" :polling="chat.polling.value || chat.realtimeConnected.value"
      :loading="chat.loading.value" @back="router.push('/home')" @refresh="chat.loadConversations"
      @toggle-push="chat.togglePush" />

    <div class="layout" :class="{ mobile: isMobile }">
      <ConversationSidebar v-show="showConversationList"
        v-model:create-title="chat.createTitle.value" v-model:create-member-user-ids="chat.createMemberUserIds.value"
        :selected-conversation-id="chat.selectedConversationId.value" :conversations="chat.conversations.value"
        :is-mobile="isMobile"
        :friend-request-version="chat.friendRequestVersion.value"
        :friendship-version="chat.friendshipVersion.value"
        @create-conversation="chat.handleCreateConversation"
        @select-conversation="handleSelectConversation" />

      <MessagePanel v-if="!isMobile || !showConversationList" v-model="chat.composeText.value"
        v-model:conversation-detail="chat.currentConversation.value!" :messages="chat.messages.value"
        :me-user-id="chat.meUserId.value" :loading="chat.loading.value" :show-back-to-list="isMobile"
        :replying-message="chat.replyingMessage.value" :message-read-status="chat.messageReadStatus.value"
        :read-info-map="readInfoMap" :send-message-handler="chat.sendMessage" @load-more="chat.loadMore"
        @send-text-message="chat.sendTextMessage"
        @recall-message="chat.recallMessage"
        @mark-read="chat.markRead" @back-to-list="handleBackToList"
        @reply-message="chat.setReplyingMessage" @clear-reply-message="chat.clearReplyingMessage"
        @update-conversation="chat.handleConversationDetailUpdate"
        @load-message-read-status="chat.loadMessageReadStatus" />
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
