// types/index.ts
export type ConversationType = "direct" | "group";
export type MessageType = "text" | "image" | "video" | "audio" | "file" | "system";
export type UserRole = "owner" | "admin" | "member";
export type PendingUploadStatus = "uploading" | "failed";

export interface MessageReference {
  id: number;
  senderUserId: number;
  senderNickName?: string | null;
  messageType: MessageType;
  content?: string | null;
  extra?: string | null;
  isRecalled: boolean;
  /** 执行撤回的用户ID（群主/管理员撤回他人消息时为操作人）。 */
  recalledByUserId?: number | null;
  /**
   * 管理撤回提示。
   * 仅群主/管理员撤回他人消息时有值，展示在消息原来的位置，
   * 没有值时回退到「xxx 撤回了一条消息」。
   */
  recallPrompt?: string | null;
  createdAt: string;
}

export interface MessageSummary extends MessageReference {
  replyToMessageId?: number | null;
  replyToMessage?: MessageReference | null;
}

/** 本地乐观发送状态。 */
export type ClientSendStatus = "sending" | "failed";

/**
 * 乐观发送的本地消息（文本）。
 * tempId 为负数，服务端确认后用真实消息替换。
 */
export interface PendingTextMessage {
  tempId: number;
  senderUserId: number;
  senderNickName?: string | null;
  messageType: Extract<MessageType, "text">;
  content: string;
  createdAt: string;
  replyToMessageId?: number | null;
  replyToMessage?: MessageReference | null;
  status: ClientSendStatus;
  errorText?: string;
}

export interface FileExtra {
  fileName: string;
  fileSize: number;
  fileUrl: string;
  fileKey?: string;
  thumbnailUrl?: string;
  duration?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  localPreviewUrl?: string;
  localThumbnailUrl?: string;
}

export interface PendingUpload {
  tempId: string;
  senderUserId: number;
  senderNickName?: string | null;
  messageType: Extract<MessageType, "image" | "video" | "audio" | "file">;
  createdAt: string;
  replyToMessageId?: number | null;
  replyToMessage?: MessageReference | null;
  status: PendingUploadStatus;
  progress: number;
  /**
   * 上传回包里的 fileKey（上传成功后才有）。
   *
   * 它让「待发气泡」与「真实消息」的对应关系变成**精确匹配**：服务端把 extra 原样回显，
   * 而图片在上传前会被前端转成 webp（文件名从 *.png 变成 *.webp）、服务端入库时还会把
   * 原始文件名去掉后缀 —— 靠文件名/字节数去猜根本对不上，靠 fileKey 才唯一。
   */
  uploadedFileKey?: string | null;
  /**
   * 上传开始时「已加载消息里的最大 id」。
   *
   * 只有**比它新**的消息才可能是这条待发改成的真实消息。不设这道门槛的话，
   * 同一张图连发两次（fileKey 相同）时，上一次的老消息会被当成结果，
   * 待发气泡在发送途中就被提前收掉。
   */
  baselineMessageId: number;
  fileExtra: FileExtra;
}

export interface ConversationSummary {
  id: number;
  conversationType: ConversationType;
  title?: string | null;
  userAccount?: string | null;
  avatarKey?: string | null;
  avatarUserId?: number | null;
  isActive: boolean;
  isPinned: boolean;
  isMuted: boolean;
  updatedAt: string;
  unreadCount: number;
  lastMessage?: MessageSummary | null;
}

export interface ConversationMember {
  userId: number;
  nickName?: string | null;
  userAccount?: string | null;
  avatarKey?: string | null;
  memberRole: UserRole;
  joinedAt: string;
  lastReadMessageId?: number | null;
  isMuted?: boolean;
  mutedUntil?: string | null;
  mutedMode?: GroupMuteMode | null;
}

export interface ConversationDetail {
  id: number;
  conversationType: ConversationType;
  title?: string | null;
  avatarKey?: string | null;
  avatarUserId?: number | null;
  isActive: boolean;
  isPinned: boolean;
  isMuted: boolean;
  ownerUserId?: number | null;
  createdAt: string;
  updatedAt: string;
  pendingJoinRequestCount: number;
  friendRemark?: string | null;
  isFriend: boolean;
  members: ConversationMember[];
}

export interface CreateConversationPayload {
  conversationType: ConversationType;
  title?: string;
  avatarKey?: string;
  memberUserIds: number[];
}

export interface SendMessagePayload {
  messageType: MessageType;
  content?: string;
  extra?: FileExtra;
  replyToMessageId?: number | null;
}

export interface MessageDeltaResponse {
  hasMore: boolean;
  lastMessageId: number;
  messages: MessageSummary[];
}

export interface UpdateConversation {
  title?: string | null;
  avatarKey?: string | null;
  isActive: boolean;
  isPinned: boolean;
  isMuted: boolean;
}

/** 会话列表右键菜单里的「置顶 / 免打扰」只提交变化的字段。 */
export interface UpdateConversationPreferences {
  isPinned?: boolean;
  isMuted?: boolean;
}

/** 消息「仅自己不可见」伪删除结果。 */
export interface DeleteMessageResult {
  messageId: number;
  conversationId: number;
  hidden: boolean;
}

/** 删除会话聊天记录（仅自己）结果。 */
export interface DeleteConversationHistoryResult {
  conversationId: number;
  clearedBeforeMessageId: number;
  hidden: boolean;
}

/** 用户主页信息（聊天页「查看主页」使用）。 */
export interface UserProfile {
  userId: number;
  userAccount?: string | null;
  nickName?: string | null;
  avatarKey?: string | null;
  createdAt: string;
  isSelf: boolean;
  isFriend: boolean;
  /** 当前用户是否已把该用户拉黑。 */
  isBlocked: boolean;
  /** 该用户是否已把当前用户拉黑（仍可查看主页，但不能互动）。 */
  isBlockedByTarget: boolean;
  friendRemark?: string | null;
  directConversationId?: number | null;
  /** 当前用户是否已向该用户发送待处理的好友申请。 */
  hasPendingSentRequest: boolean;
  /** 该用户是否已向当前用户发送待处理的好友申请。 */
  hasPendingReceivedRequest: boolean;
  status: "active" | "frozen";
}

export interface UpdateConversationMemberRolePayload {
  memberRole: Extract<UserRole, "admin" | "member">;
}

export type GroupMuteMode = "temporary" | "permanent";

export interface InviteConversationMembersPayload {
  memberUserIds: number[];
}

export type GroupJoinRequestStatus = "pending" | "approved" | "rejected" | "expired";

export interface GroupJoinRequest {
  id: number;
  conversationId: number;
  requesterUserId: number;
  requestMessage?: string | null;
  requestStatus: GroupJoinRequestStatus;
  handledByUserId?: number | null;
  handledAt?: string | null;
  rejectReason?: string | null;
  expireAt?: string | null;
  createdAt: string;
  updatedAt: string;
  requester: FriendUser;
}

export interface GroupSearchResult {
  id: number;
  conversationType: "group";
  title?: string | null;
  avatarKey?: string | null;
  ownerUserId?: number | null;
  memberCount: number;
  isMember: boolean;
  hasPendingJoinRequest: boolean;
}

export interface CreateGroupJoinRequestPayload {
  requestMessage?: string;
}

export interface RejectGroupJoinRequestPayload {
  rejectReason?: string;
}

export interface MuteConversationMemberPayload {
  mode: GroupMuteMode;
  durationMinutes?: number;
  reason?: string;
}

export interface ConversationDetailUpdateOptions {
  persist?: boolean;
  clearCurrent?: boolean;
}

export type FriendRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "expired";

export type FriendRequestSource = "account" | "group" | "search" | "system";
export type FriendRequestDirection = "sent" | "received";

export interface FriendUser {
  userId: number;
  userAccount?: string | null;
  nickName?: string | null;
  avatarKey?: string | null;
}

export interface FriendSearchResult extends FriendUser {
  isFriend: boolean;
  hasPendingSentRequest: boolean;
  hasPendingReceivedRequest: boolean;
}

export interface Friendship {
  id: number;
  avatarKey?: string;
  status: "active" | "deleted";
  friendRemark?: string | null;
  isStarred: boolean;
  isMuted: boolean;
  acceptedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  friend: FriendUser;
}

/** 黑名单中的用户（当前用户拉黑的用户）。 */
export interface BlockedUser extends FriendUser {
  /** 拉黑记录 ID。 */
  id: number;
  /** 拉黑时间。 */
  createdAt: string;
}

export interface FriendRequest {
  id: number;
  requesterUserId: number;
  receiverUserId: number;
  sourceConversationId?: number | null;
  requestMessage?: string | null;
  requestSource: FriendRequestSource;
  requestStatus: FriendRequestStatus;
  direction: FriendRequestDirection;
  handledByUserId?: number | null;
  handledAt?: string | null;
  rejectReason?: string | null;
  expireAt?: string | null;
  createdAt: string;
  updatedAt: string;
  requester: FriendUser;
  receiver: FriendUser;
}

export interface CreateFriendRequestPayload {
  receiverUserId?: number;
  receiverUserAccount?: string;
  requestMessage?: string;
  sourceConversationId?: number | null;
  requestSource?: FriendRequestSource;
}

export interface RejectFriendRequestPayload {
  rejectReason?: string;
}

export interface UpdateFriendRemarkPayload {
  friendRemark?: string | null;
}

export interface ReadUser {
  userId: number;
  nickName: string;
  avatarKey?: string | null;
  readAt: string;
}

export interface MessageReadStatus {
  messageId: number;
  totalRecipients: number;
  readCount: number;
  readUsers: ReadUser[];
}
