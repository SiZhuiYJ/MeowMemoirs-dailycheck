// types/index.ts
export type ConversationType = "direct" | "group";
export type MessageType = "text" | "image" | "video" | "audio" | "file" | "system";
export type UserRole = "owner" | "admin" | "member";
export type PendingUploadStatus = "uploading" | "processing" | "failed";

export interface MessageReference {
  id: number;
  senderUserId: number;
  senderNickName?: string | null;
  messageType: MessageType;
  content?: string | null;
  extra?: string | null;
  isRecalled: boolean;
  createdAt: string;
}

export interface MessageSummary extends MessageReference {
  replyToMessageId?: number | null;
  replyToMessage?: MessageReference | null;
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
  confirmedMessageId?: number | null;
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
