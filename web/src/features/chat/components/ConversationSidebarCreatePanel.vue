<script setup lang="ts">
import { ArrowDown, ChatRound } from "@element-plus/icons-vue";
import { ref } from "vue";
import ProgressiveAvatar from "@/components/ProgressiveAvatar/index.vue";
import { getUserAvatarUrl, getUserAvatarSources } from "@/utils/avatar";
import {
  useConversationCreateForm,
  type ConversationFriendOption,
} from "../composables/useConversationCreateForm";
import {
  useConversationSidebarSocial,
  type SidebarActionCommand,
} from "../composables/useConversationSidebarSocial";

const createTitle = defineModel<string>("createTitle", {
  required: true,
});
const createMemberUserIds = defineModel<number[]>("createMemberUserIds", {
  required: true,
});

const props = defineProps<{
  friendRequestVersion: number;
  friendshipVersion: number;
}>();

const emit = defineEmits<{
  createConversation: [];
}>();

const {
  friendLoading,
  friends,
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
  getFriendLabel,
  getFriendMeta,
  formatFriendRequestTime,
  handleAcceptRequest,
  handleRejectRequest,
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

/** 「好友列表」与「发起群聊」从创建区移入「社交操作」后，由这两个弹窗承载。 */
const friendListDialogVisible = ref(false);
const createGroupDialogVisible = ref(false);

type CreatePanelCommand = SidebarActionCommand | "friendList" | "createGroup";

function openFriendList() {
  friendListDialogVisible.value = true;
  void refreshFriendData(false);
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
    default:
      handleActionCommand(command);
      break;
  }
}
</script>

<template>
  <div class="create-box">
    <div class="create-box-item">
      <h3>会话</h3>
      <el-dropdown placement="bottom-end" trigger="click" @command="handleSocialCommand">
        <span class="social-dropdown-trigger">
          <el-badge :value="pendingFriendRequestCount" :show-zero="false" :max="99" :offset="[-6, 6]">
            <el-button color="#111827">
              社交操作
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
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <Teleport to="body">
      <el-dialog v-model="friendListDialogVisible" title="好友列表" width="min(92vw, 560px)">
        <div v-loading="friendLoading" class="friend-list-panel">
          <div class="friend-list-toolbar">
            <span class="friend-list-count">共 {{ friends.length }} 位好友</span>
            <el-button plain :loading="friendLoading" @click="refreshFriendData(false)">
              刷新
            </el-button>
          </div>

          <el-empty v-if="!friendLoading && friends.length === 0" description="暂无好友，先去添加好友吧" />

          <el-scrollbar v-else max-height="420px">
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
          </el-scrollbar>

          <p class="friend-list-tip">点击好友即可开始单聊；需要拉多人时用「发起群聊」。</p>
        </div>
      </el-dialog>

      <el-dialog v-model="createGroupDialogVisible" title="发起群聊" width="min(92vw, 560px)">
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
            <el-button :icon="ChatRound" color="#111827" :disabled="!isGroupConversation" @click="submitCreateGroup">
              创建群聊
            </el-button>
          </div>
        </template>
      </el-dialog>

      <el-dialog v-model="friendSearchDialogVisible" title="搜索好友" width="min(92vw, 560px)"
        :close-on-click-modal="canCloseFriendSearchDialog" :close-on-press-escape="canCloseFriendSearchDialog"
        :show-close="canCloseFriendSearchDialog" @closed="resetFriendSearchDialog">
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

          <el-scrollbar v-else-if="friendSearchResults.length > 0" max-height="320px">
            <div v-for="item in friendSearchResults" :key="item.userId" class="search-result-row">
              <div class="search-result-main">
                <ProgressiveAvatar class="search-result-avatar" :src="getFriendSearchAvatar(item).src"
                  :thumbnail-src="getFriendSearchAvatar(item).thumbnailSrc" :is-preview="true" :size="60"
                  shape="square">
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
                <el-button size="small" color="#111827" :loading="friendSearchSubmittingId === item.userId"
                  :disabled="item.isFriend || item.hasPendingSentRequest" @click="handleSendFriendRequest(item)">
                  {{ getFriendSearchActionText(item) }}
                </el-button>
              </div>
            </div>
          </el-scrollbar>
        </div>
      </el-dialog>

      <el-dialog v-model="friendRequestDialogVisible" title="好友申请" width="min(92vw, 640px)">
        <div class="friend-request-panel">
          <div class="friend-request-toolbar">
            <el-button plain :loading="friendRequestLoading || friendLoading" @click="refreshFriendData(true)">
              刷新
            </el-button>
          </div>

          <el-empty v-if="!friendRequestLoading && sortedFriendRequests.length === 0" description="暂无好友申请" />

          <el-scrollbar v-else max-height="420px">
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

                  <ProgressiveAvatar class="conversation-avatar"
                    :src="getUserAvatarSources(item.receiver.userId, item.receiver.avatarKey).src"
                    :thumbnail-src="getUserAvatarSources(item.receiver.userId, item.receiver.avatarKey).thumbnailSrc"
                    :is-preview="true" :size="60" shape="square">
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
          </el-scrollbar>
        </div>
      </el-dialog>

      <el-dialog v-model="groupJoinDialogVisible" title="申请加入群聊" width="min(92vw, 520px)"
        :close-on-click-modal="canCloseGroupJoinDialog" :close-on-press-escape="canCloseGroupJoinDialog"
        :show-close="canCloseGroupJoinDialog" @closed="resetGroupJoinDialog">
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
            <el-button color="#111827" :loading="groupJoinSubmitting" :disabled="!canSubmitGroupJoin"
              @click="handleSubmitGroupJoin">
              提交申请
            </el-button>
          </div>
        </template>
      </el-dialog>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
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

.friend-search-panel {
  display: grid;
  gap: 14px;
}

.search-toolbar {
  display: flex;
}

.search-tip {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 18px;
}

.search-result-row {
  display: grid;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid #e5e7eb;
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
  color: #6b7280;
  font-size: 12px;
  line-height: 18px;
  word-break: break-all;
}

:deep(.match-highlight) {
  color: #b91c1c;
  background: #fee2e2;
  border-radius: 4px;
  padding: 0 2px;
}

.search-result-ops {
  display: flex;
  justify-content: flex-end;
}

.group-search-card {
  padding: 14px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #f9fafb;
}

.social-dropdown-count {
  min-width: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #6b7280;
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
  color: #6b7280;
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
  border-bottom: 1px solid #f3f4f6;
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
    background: #f9fafb;
  }

  &:focus-visible {
    outline: 2px solid #93c5fd;
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
  color: #6b7280;
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.friend-list-action {
  flex-shrink: 0;
  color: #2563eb;
  font-size: 12px;
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
  border-bottom: 1px solid #e5e7eb;
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

.friend-request-text {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  height: 100%;
  gap: 4px;
}

.friend-request-meta {
  color: #6b7280;
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
  color: #6b7280;
  font-size: 12px;
  line-height: 18px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
