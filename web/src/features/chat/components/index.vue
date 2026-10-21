<!-- index.vue -->
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue';
import { useChatCore } from '../composables/useChatCore';
import ChatToolbar from './ChatToolbar.vue';
import ConversationSidebar from './ConversationSidebar.vue';
import MessagePanel from './MessagePanel.vue';
import type { ConversationSummary } from '../types';
import router from '@/routers';
import { useDeviceLayout } from '@/composables/use-device-layout';

const chat = useChatCore();

/**
 * 是否走手机端结构（单栏切换）。
 *
 * 原本是 `window.innerWidth <= 768`，只按宽度判定：
 * 手机横屏（852x393）宽度超过 768，会被当成桌面端，
 * 于是 260px 会话列表 + 消息面板并排塞进 393px 的高度里。
 *
 * useDeviceLayout 同时看宽度与宽高比，横屏手机也能正确识别，
 * 并且判定结果与 CSS 用的是同一个（见 utils/device-layout.ts）。
 */
const { isMobile } = useDeviceLayout();

const showConversationList = computed(() => {
  if (!isMobile.value) return true;
  return !chat.selectedConversationId.value;
});

/** 移动端进入会话时压入一条历史记录，让系统返回键回到会话列表。 */
let conversationHistoryPushed = false;

function pushConversationHistory() {
  if (conversationHistoryPushed) return;
  conversationHistoryPushed = true;
  window.history.pushState(
    { ...(window.history.state ?? {}), chatConversationOpen: true },
    '',
  );
}

/** 真正关闭当前会话（回到会话列表）。 */
function closeConversation() {
  chat.clearReplyingMessage();
  chat.currentConversation.value = null;
  chat.messages.value = [];
}

async function handleSelectConversation(item: ConversationSummary) {
  await chat.selectConversation(item);
  if (isMobile.value && chat.selectedConversationId.value) {
    pushConversationHistory();
  }
}

function handleBackToList() {
  // 移动端优先消费自己压入的历史记录，保证系统返回键与按钮行为一致
  if (isMobile.value && conversationHistoryPushed) {
    window.history.back();
    return;
  }
  closeConversation();
}

function handlePopState() {
  if (!conversationHistoryPushed) return;
  conversationHistoryPushed = false;
  if (chat.selectedConversationId.value) {
    closeConversation();
  }
}

onMounted(async () => {
  // 视口监听已由 use-device-layout 统一接管（含旋转与软键盘），这里不再自行监听 resize。
  window.addEventListener('popstate', handlePopState);
  await chat.loadConversations();
  await chat.togglePush(true); // 内部 connectRealtime 会自动订阅所有会话
});

onBeforeUnmount(() => {
  window.removeEventListener('popstate', handlePopState);
  conversationHistoryPushed = false;
  chat.togglePush(false); // 停止推送
});

// 为 MessagePanel 预计算已读展示信息
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
        :is-mobile="isMobile" :loading="chat.loading.value && chat.conversations.value.length === 0"
        :friend-request-version="chat.friendRequestVersion.value"
        :friendship-version="chat.friendshipVersion.value"
        @create-conversation="chat.handleCreateConversation"
        @select-conversation="handleSelectConversation" />

      <MessagePanel v-if="!isMobile || !showConversationList" v-model="chat.composeText.value"
        v-model:conversation-detail="chat.currentConversation.value!" :messages="chat.messages.value"
        :pending-text-messages="chat.pendingTextMessages.value" :me-user-id="chat.meUserId.value"
        :loading="chat.loading.value" :sending="chat.sending.value" :loading-more="chat.loadingMore.value"
        :show-back-to-list="isMobile" :replying-message="chat.replyingMessage.value"
        :message-read-status="chat.messageReadStatus.value" :read-info-map="readInfoMap"
        :send-message-handler="chat.sendMessage" :retry-send-handler="chat.retrySendMessage"
        :discard-send-handler="chat.discardPendingTextMessage"
        :load-message-read-status-batch-handler="chat.loadBatchMessageReadStatus" @load-more="chat.loadMore"
        @send-text-message="chat.sendTextMessage" @recall-message="chat.recallMessage" @mark-read="chat.markRead"
        @back-to-list="handleBackToList" @reply-message="chat.setReplyingMessage"
        @clear-reply-message="chat.clearReplyingMessage" @update-conversation="chat.handleConversationDetailUpdate"
        @load-message-read-status="chat.loadMessageReadStatus" />
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
