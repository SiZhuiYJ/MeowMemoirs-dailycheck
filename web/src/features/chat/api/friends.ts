import http from "@/libs/http";
import type {
  BlockedUser,
  CreateFriendRequestPayload,
  FriendSearchResult,
  FriendRequest,
  Friendship,
  RejectFriendRequestPayload,
  UpdateFriendRemarkPayload,
} from "../types";

export async function getFriends() {
  return await http.get<Friendship[]>("/mm/friends");
}

export async function getFriendRequests(status?: string) {
  return await http.get<FriendRequest[]>("/mm/friends/requests", {
    params: status ? { status } : undefined,
  });
}

export async function searchFriendUsers(keyword: string) {
  return await http.get<FriendSearchResult[]>("/mm/friends/search", {
    params: { keyword },
  });
}

export async function createFriendRequest(payload: CreateFriendRequestPayload) {
  return await http.post<FriendRequest>("/mm/friends/requests", payload);
}

export async function acceptFriendRequest(requestId: number) {
  return await http.post<FriendRequest>(`/mm/friends/requests/${requestId}/accept`);
}

export async function rejectFriendRequest(
  requestId: number,
  payload?: RejectFriendRequestPayload,
) {
  return await http.post<FriendRequest>(
    `/mm/friends/requests/${requestId}/reject`,
    payload ?? {},
  );
}

export async function updateFriendRemark(
  friendUserId: number,
  payload?: UpdateFriendRemarkPayload,
) {
  return await http.post<Friendship>(
    `/mm/friends/${friendUserId}/remark`,
    payload ?? {},
  );
}

export async function deleteFriend(friendUserId: number) {
  return await http.delete(`/mm/friends/${friendUserId}`);
}

/** 获取当前用户的黑名单（我拉黑的用户）。 */
export async function getBlockedUsers() {
  return await http.get<BlockedUser[]>("/mm/friends/blacklist");
}

/** 拉黑指定用户；重复拉黑是幂等的。 */
export async function blockUser(userId: number) {
  return await http.post<BlockedUser>("/mm/friends/blacklist", { userId });
}

/** 解除对指定用户的拉黑。 */
export async function unblockUser(userId: number) {
  return await http.delete(`/mm/friends/blacklist/${userId}`);
}
