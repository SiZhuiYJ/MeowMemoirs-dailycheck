import http from "@/libs/http";
import type {
  MessageDeltaResponse,
  MessageReadStatus,
  MessageSummary,
  SendMessagePayload,
} from "../types";

export async function getMessages(
  id: number,
  beforeMessageId?: number,
  pageSize = 20,
) {
  return await http.get<MessageSummary[]>(
    `/mm/chat/conversations/${id}/messages`,
    { beforeMessageId, pageSize },
  );
}

export async function getMessageDelta(
  id: number,
  afterMessageId?: number,
  pageSize = 20,
) {
  return await http.get<MessageDeltaResponse>(
    `/mm/chat/conversations/${id}/messages/delta`,
    { afterMessageId, pageSize },
  );
}

export async function sendMessage(id: number, payload: SendMessagePayload) {
  return await http.post<MessageSummary>(`/mm/chat/conversations/${id}/messages`, payload);
}

export async function recallMessage(messageId: number) {
  return await http.post<MessageSummary>(`/mm/chat/messages/${messageId}/recall`);
}

export async function markRead(id: number, lastReadMessageId?: number) {
  return await http.post<{ lastReadMessageId?: number }>(
    `/mm/chat/conversations/${id}/read`,
    {
      lastReadMessageId,
    },
  );
}

export async function getMessageReadStatus(messageId: number) {
  return await http.get<MessageReadStatus>(`/mm/chat/messages/${messageId}/read-status`);
}
