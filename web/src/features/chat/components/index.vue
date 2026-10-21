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
 * 三档设备（正常情况只有这三档，见 features/chat/style/index.scss 文件头）：
 *
 *   大屏电脑端（宽 > 1200）  双栏 + 32px 控件 / 12px 间距
 *   平板端（600 ~ 1200）     双栏 + 24px 控件 / 6px 间距
 *   手机端（宽 <= 600）      单栏 + 24px 控件 / 6px 间距
 *
 * 原来用 `isMobile`（竖屏 且 宽 <= 768）判单栏，会把竖屏平板（768x1024）
 * 也判成单栏，与「平板两个界面一起展示」的预期相反。
 * 现在统一看 tier：只有手机档才走单栏，平板档与电脑档都是双栏。
 *
 * 判定结果与 CSS 用的是同一组边界（utils/device-layout.ts 与
 * styles/responsive-mixins.scss 的 device-* mixin），不会出现
 * 「JS 判单栏、CSS 排双栏」的半吊子状态。
 */
const { isPhoneTier } = useDeviceLayout();

/** 是否单栏结构（手机档）：会话列表与聊天界面二选一。 */
const isSinglePanel = isPhoneTier;

const showConversationList = computed(() => {
  if (!isSinglePanel.value) return true;
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
  if (isSinglePanel.value && chat.selectedConversationId.value) {
    pushConversationHistory();
  }
}

function handleBackToList() {
  // 单栏结构优先消费自己压入的历史记录，保证系统返回键与按钮行为一致
  if (isSinglePanel.value && conversationHistoryPushed) {
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

    <div class="layout" :class="{ 'single-panel': isSinglePanel }">
      <ConversationSidebar v-show="showConversationList"
        v-model:create-title="chat.createTitle.value" v-model:create-member-user-ids="chat.createMemberUserIds.value"
        :selected-conversation-id="chat.selectedConversationId.value" :conversations="chat.conversations.value"
        :is-single-panel="isSinglePanel" :loading="chat.loading.value && chat.conversations.value.length === 0"
        :friend-request-version="chat.friendRequestVersion.value"
        :friendship-version="chat.friendshipVersion.value"
        @create-conversation="chat.handleCreateConversation"
        @select-conversation="handleSelectConversation" />

      <MessagePanel v-if="!isSinglePanel || !showConversationList" v-model="chat.composeText.value"
        v-model:conversation-detail="chat.currentConversation.value!" :messages="chat.messages.value"
        :pending-text-messages="chat.pendingTextMessages.value" :me-user-id="chat.meUserId.value"
        :loading="chat.loading.value" :sending="chat.sending.value" :loading-more="chat.loadingMore.value"
        :show-back-to-list="isSinglePanel" :replying-message="chat.replyingMessage.value"
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
