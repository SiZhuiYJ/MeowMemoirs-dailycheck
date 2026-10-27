<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ChatDotRound, CircleCloseFilled, CopyDocument, Refresh, UserFilled } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import ProgressiveAvatar from '@/components/ProgressiveAvatar/index.vue';
import { blockUser, createFriendRequest, unblockUser } from '@/features/chat/api/friends';
import { getUserProfile } from '@/features/chat/api/users';
import type { UserProfile } from '@/features/chat/types';
import { formatChatDateTime } from '@/features/chat/utils/chat';
import { copyTextToClipboard } from '@/features/chat/utils/clipboard';
import {
  CHAT_CONVERSATION_QUERY,
  buildChatConversationRoute,
  parseConversationId,
} from '@/features/chat/utils/navigation';
import { getUserAvatarSources } from '@/utils/avatar';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const profile = ref<UserProfile | null>(null);
const errorText = ref('');

const userId = computed(() => {
  const value = Number(route.params.userId);
  return Number.isInteger(value) && value > 0 ? value : 0;
});

/**
 * 从聊天页进入主页时带过来的「来源会话」。
 * 点击「返回聊天」时原样带回 /chat，由聊天页校验它是否仍在当前用户的会话列表内。
 */
const originConversationId = computed(() =>
  parseConversationId(route.query[CHAT_CONVERSATION_QUERY]),
);

const displayName = computed(() => {
  const current = profile.value;
  if (!current) return '用户主页';
  return (
    current.friendRemark?.trim() ||
    current.nickName?.trim() ||
    current.userAccount?.trim() ||
    `用户 #${current.userId}`
  );
});

const avatarSources = computed(() =>
  profile.value
    ? getUserAvatarSources(profile.value.userId, profile.value.avatarKey)
    : { src: '', thumbnailSrc: '' },
);

const joinedAtText = computed(() =>
  profile.value ? formatChatDateTime(profile.value.createdAt) || '未知' : '—',
);

const relationshipText = computed(() => {
  const current = profile.value;
  if (!current) return '—';
  if (current.isSelf) return '这是你自己';
  return current.isFriend ? '好友' : '非好友';
});

const canStartChat = computed(
  () =>
    Boolean(
      profile.value &&
      !profile.value.isSelf &&
      !profile.value.isBlockedByTarget &&
      profile.value.directConversationId,
    ),
);

const friendRequestSending = ref(false);
const friendRequestSent = ref(false);
const blockSubmitting = ref(false);

const canAddFriend = computed(
  () =>
    Boolean(
      profile.value &&
      !profile.value.isSelf &&
      !profile.value.isFriend &&
      profile.value.status === 'active' &&
      !profile.value.isBlocked &&
      !profile.value.isBlockedByTarget,
    ),
);

const addFriendDisabled = computed(
  () =>
    friendRequestSending.value ||
    friendRequestSent.value ||
    profile.value?.hasPendingSentRequest === true,
);

const addFriendButtonText = computed(() => {
  if (friendRequestSending.value) return '发送中…';
  if (profile.value?.hasPendingReceivedRequest) return '接受好友申请';
  if (friendRequestSent.value || profile.value?.hasPendingSentRequest) return '申请已发送';
  return '添加好友';
});

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null) {
    const responseMessage = (
      error as { response?: { data?: { message?: unknown } } }
    ).response?.data?.message;
    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage;
    }

    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
}

async function handleAddFriend() {
  const current = profile.value;
  if (!current || !canAddFriend.value || addFriendDisabled.value) return;

  friendRequestSending.value = true;
  try {
    const { data } = await createFriendRequest({
      receiverUserId: current.userId,
      requestSource: 'search',
    });

    if (data.requestStatus === 'accepted') {
      current.isFriend = true;
      current.hasPendingSentRequest = false;
      current.hasPendingReceivedRequest = false;
      ElMessage.success('已添加好友');
    } else {
      friendRequestSent.value = true;
      current.hasPendingSentRequest = true;
      ElMessage.success('好友申请已发送');
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '发送好友申请失败'));
  } finally {
    friendRequestSending.value = false;
  }
}

async function handleToggleBlock() {
  const current = profile.value;
  if (!current || current.isSelf || blockSubmitting.value) return;

  const isUnblocking = current.isBlocked;
  try {
    await ElMessageBox.confirm(
      isUnblocking
        ? `解除拉黑后，${displayName.value} 可以重新添加你为好友、与你聊天，并在搜索中找到你。`
        : `拉黑后，${displayName.value} 将无法添加你为好友、与你发起单聊或搜索到你。主页仍可查看，好友状态会保留，群聊不受影响。`,
      isUnblocking ? '解除拉黑' : '拉黑用户',
      {
        type: 'warning',
        confirmButtonText: isUnblocking ? '解除拉黑' : '拉黑',
        cancelButtonText: '取消',
      },
    );
  } catch {
    return;
  }

  blockSubmitting.value = true;
  try {
    if (isUnblocking) {
      await unblockUser(current.userId);
      current.isBlocked = false;
      ElMessage.success('已解除拉黑');
    } else {
      await blockUser(current.userId);
      current.isBlocked = true;
      current.hasPendingSentRequest = false;
      current.hasPendingReceivedRequest = false;
      ElMessage.success('已拉黑，可在「更多 > 黑名单」中解除');
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, isUnblocking ? '解除拉黑失败' : '拉黑失败'));
  } finally {
    blockSubmitting.value = false;
  }
}

async function loadProfile() {
  errorText.value = '';
  friendRequestSent.value = false;

  if (!userId.value) {
    profile.value = null;
    errorText.value = '用户 ID 无效';
    return;
  }

  loading.value = true;
  try {
    profile.value = (await getUserProfile(userId.value)).data;
  } catch (error: unknown) {
    profile.value = null;
    errorText.value =
      (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
      '加载用户信息失败';
  } finally {
    loading.value = false;
  }
}

watch(userId, () => void loadProfile(), { immediate: true });

function goBack() {
  if (window.history.length > 1) {
    router.back();
    return;
  }
  void router.push('/chat');
}

/**
 * 返回聊天。
 *
 * 从会话里点进主页时带着来源会话 ID：把它一起带回 /chat，聊天页会在
 * 当前会话列表里校验，合法且仍在列表内才打开，否则什么都不动。
 * 直接打开主页（没有来源会话）时保持原来的后退行为。
 */
function returnToChat() {
  if (originConversationId.value) {
    void router.push(buildChatConversationRoute(originConversationId.value));
    return;
  }
  goBack();
}

function startChat() {
  const conversationId = profile.value?.directConversationId;
  if (!conversationId) {
    ElMessage.info('你们还没有单聊会话');
    return;
  }
  void router.push(buildChatConversationRoute(conversationId));
}

async function copyAccount() {
  const account = profile.value?.userAccount?.trim();
  if (!account) {
    ElMessage.warning('该用户没有设置账号');
    return;
  }

  try {
    // 统一走剪贴板工具：Clipboard API 不可用（例如局域网 http 访问）时
    // 会退回到 textarea + execCommand，不再直接报「复制失败」。
    await copyTextToClipboard(account);
    ElMessage.success('账号已复制');
  } catch (error) {
    console.error('复制账号失败:', error);
    ElMessage.error('复制失败，请手动选择账号');
  }
}
</script>

<template>
  <div class="user-home-page">
    <div class="user-home-panel">
      <div class="user-home-detail">
        <el-scrollbar class="user-home-scrollbar">
          <div class="user-home-scroll-content">
            <section v-if="profile" class="user-home-card">
              <div class="user-home-hero">
                <ProgressiveAvatar class="user-home-avatar" :src="avatarSources.src"
                  :thumbnail-src="avatarSources.thumbnailSrc" :size="96" shape="square">
                  {{ displayName.slice(0, 1) }}
                </ProgressiveAvatar>
                <div class="user-home-identity">
                  <h2>{{ displayName }}</h2>
                  <div class="user-home-account">
                    <span>{{ profile.userAccount || '未设置账号' }}</span>
                    <el-button v-if="profile.userAccount" link :icon="CopyDocument"
                      @click="copyAccount">
                      复制账号
                    </el-button>
                  </div>
                  <div class="user-home-badges">
                    <span class="badge">{{ relationshipText }}</span>
                    <span v-if="profile.isBlocked" class="badge blocked">已拉黑</span>
                    <span v-else-if="profile.isBlockedByTarget" class="badge blocked">对方已拉黑你</span>
                    <span class="badge" :class="{ frozen: profile.status !== 'active' }">
                      {{ profile.status === 'active' ? '账号正常' : '账号已冻结' }}
                    </span>
                  </div>
                </div>
              </div>

              <dl class="user-home-meta">
                <div>
                  <dt>用户 ID</dt>
                  <dd>#{{ profile.userId }}</dd>
                </div>
                <div>
                  <dt>注册时间</dt>
                  <dd>{{ joinedAtText }}</dd>
                </div>
                <div>
                  <dt>好友备注</dt>
                  <dd>{{ profile.friendRemark || '—' }}</dd>
                </div>
                <div>
                  <dt>单聊会话</dt>
                  <dd>{{ profile.directConversationId ? `#${profile.directConversationId}` : '暂无' }}</dd>
                </div>
              </dl>
            </section>

            <section v-else-if="loading" class="user-home-state">
              <div class="state-title">正在加载用户信息…</div>
            </section>

            <section v-else class="user-home-state">
              <div class="state-title">{{ errorText || '用户不存在或已注销' }}</div>
            </section>
          </div>
        </el-scrollbar>

        <!-- 顶部栏：app-shell 提供的悬浮毛玻璃样式 -->
        <div class="user-home-header">
          <div class="user-home-header-main">
            <el-button :icon="ArrowLeft" @click="returnToChat">返回</el-button>
            <h3>{{ displayName }}</h3>
          </div>
          <el-button :icon="Refresh" type="primary" plain :loading="loading" @click="loadProfile">
            刷新
          </el-button>
        </div>

        <!-- 底部操作栏：app-shell 提供的悬浮毛玻璃样式 -->
        <div class="user-home-composer" role="toolbar" aria-label="用户主页操作">
          <el-button v-if="canStartChat" :icon="ChatDotRound" type="primary" @click="startChat">
            发消息
          </el-button>
          <el-button v-if="canAddFriend" :icon="UserFilled" type="primary" :loading="friendRequestSending"
            :disabled="addFriendDisabled" @click="handleAddFriend">
            {{ addFriendButtonText }}
          </el-button>
          <el-button v-if="profile && !profile.isSelf" :icon="CircleCloseFilled"
            :type="profile?.isBlocked ? 'success' : 'danger'" plain :loading="blockSubmitting"
            @click="handleToggleBlock">
            {{ profile?.isBlocked ? '解除拉黑' : '拉黑' }}
          </el-button>
          <el-button plain @click="returnToChat">返回聊天</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/app-shell" as shell;
@use "@/styles/responsive-mixins" as rp;

.user-home-page {
  @include shell.app-shell-tokens;
  @include shell.app-page-shell;

  // 用户主页复用聊天页的 --chat-* 皮肤：日间浅色、夜间深色，
  // 面板 / 悬浮栏 / 描边 / 阴影都跟聊天页保持同一套色板。
  --shell-bg: var(--chat-bg);
  --shell-surface: var(--chat-surface);
  --shell-border: var(--chat-border);
  --shell-shadow: var(--chat-shadow);
  --shell-muted: var(--chat-muted);
  --shell-accent-soft: var(--chat-accent-soft);
}

.user-home-panel {
  @include shell.app-surface-panel;
  flex: 1;
  min-height: 0;
}

.user-home-detail {
  @include shell.app-panel-body;
}

.user-home-scrollbar {
  height: 100%;
}

// 与聊天消息列表同一套上下留白：内容滚动时可以钻到顶部栏 / 底部操作栏下面，
// 初始位置又不会被两个浮层压住。
.user-home-scroll-content {
  box-sizing: border-box;
  min-height: 100%;
  @include shell.app-scroll-region-padding;
}

.user-home-header {
  @include shell.app-floating-header;
}

.user-home-header-main {
  display: flex;
  align-items: center;
  gap: var(--shell-gap);
  min-width: 0;
}

.user-home-header h3 {
  margin: 0;
  padding-left: 6px;
  overflow: hidden;
  color: var(--chat-text);
  font-size: var(--shell-title-fs);
  font-weight: 700;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-home-composer {
  @include shell.app-floating-bar;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.user-home-card {
  display: grid;
  gap: 20px;
  max-width: 720px;
  margin: 0 auto;
  padding: 24px;
}

.user-home-hero {
  display: flex;
  align-items: center;
  gap: 18px;
}

.user-home-avatar {
  flex-shrink: 0;
  color: var(--chat-text);
  font-size: 32px;
  background: var(--chat-accent-soft);
}

.user-home-identity {
  min-width: 0;

  h2 {
    margin: 0 0 4px;
    color: var(--chat-text);
    font-size: 22px;
    font-weight: 700;
    line-height: 30px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.user-home-account {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
}

.user-home-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--chat-success-text);
  font-size: 11px;
  line-height: 18px;
  background: var(--chat-success-soft);

  &.frozen {
    color: var(--chat-danger-text);
    background: var(--chat-danger-soft);
  }

  &.blocked {
    color: var(--chat-danger-text);
    background: var(--chat-danger-soft);
  }
}

.user-home-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding: 16px;
  border-radius: 10px;
  background: var(--chat-surface-soft);

  div {
    min-width: 0;
  }

  dt {
    color: var(--chat-muted);
    font-size: 11px;
    line-height: 18px;
  }

  dd {
    margin: 2px 0 0;
    color: var(--chat-text);
    font-size: 13px;
    font-weight: 600;
    line-height: 20px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.user-home-state {
  display: grid;
  gap: 12px;
  justify-items: center;
  max-width: 720px;
  margin: 48px auto 0;
  padding: 32px;
}

.state-title {
  color: var(--chat-muted);
  font-size: 13px;
  line-height: 20px;
}

@include rp.device-mobile {
  .user-home-page {
    @include shell.app-shell-tokens-mobile;
  }

  .user-home-card {
    padding: 16px;
  }

  .user-home-hero {
    gap: 12px;
  }

  .user-home-avatar {
    font-size: 24px;
  }

  .user-home-identity h2 {
    font-size: 18px;
    line-height: 24px;
  }

  .user-home-meta {
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 12px;
  }

  .user-home-state {
    margin-top: 24px;
    padding: 24px 16px;
  }
}

// 与聊天页一致：手机档把 el-scrollbar 的纵向滚动条收窄到 3px。
@include rp.device-phone {
  .user-home-scrollbar :deep(.el-scrollbar__bar.is-vertical) {
    width: 3px;
  }
}
</style>