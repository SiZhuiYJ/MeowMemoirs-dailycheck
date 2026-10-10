<script setup lang="ts">
import ProgressiveAvatar from "@/components/ProgressiveAvatar/index.vue";
import type { ConversationSummary } from "../types";
import { MuteNotification, Message } from "@element-plus/icons-vue";
import {
  getConversationAvatarSources,
  getConversationAvatarText,
  getConversationAvatarUrl,
  getConversationDisplayTitle,
  getMessagePreview,
} from "../utils/chat";

defineProps<{
  selectedConversationId: number;
  conversations: ConversationSummary[];
  isMobile: boolean;
}>();

const emit = defineEmits<{
  selectConversation: [item: ConversationSummary];
}>();
</script>

<template>
  <el-scrollbar :view-class="isMobile ? 'mobile' : ''">
    <ul class="conversation-list">
      <li v-for="item in conversations" :key="item.id" class="conversation-item"
        :class="{ active: item.id === selectedConversationId }" @click="emit('selectConversation', item)">
        <ProgressiveAvatar class="conversation-avatar" :src="getConversationAvatarUrl(item)"
          :thumbnail-src="getConversationAvatarSources(item).thumbnailSrc" :size="60" shape="square">
          {{ getConversationAvatarText(item) }}
        </ProgressiveAvatar>
        <el-badge :value="item.unreadCount" :show-zero="false" :max="99" :offset="[-22, 5]"
          :color="item.isMuted ? '#f5f7fa' : ''" class="item">
          <div class="title-row">
            <strong>{{ getConversationDisplayTitle(item) }}</strong>
            <svg-icon v-if="item.isPinned" class="pinned-icon" icon-class="general-pg-up" size="16px" />
            <el-icon v-if="item.isMuted" class="muted-icon">
              <MuteNotification />
            </el-icon>
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
            <div class="custom-content">
              <el-icon>
                <Message />
              </el-icon>
              <span>{{ value }}</span>
            </div>
          </template>
        </el-badge>
      </li>
    </ul>
  </el-scrollbar>
</template>
