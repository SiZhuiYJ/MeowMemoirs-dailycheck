import http from "@/libs/http";
import type { HttpRequestConfig } from "@/libs/http/type";
import type {
  ConversationDetail,
  ConversationSummary,
  CreateGroupJoinRequestPayload,
  CreateConversationPayload,
  DeleteConversationHistoryResult,
  GroupSearchResult,
  GroupJoinRequest,
  InviteConversationMembersPayload,
  MuteConversationMemberPayload,
  RejectGroupJoinRequestPayload,
  UpdateConversation,
  UpdateConversationMemberRolePayload,
  UpdateConversationPreferences,
} from "../types";

export async function getConversations(config: HttpRequestConfig = {}) {
  return await http.get<ConversationSummary[]>("/mm/chat/conversations", undefined, config);
}

export async function getConversation(id: number, config: HttpRequestConfig = {}) {
  return await http.get<ConversationDetail>(`/mm/chat/conversations/${id}`, undefined, config);
}

export async function createConversation(payload: CreateConversationPayload) {
  return await http.post<ConversationDetail>("/mm/chat/conversations", payload);
}

export async function updateConversation(id: number, payload: UpdateConversation) {
  return await http.post<ConversationDetail>(`/mm/chat/conversations/${id}`, payload);
}

/**
 * 只更新当前用户的个人设置（置顶 / 免打扰）。
 *
 * 复用 UpdateConversation 接口：不传 title/avatar/isActive，
 * 服务端就只会改动成员自己的 is_pinned / is_muted，不会误判成修改群资料。
 */
export async function updateConversationPreferences(
  id: number,
  payload: UpdateConversationPreferences,
) {
  return await http.post<ConversationDetail>(
    `/mm/chat/conversations/${id}`,
    payload,
    { priority: true },
  );
}

/**
 * 删除会话聊天记录（仅自己不可见）。
 * 服务端只在当前用户的成员记录上打标记，不物理删除会话或消息。
 */
export async function deleteConversationHistory(conversationId: number) {
  return await http.post<DeleteConversationHistoryResult>(
    `/mm/chat/conversations/${conversationId}/delete`,
    undefined,
    { priority: true, allowDuplicate: true },
  );
}

export async function updateConversationMemberRole(
  conversationId: number,
  memberUserId: number,
  payload: UpdateConversationMemberRolePayload,
) {
  return await http.post<ConversationDetail>(
    `/mm/chat/conversations/${conversationId}/members/${memberUserId}/role`,
    payload,
  );
}

export async function inviteConversationMembers(
  conversationId: number,
  payload: InviteConversationMembersPayload,
) {
  return await http.post<ConversationDetail>(
    `/mm/chat/conversations/${conversationId}/members/invite`,
    payload,
  );
}

export async function createGroupJoinRequest(
  conversationId: number,
  payload?: CreateGroupJoinRequestPayload,
) {
  return await http.post<GroupJoinRequest>(
    `/mm/chat/conversations/${conversationId}/join-requests`,
    payload ?? {},
  );
}

export async function searchGroupConversation(conversationId: number) {
  return await http.get<GroupSearchResult | null>("/mm/chat/conversations/search", {
    params: { conversationId },
  });
}

export async function getConversationJoinRequests(
  conversationId: number,
  status = "pending",
) {
  return await http.get<GroupJoinRequest[]>(
    `/mm/chat/conversations/${conversationId}/join-requests`,
    {
      params: { status },
    },
  );
}

export async function approveGroupJoinRequest(
  conversationId: number,
  requestId: number,
) {
  return await http.post<ConversationDetail>(
    `/mm/chat/conversations/${conversationId}/join-requests/${requestId}/approve`,
  );
}

export async function rejectGroupJoinRequest(
  conversationId: number,
  requestId: number,
  payload?: RejectGroupJoinRequestPayload,
) {
  return await http.post<ConversationDetail>(
    `/mm/chat/conversations/${conversationId}/join-requests/${requestId}/reject`,
    payload ?? {},
  );
}

export async function kickConversationMember(
  conversationId: number,
  memberUserId: number,
) {
  return await http.post<ConversationDetail>(
    `/mm/chat/conversations/${conversationId}/members/${memberUserId}/kick`,
  );
}

export async function muteConversationMember(
  conversationId: number,
  memberUserId: number,
  payload: MuteConversationMemberPayload,
) {
  return await http.post<ConversationDetail>(
    `/mm/chat/conversations/${conversationId}/members/${memberUserId}/mute`,
    payload,
  );
}

export async function unmuteConversationMember(
  conversationId: number,
  memberUserId: number,
) {
  return await http.post<ConversationDetail>(
    `/mm/chat/conversations/${conversationId}/members/${memberUserId}/unmute`,
  );
}

export async function disbandConversation(conversationId: number) {
  return await http.post<ConversationDetail>(
    `/mm/chat/conversations/${conversationId}/disband`,
  );
}
