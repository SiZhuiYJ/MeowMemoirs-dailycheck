<script setup lang="ts">
import ProgressiveAvatar from "@/components/ProgressiveAvatar/index.vue";
import type { ConversationSummary } from "../types";
import { MuteNotification, Message } from "@element-plus/icons-vue";
import {
  formatConversationListTime,
  getConversationAvatarSources,
  getConversationAvatarText,
  getConversationAvatarUrl,
  getConversationDisplayTitle,
  getMessagePreview,
} from "../utils/chat";

const props = defineProps<{
  selectedConversationId: number;
  conversations: ConversationSummary[];
  isMobile: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{
  selectConversation: [item: ConversationSummary];
}>();

/** 会话列表时间取最后一条消息时间，没有消息时退回会话更新时间。 */
function getItemTime(item: ConversationSummary) {
  return formatConversationListTime(item.lastMessage?.createdAt ?? item.updatedAt);
}
</script>

<template>
  <el-scrollbar :view-class="isMobile ? 'mobile' : ''">
    <ul v-if="conversations.length > 0" class="conversation-list">
      <li v-for="item in conversations" :key="item.id" class="conversation-item"
        :class="{ active: item.id === selectedConversationId }" @click="emit('selectConversation', item)">
        <ProgressiveAvatar class="conversation-avatar" :src="getConversationAvatarUrl(item)"
          :thumbnail-src="getConversationAvatarSources(item).thumbnailSrc" :size="60" shape="square">
          {{ getConversationAvatarText(item) }}
        </ProgressiveAvatar>
        <el-badge :value="item.unreadCount" :show-zero="false" :max="99" :color="item.isMuted ? '#a2a2a2' : ''"
          class="item badge-left">
          <div class="title-row">
            <strong>{{ getConversationDisplayTitle(item) }}</strong>
            <svg-icon v-if="item.isPinned" class="pinned-icon" icon-class="general-pg-up" size="16px" />
            <el-icon v-if="item.isMuted" class="muted-icon">
              <MuteNotification />
            </el-icon>
            <span class="conversation-time">{{ getItemTime(item) }}</span>
          </div>
          <el-text :line-clamp="1">
            {{
              item.lastMessage?.isRecalled
                ? ""
                : `${item.lastMessage?.messageType === "system"
                  ? "系统"
                  : (item.lastMessage?.senderNickName ||
                    item.lastMessage?.senderUserId ||
                    "系统")}：`
            }}
            {{ getMessagePreview(item) }}
          </el-text>
          <template #content="{ value }">
            <div class="custom-content" :style="{ color: item.isMuted ? '#000' : '#fff' }">
              <el-icon>
                <Message />
              </el-icon>
              <span>{{ value }}</span>
            </div>
          </template>
        </el-badge>
      </li>
    </ul>

    <div v-else class="conversation-empty">
      <template v-if="props.loading">正在加载会话…</template>
      <template v-else>
        <div class="conversation-empty-title">还没有任何会话</div>
        <div class="conversation-empty-hint">在上方选择好友或创建一个群聊即可开始</div>
      </template>
    </div>
  </el-scrollbar>
</template>

<style scoped lang="scss">
.conversation-time {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--chat-muted, #6b7280);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}

.conversation-empty {
  display: grid;
  gap: 6px;
  justify-items: center;
  padding: 120px 16px 16px;
  color: var(--chat-muted, #6b7280);
  font-size: 13px;
  text-align: center;
}

.conversation-empty-title {
  color: #111827;
  font-size: 14px;
  font-weight: 600;
}

.conversation-empty-hint {
  font-size: 12px;
  line-height: 18px;
}

.badge-left :deep(.el-badge__content.is-fixed) {
  right: auto;
  left: 0;
  top: 0;
  transform: translate(-100%, -50%);

  @media (max-width: 768px) {
    top: 4px;
  }
}
</style>
