import http from "@/libs/http";
import type {
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
