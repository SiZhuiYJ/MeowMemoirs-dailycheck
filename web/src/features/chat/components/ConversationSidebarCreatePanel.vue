<script setup lang="ts">
import {
  ArrowDown,
  Brush,
  ChatRound,
  CircleClose,
  HomeFilled,
  Refresh,
} from "@element-plus/icons-vue";
import { ref } from "vue";
import ProgressiveAvatar from "@/components/ProgressiveAvatar/index.vue";
import ChatDialog from "./ChatDialog.vue";
import ThemeColorDialog from "@/components/ThemeColorDialog.vue";
import router from "@/routers";
import { getUserAvatarUrl } from "@/utils/avatar";
import {
  useConversationCreateForm,
  type ConversationFriendOption,
} from "../composables/useConversationCreateForm";
import {
  useConversationSidebarSocial,
  type SidebarActionCommand,
} from "../composables/useConversationSidebarSocial";
import { buildUserHomeRoute } from "../utils/navigation";

const createTitle = defineModel<string>("createTitle", {
  required: true,
});
const createMemberUserIds = defineModel<number[]>("createMemberUserIds", {
  required: true,
});

const props = defineProps<{
  /** 当前打开的会话（没有打开时为 0）；进用户主页时带给主页，供返回时回到原会话。 */
  currentConversationId: number;
  friendRequestVersion: number;
  friendshipVersion: number;
  /** 推送状态，原顶部工具栏的连接状态输入框。 */
  statusText: string;
  /** 是否正在推送（实时已连接或轮询中）。 */
  polling: boolean;
  /** 推送切换请求进行中时禁用菜单项。 */
  pushLoading: boolean;
}>();

const emit = defineEmits<{
  createConversation: [];
  back: [];
  refresh: [];
  togglePush: [];
}>();

const {
  friendLoading,
  friends,
  blacklistDialogVisible,
  blacklistLoading,
  blacklist,
  blacklistUnblockingId,
  pendingFriendRequestCount,
  friendSearchDialogVisible,
  friendSearchLoading,
  friendSearchSubmittingId,
  friendSearchKeyword,
  friendSearchRequestMessage,
  friendSearchResults,
  friendSearchSearched,
  canSearchFriend,
  canCloseFriendSearchDialog,
  friendRequestDialogVisible,
  friendRequestLoading,
  sortedFriendRequests,
  handlingRequestId,
  friendRequestStatusMap,
  groupJoinDialogVisible,
  groupSearchLoading,
  groupJoinSubmitting,
  groupJoinConversationIdInput,
  groupJoinRequestMessage,
  groupSearchResult,
  groupSearchSearched,
  canSearchGroup,
  canSubmitGroupJoin,
  canCloseGroupJoinDialog,
  handleActionCommand,
  refreshFriendData,
  resetFriendSearchDialog,
  executeFriendSearch,
  handleSendFriendRequest,
  getFriendSearchName,
  getFriendSearchMeta,
  renderFriendSearchName,
  getFriendSearchActionText,
  getFriendSearchAvatar,
  getRequestStatusType,
  getFriendRequestUser,
  getFriendRequestAvatar,
  getFriendLabel,
  getFriendMeta,
  formatFriendRequestTime,
  handleAcceptRequest,
  handleRejectRequest,
  loadBlacklist,
  openBlacklistDialog,
  handleUnblockUser,
  getBlockedUserLabel,
  getBlockedUserMeta,
  getBlockedUserAvatar,
  formatBlockedAt,
  resetGroupJoinDialog,
  executeGroupSearch,
  handleSubmitGroupJoin,
  getGroupSearchTitle,
  getGroupSearchAvatar,
} = useConversationSidebarSocial({
  friendRequestVersion: () => props.friendRequestVersion,
  friendshipVersion: () => props.friendshipVersion,
});

const {
  friendOptions,
  isGroupConversation,
  getFriendAvatarSources,
  getSelectedFriendInitial,
} = useConversationCreateForm({
  createTitle,
  createMemberUserIds,
  friends,
});

/** 「好友列表」与「发起群聊」从创建区移入「更多」后，由这两个弹窗承载。 */
const friendListDialogVisible = ref(false);
const createGroupDialogVisible = ref(false);
const themeColorDialogVisible = ref(false);

type CreatePanelCommand =
  | SidebarActionCommand
  | "friendList"
  | "createGroup"
  | "refresh"
  | "togglePush"
  | "themeColor";

function openFriendList() {
  friendListDialogVisible.value = true;
  void refreshFriendData(false);
}

/** 好友搜索结果里点击头像：进入该用户的主页，并带上当前会话，供「返回聊天」原路返回。 */
function openUserProfile(userId: number) {
  if (!userId) return;
  void router.push(buildUserHomeRoute(userId, props.currentConversationId));
}

/** 好友列表里点好友 = 直接发起单聊；创建仍在父级统一处理。 */
function startDirectChat(item: ConversationFriendOption) {
  createMemberUserIds.value = [item.userId];
  friendListDialogVisible.value = false;
  emit("createConversation");
}

function submitCreateGroup() {
  if (!isGroupConversation.value) return;
  createGroupDialogVisible.value = false;
  emit("createConversation");
}

function handleSocialCommand(command: CreatePanelCommand) {
  switch (command) {
    case "friendList":
      openFriendList();
      break;
    case "createGroup":
      createGroupDialogVisible.value = true;
      break;
    case "refresh":
      emit("refresh");
      break;
    case "togglePush":
      emit("togglePush");
      break;
    case "themeColor":
      themeColorDialogVisible.value = true;
      break;
    default:
      handleActionCommand(command);
      break;
  }
}

/** 打开「更多」时静默同步一次黑名单数量（实时推送不可用时也能保持准确）。 */
function handleMoreMenuVisibleChange(visible: boolean) {
  if (visible) void loadBlacklist({ silent: true });
}
</script>

<template>
  <div class="create-box">
    <div class="create-box-item">
      <!-- 回到主页：从顶部工具栏移到会话标题左侧 -->
      <el-button class="create-box-back" :icon="HomeFilled" aria-label="回到主页" title="回到主页"
        @click="emit('back')">
        <span class="create-box-back-text">主页</span>
      </el-button>
      <h3>会话列表</h3>
      <el-dropdown placement="bottom-end" trigger="click" @command="handleSocialCommand"
        @visible-change="handleMoreMenuVisibleChange">
        <span class="social-dropdown-trigger">
          <el-badge :value="pendingFriendRequestCount" :show-zero="false" :max="99" :offset="[-6, 6]">
            <el-button>
              更多
              <el-icon class="el-icon--right">
                <ArrowDown />
              </el-icon>
            </el-button>
          </el-badge>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="friendList">
              <div class="social-dropdown-item">
                <span>好友列表</span>
                <span class="social-dropdown-count">{{ friends.length }}</span>
              </div>
            </el-dropdown-item>
            <el-dropdown-item :disabled="friends.length < 2" command="createGroup">
              发起群聊
            </el-dropdown-item>
            <el-dropdown-item divided :disabled="friendSearchSubmittingId !== null" command="addFriend">
              添加好友
            </el-dropdown-item>
            <el-dropdown-item :disabled="groupJoinSubmitting" command="groupJoin">
              申请加群
            </el-dropdown-item>
            <el-dropdown-item command="friendRequest">
              <div class="social-dropdown-item">
                <span>好友申请</span>
                <el-badge :value="pendingFriendRequestCount" :show-zero="false" :max="99" />
              </div>
            </el-dropdown-item>
            <el-dropdown-item command="blacklist">
              <div class="social-dropdown-item">
                <span>黑名单</span>
                <span class="social-dropdown-count">{{ blacklist.length }}</span>
              </div>
            </el-dropdown-item>

            <!-- 原顶部工具栏：连接状态 / 刷新 / 开启或停止推送 -->
            <el-dropdown-item divided disabled>
              <div class="social-dropdown-status">
                <span class="social-dropdown-status-label">连接状态</span>
                <span class="social-dropdown-status-text">{{ statusText }}</span>
              </div>
            </el-dropdown-item>
            <el-dropdown-item command="refresh" :icon="Refresh">
              刷新
            </el-dropdown-item>
            <el-dropdown-item command="togglePush" :icon="CircleClose" :disabled="pushLoading">
              {{ polling ? "停止推送" : "开启推送" }}
            </el-dropdown-item>
            <el-dropdown-item command="themeColor" divided :icon="Brush">
              主题色
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <ChatDialog v-model="friendListDialogVisible" title="好友列表" content-width="640px">
      <div v-loading="friendLoading" class="friend-list-panel">
        <div class="friend-list-toolbar">
          <span class="friend-list-count">共 {{ friends.length }} 位好友</span>
          <el-button plain :loading="friendLoading" @click="refreshFriendData(false)">
            刷新
          </el-button>
        </div>

        <el-empty v-if="!friendLoading && friends.length === 0" description="暂无好友，先去添加好友吧" />

        <div v-else>
          <button v-for="item in friendOptions" :key="item.userId" class="friend-list-row" type="button"
            @click="startDirectChat(item)">
            <ProgressiveAvatar class="conversation-avatar" :src="getUserAvatarUrl(item.userId, item.avatarKey)"
              :thumbnail-src="getUserAvatarUrl(item.userId, item.avatarKey, { thumbnail: true })" :size="44"
              shape="square">
              {{ item.label.slice(0, 1) }}
            </ProgressiveAvatar>
            <span class="friend-list-text">
              <strong>{{ item.label }}</strong>
              <span class="friend-list-meta">{{ item.meta }}</span>
            </span>
            <span class="friend-list-action">发起聊天</span>
          </button>
        </div>

        <p class="friend-list-tip">点击好友即可开始单聊；需要拉多人时用「发起群聊」。</p>
      </div>
    </ChatDialog>

    <ChatDialog v-model="createGroupDialogVisible" title="发起群聊" content-width="640px">
      <div class="create-group-panel">
        <el-input v-model="createTitle" clearable placeholder="群聊标题（可选）" />
        <el-select v-model="createMemberUserIds" class="member-select" multiple filterable clearable collapse-tags
          collapse-tags-tooltip :loading="friendLoading" placeholder="选择至少两位好友">
          <el-option v-for="item in friendOptions" :key="item.userId" :label="item.label" :value="item.userId">
            <span class="member-select-item">
              <ProgressiveAvatar class="conversation-avatar" :src="getUserAvatarUrl(item.userId, item.avatarKey)"
                :thumbnail-src="getUserAvatarUrl(item.userId, item.avatarKey, { thumbnail: true })" :size="20"
                shape="square">
                {{ item.label.slice(0, 1) }}
              </ProgressiveAvatar>
              {{ item.label }}({{ item.meta }})
            </span>
          </el-option>
          <template #tag>
            <ProgressiveAvatar v-for="item in createMemberUserIds" :key="item" class="conversation-avatar"
              :src="getFriendAvatarSources(item).src" :thumbnail-src="getFriendAvatarSources(item).thumbnailSrc"
              :size="20" shape="square">
              {{ getSelectedFriendInitial(item) }}
            </ProgressiveAvatar>
          </template>
        </el-select>
        <p class="create-group-tip">选择至少两位好友即可创建群聊，群聊标题可以留空。</p>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="createGroupDialogVisible = false">取消</el-button>
          <el-button :icon="ChatRound" type="primary" :disabled="!isGroupConversation" @click="submitCreateGroup">
            创建群聊
          </el-button>
        </div>
      </template>
    </ChatDialog>

    <ChatDialog v-model="friendSearchDialogVisible" title="搜索好友" content-width="640px"
      :closable="canCloseFriendSearchDialog" :close-on-click-modal="canCloseFriendSearchDialog"
      :close-on-press-escape="canCloseFriendSearchDialog" :show-close="canCloseFriendSearchDialog"
      @closed="resetFriendSearchDialog">
      <div class="friend-search-panel">
        <div class="search-toolbar">
          <el-input v-model="friendSearchKeyword" clearable placeholder="输入昵称或账号搜索用户"
            :disabled="friendSearchLoading || friendSearchSubmittingId !== null" @keyup.enter="executeFriendSearch()">
            <template #append>
              <el-button :loading="friendSearchLoading"
                :disabled="!canSearchFriend || friendSearchSubmittingId !== null" @click="executeFriendSearch()">
                搜索
              </el-button>
            </template>
          </el-input>
        </div>

        <el-input v-model="friendSearchRequestMessage" type="textarea" :rows="3" maxlength="255" show-word-limit
          placeholder="好友申请附言（可选）" :disabled="friendSearchSubmittingId !== null" />

        <p class="search-tip">账号需完全匹配，昵称支持包含搜索，命中部分会高亮显示。</p>

        <el-empty v-if="
          friendSearchSearched &&
          !friendSearchLoading &&
          friendSearchResults.length === 0
        " description="未找到匹配的用户" />

        <div v-else-if="friendSearchResults.length > 0">
          <div v-for="item in friendSearchResults" :key="item.userId" class="search-result-row">
            <div class="search-result-main">
              <ProgressiveAvatar class="search-result-avatar search-result-avatar-link"
                :src="getFriendSearchAvatar(item).src" :thumbnail-src="getFriendSearchAvatar(item).thumbnailSrc"
                :data-user-id="item.userId" :size="60" shape="square" :title="`查看 ${getFriendSearchName(item)} 的主页`"
                role="button" tabindex="0" @click.stop="openUserProfile(item.userId)"
                @keydown.enter.prevent="openUserProfile(item.userId)">
                {{ getFriendSearchName(item).slice(0, 1) }}
              </ProgressiveAvatar>
              <div class="search-result-text">
                <div class="search-result-title">
                  <strong v-html="renderFriendSearchName(item)"></strong>
                  <el-tag v-if="item.isFriend" size="small" type="success">已是好友</el-tag>
                  <el-tag v-else-if="item.hasPendingSentRequest" size="small" type="warning">
                    已发送申请
                  </el-tag>
                  <el-tag v-else-if="item.hasPendingReceivedRequest" size="small" type="primary">
                    对方已申请
                  </el-tag>
                </div>
                <div class="search-result-meta">账号：{{ getFriendSearchMeta(item) }}</div>
                <div class="search-result-meta">用户 ID：{{ item.userId }}</div>
              </div>
            </div>

            <div class="search-result-ops">
              <el-button size="small" type="primary" :loading="friendSearchSubmittingId === item.userId"
                :disabled="item.isFriend || item.hasPendingSentRequest" @click="handleSendFriendRequest(item)">
                {{ getFriendSearchActionText(item) }}
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </ChatDialog>

    <ChatDialog v-model="friendRequestDialogVisible" title="好友申请" content-width="720px">
      <div class="friend-request-panel">
        <div class="friend-request-toolbar">
          <el-button plain :loading="friendRequestLoading || friendLoading" @click="refreshFriendData(true)">
            刷新
          </el-button>
        </div>

        <el-empty v-if="!friendRequestLoading && sortedFriendRequests.length === 0" description="暂无好友申请" />

        <div v-else>
          <div v-for="item in sortedFriendRequests" :key="item.id" class="friend-request-row">
            <div class="friend-request-main">
              <div class="friend-request-title">
                <strong>
                  {{
                    item.direction === "received"
                      ? `${getFriendLabel(item)} 请求添加你为好友`
                      : `你向 ${getFriendLabel(item)} 发起了好友申请`
                  }}
                </strong>
                <el-tag size="small" :type="getRequestStatusType(item.requestStatus)">
                  {{ friendRequestStatusMap[item.requestStatus] }}
                </el-tag>
              </div>

              <div class="friend-request-Subject">
                <ProgressiveAvatar class="conversation-avatar friend-request-avatar"
                  :src="getFriendRequestAvatar(item).src"
                  :thumbnail-src="getFriendRequestAvatar(item).thumbnailSrc"
                  :data-user-id="getFriendRequestUser(item).userId" :size="60" shape="square"
                  :title="`查看 ${getFriendLabel(item)} 的主页`" role="button" tabindex="0"
                  @click="openUserProfile(getFriendRequestUser(item).userId)"
                  @keydown.enter.prevent="openUserProfile(getFriendRequestUser(item).userId)">
                  {{ getFriendLabel(item).slice(0, 1) }}
                </ProgressiveAvatar>

                <div class="friend-request-text">
                  <div class="friend-request-meta">账号：{{ getFriendMeta(item) }}</div>
                  <div v-if="item.requestMessage" class="friend-request-meta">
                    附言：{{ item.requestMessage }}
                  </div>
                  <div v-if="item.rejectReason" class="friend-request-meta">
                    拒绝原因：{{ item.rejectReason }}
                  </div>
                  <div class="friend-request-meta">
                    申请时间：{{ formatFriendRequestTime(item.createdAt) }}
                  </div>
                </div>
              </div>
            </div>

            <div v-if="item.direction === 'received' && item.requestStatus === 'pending'" class="friend-request-ops">
              <el-button size="small" type="primary" :loading="handlingRequestId === item.id"
                @click="handleAcceptRequest(item)">
                通过
              </el-button>
              <el-button size="small" type="danger" plain :loading="handlingRequestId === item.id"
                @click="handleRejectRequest(item)">
                拒绝
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </ChatDialog>

    <ChatDialog v-model="blacklistDialogVisible" title="黑名单" content-width="640px">
      <div v-loading="blacklistLoading" class="blacklist-panel">
        <div class="blacklist-toolbar">
          <span class="blacklist-count">共 {{ blacklist.length }} 位用户</span>
          <el-button plain :loading="blacklistLoading" @click="openBlacklistDialog">
            刷新
          </el-button>
        </div>

        <el-empty v-if="!blacklistLoading && blacklist.length === 0" description="黑名单为空，暂无被拉黑的用户" />

        <div v-else>
          <div v-for="item in blacklist" :key="item.id" class="blacklist-row">
            <ProgressiveAvatar class="conversation-avatar blacklist-avatar" :src="getBlockedUserAvatar(item).src"
              :thumbnail-src="getBlockedUserAvatar(item).thumbnailSrc" :data-user-id="item.userId" :size="44"
              shape="square" :title="`查看 ${getBlockedUserLabel(item)} 的主页`" role="button" tabindex="0"
              @click="openUserProfile(item.userId)" @keydown.enter.prevent="openUserProfile(item.userId)">
              {{ getBlockedUserLabel(item).slice(0, 1) }}
            </ProgressiveAvatar>
            <span class="blacklist-text">
              <strong>{{ getBlockedUserLabel(item) }}</strong>
              <span class="blacklist-meta">账号：{{ getBlockedUserMeta(item) }}</span>
              <span class="blacklist-meta">拉黑于 {{ formatBlockedAt(item.createdAt) }}</span>
            </span>
            <el-button size="small" type="danger" plain :loading="blacklistUnblockingId === item.userId"
              :disabled="blacklistUnblockingId !== null && blacklistUnblockingId !== item.userId"
              @click="handleUnblockUser(item)">
              解除拉黑
            </el-button>
          </div>
        </div>

        <p class="blacklist-tip">
          拉黑后，对方无法添加你为好友、与你发起单聊或搜索到你；主页仍可查看，好友状态会保留，群聊也不受影响。
        </p>
      </div>
    </ChatDialog>

    <ChatDialog v-model="groupJoinDialogVisible" title="申请加入群聊" content-width="600px"
      :closable="canCloseGroupJoinDialog" :close-on-click-modal="canCloseGroupJoinDialog"
      :close-on-press-escape="canCloseGroupJoinDialog" :show-close="canCloseGroupJoinDialog"
      @closed="resetGroupJoinDialog">
      <div class="group-join-panel">
        <div class="search-toolbar">
          <el-input v-model="groupJoinConversationIdInput" placeholder="输入群聊 ID，精确搜索" clearable
            :disabled="groupJoinSubmitting || groupSearchLoading" @keyup.enter="executeGroupSearch()">
            <template #append>
              <el-button :loading="groupSearchLoading" :disabled="!canSearchGroup || groupJoinSubmitting"
                @click="executeGroupSearch()">
                搜索
              </el-button>
            </template>
          </el-input>
        </div>

        <p class="group-join-tip">仅支持按群聊 ID 完全匹配搜索。</p>

        <el-empty v-if="groupSearchSearched && !groupSearchLoading && !groupSearchResult" description="未找到匹配的群聊" />

        <div v-else-if="groupSearchResult" class="group-search-card">
          <div class="search-result-main">
            <ProgressiveAvatar class="search-result-avatar" :src="getGroupSearchAvatar(groupSearchResult).src"
              :thumbnail-src="getGroupSearchAvatar(groupSearchResult).thumbnailSrc" :is-preview="true" :size="60"
              shape="square">
              {{ getGroupSearchTitle(groupSearchResult).slice(0, 1) }}
            </ProgressiveAvatar>
            <div class="search-result-text">
              <div class="search-result-title">
                <strong>{{ getGroupSearchTitle(groupSearchResult) }}</strong>
                <el-tag v-if="groupSearchResult.isMember" size="small" type="success">
                  你已在群内
                </el-tag>
                <el-tag v-else-if="groupSearchResult.hasPendingJoinRequest" size="small" type="warning">
                  申请待处理
                </el-tag>
              </div>
              <div class="search-result-meta">群聊 ID：{{ groupSearchResult.id }}</div>
              <div class="search-result-meta">成员数：{{ groupSearchResult.memberCount }}</div>
            </div>
          </div>
        </div>

        <el-input v-model="groupJoinRequestMessage" type="textarea" :rows="4" maxlength="255" show-word-limit
          placeholder="申请附言（可选）" :disabled="groupJoinSubmitting || !canSubmitGroupJoin" />
        <p class="group-join-tip">搜索到群聊后可提交申请，等待群主或管理员审核。</p>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button :disabled="groupJoinSubmitting" @click="resetGroupJoinDialog">
            取消
          </el-button>
          <el-button type="primary" :loading="groupJoinSubmitting" :disabled="!canSubmitGroupJoin"
            @click="handleSubmitGroupJoin">
            提交申请
          </el-button>
        </div>
      </template>
    </ChatDialog>
  </div>

    <!-- 主题色设置 -->
    <ThemeColorDialog v-model="themeColorDialogVisible" />
</template>

<style scoped lang="scss">
.create-box-item {
  // 用创建区的实际宽度决定「回到主页」收不收起文字，
  // 不能只看视口：平板档侧栏是 30% 宽，比手机档的整屏还窄。
  container-type: inline-size;
}

.create-box-back {
  flex-shrink: 0;
  padding: 0 10px;
}

@container (max-width: 240px) {
  .create-box-back-text {
    display: none;
  }

  // 收起文字后压成与控件同高的圆形按钮，给「会话列表」标题留足宽度
  .create-box-back {
    width: var(--chat-control-h);
    padding: 0;
    border-radius: 50%;
  }

  .create-box-back :deep(.el-icon) {
    margin-right: 0;
  }
}

.social-dropdown-trigger {
  display: inline-flex;
  align-items: center;
}

.social-dropdown-item {
  min-width: 112px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.social-dropdown-status {
  max-width: 220px;
  display: grid;
  gap: 2px;
  white-space: normal;
}

.social-dropdown-status-label {
  color: var(--chat-muted-light);
  font-size: 11px;
  line-height: 16px;
}

.social-dropdown-status-text {
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
  word-break: break-word;
}

.friend-search-panel {
  display: grid;
  gap: 14px;
}

.search-toolbar {
  display: flex;
}

.search-tip {
  margin: 0;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
}

.search-result-row {
  display: grid;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--chat-border);
}

.search-result-row:last-child {
  border-bottom: none;
}

.search-result-main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.search-result-avatar {
  flex-shrink: 0;
}

.search-result-avatar-link {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;

  &:hover {
    transform: translateY(-1px);
    box-shadow: var(--chat-hover-shadow);
  }

  &:focus-visible {
    outline: 2px solid var(--chat-accent);
    outline-offset: 2px;
  }
}

.search-result-text {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.search-result-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.search-result-meta {
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
  word-break: break-all;
}

:deep(.match-highlight) {
  color: var(--chat-danger-text);
  background: var(--chat-danger-soft);
  border-radius: 4px;
  padding: 0 2px;
}

.search-result-ops {
  display: flex;
  justify-content: flex-end;
}

.group-search-card {
  padding: 14px 16px;
  border: 1px solid var(--chat-border-strong);
  border-radius: 12px;
  background: var(--chat-field);
}

.social-dropdown-count {
  min-width: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--chat-inset);
  color: var(--chat-muted);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.friend-list-panel {
  display: grid;
  gap: 12px;
}

.friend-list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.friend-list-count,
.friend-list-tip,
.create-group-tip {
  margin: 0;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
}

.friend-list-row {
  box-sizing: border-box;
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 8px;
  border: none;
  border-bottom: 1px solid var(--chat-divider);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 160ms ease;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--chat-accent-soft);
  }

  &:focus-visible {
    outline: 2px solid var(--chat-accent);
    outline-offset: -2px;
  }
}

.friend-list-text {
  min-width: 0;
  display: grid;
  gap: 4px;

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
}

.friend-list-meta {
  overflow: hidden;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.friend-list-action {
  flex-shrink: 0;
  color: var(--chat-accent);
  font-size: 12px;
}

.blacklist-panel {
  display: grid;
  gap: 12px;
}

.blacklist-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.blacklist-count,
.blacklist-tip {
  margin: 0;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
}

.blacklist-tip {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--chat-field);
}

.blacklist-row {
  box-sizing: border-box;
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 8px;
  border-bottom: 1px solid var(--chat-divider);

  &:last-child {
    border-bottom: none;
  }
}

.blacklist-avatar {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;

  &:hover {
    transform: translateY(-1px);
    box-shadow: var(--chat-hover-shadow);
  }

  &:focus-visible {
    outline: 2px solid var(--chat-accent);
    outline-offset: 2px;
  }
}

.blacklist-text {
  min-width: 0;
  display: grid;
  gap: 3px;

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
}

.blacklist-meta {
  overflow: hidden;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.create-group-panel {
  display: grid;
  gap: 14px;
}

.member-select {
  width: 100%;
  min-width: 0;
}

.member-select-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.friend-request-panel {
  display: grid;
  gap: 12px;
}

.friend-request-toolbar {
  display: flex;
  justify-content: flex-end;
}

.friend-request-row {
  display: grid;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--chat-border);
}

.friend-request-row:last-child {
  border-bottom: none;
}

.friend-request-main {
  display: grid;
  gap: 6px;
}

.friend-request-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.friend-request-Subject {
  display: flex;
  align-items: center;
  gap: 8px;
}

// 好友申请里的对方头像可点击进入主页。
.friend-request-avatar {
  flex-shrink: 0;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;

  &:hover {
    transform: translateY(-1px);
    box-shadow: var(--chat-hover-shadow);
  }

  &:focus-visible {
    outline: 2px solid var(--chat-accent);
    outline-offset: 2px;
  }
}

.friend-request-text {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  height: 100%;
  gap: 4px;
}

.friend-request-meta {
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
}

.friend-request-ops {
  display: flex;
  gap: 8px;
}

.group-join-panel {
  display: grid;
  gap: 14px;
}

.group-join-tip {
  margin: 0;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
