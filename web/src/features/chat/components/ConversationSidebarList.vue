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
        <!-- size 传 CSS 变量而不是 60：ProgressiveAvatar 会把 size 写成内联 width/height，
             传字符串才能让「列表越窄头像越小」由容器查询接管 -->
        <ProgressiveAvatar class="conversation-avatar" :src="getConversationAvatarUrl(item)"
          :thumbnail-src="getConversationAvatarSources(item).thumbnailSrc" :size="'var(--chat-item-avatar, 60px)'"
          shape="square">
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
@use "@/styles/responsive-mixins" as rp;

// ==============================================
// 会话列表项：按「可用宽度」自适应，而不是死守固定字号
// ==============================================
// 为什么不只是一味加省略号：
// 列表窄到 180px 时，60px 头像 + 内边距 + 间距就吃掉一半，
// 文字只剩约 97px，直接省略号几乎看不到字。所以分两步：
//   1. 头像与字号跟着列表宽度缩（字小了才能真的多显示几个字）；
//   2. 省略号只作为超长名字的最后兜底，且**绝不换行**
//      （换行会撑高行高、打乱整列对齐）。
//
// 把列表自身作为查询容器，cqi = 容器内容宽的 1%，
// 这样不管列表是被侧栏挤窄还是被媒体查询改窄，都自动适配。
// 容器查询不被支持时，--chat-item-* 未定义，
// 头像回退到 60px、字号继承，仍可正常使用。
.conversation-list {
  container-type: inline-size;
}

.conversation-item {
  // 头像：约 36px（窄）-> 60px（宽）
  --chat-item-avatar: clamp(36px, 21.7cqi, 60px);
  // 主文字：11px（窄）-> 13px（宽）。跟着全局字号下调过一档
  // （原来的 12–14 是下调前的档位）。
  --chat-item-fs: clamp(11px, 5.5cqi, 13px);
  // 次要文字（时间）：10px -> 11px
  --chat-item-fs-sm: clamp(10px, 4.4cqi, 11px);

  // 内边距与列内间距也随列表宽度缩：原来固定 12px，
  // 在 180px 宽的列表里光左右内边距就吃掉 24px（13%）+ 头像 60px + 间距 12px，
  // 文字只剩不到一半。窄列表收到 6px 更合适。
  // 直接写 clamp(cqi) 不需要外层 @container —— cqi 自动取最近的容器
  // （即 .conversation-list）。容器查询不被支持时该声明作废，
  // 回退到全局样式里的 12px，不会坏。
  padding: clamp(6px, 3.6cqi, 12px);
  gap: clamp(6px, 3.6cqi, 12px);
}

// 注：`.item`（el-badge 根元素）的收缩修复放在
// features/chat/style/index.scss 的 `.item` 里 —— 那里是它被定义的地方，
// 避免同一件事在两处各写一遍。这里只负责「按容器宽度自适应」的数值。

.title-row {
  min-width: 0;

  strong {
    font-size: var(--chat-item-fs);
    font-weight: 600;
    // 单行 + 省略号：长名字不换行，只截断
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pinned-icon,
  .muted-icon {
    flex-shrink: 0;
  }
}

// 最后一条消息预览：字号跟着缩，一行截断由 el-text 的 line-clamp 负责
.conversation-item :deep(.el-text) {
  font-size: var(--chat-item-fs);
}

.conversation-time {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--chat-muted, #6b7280);
  font-size: var(--chat-item-fs-sm, 11px);
  line-height: 16px;
  white-space: nowrap;
}

// 极窄列表时让时间给会话名让位。
//
// 标题行里「置顶图标 + 免打扰图标 + 时间」都是 flex-shrink: 0，
// 加起来约占 90px；容器 182px 时留给会话名只剩 30 多px，等于两三个字。
// 时间在消息面板里还能看到，会话名更该优先显示。
// 阈值 220px 对应列表宽约 236px 以下才隐藏，宽列表不受影响。
// 不想要这条行为，删掉这个 @container 块即可。
@container (max-width: 220px) {
  .conversation-time {
    display: none;
  }
}

.conversation-empty {
  display: grid;
  gap: 6px;
  justify-items: center;
  padding: 120px 16px 16px;
  color: var(--chat-muted, #6b7280);
  font-size: 12px;
  text-align: center;
}

.conversation-empty-title {
  color: #111827;
  font-size: 13px;
  font-weight: 600;
}

.conversation-empty-hint {
  font-size: 11px;
  line-height: 18px;
}

.badge-left :deep(.el-badge__content.is-fixed) {
  right: auto;
  left: 0;
  top: 0;
  transform: translate(-100%, -50%);

  @include rp.phone {
    top: 4px;
  }
}
</style>
