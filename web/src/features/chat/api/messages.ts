import http from "@/libs/http";
import type { HttpRequestConfig } from "@/libs/http/type";
import type {
  DeleteMessageResult,
  MessageDeltaResponse,
  MessageReadStatus,
  MessageSummary,
  SendMessagePayload,
} from "../types";

/**
 * 后台同步类请求统一使用 silent，避免轮询/刷新失败时反复弹提示。
 */
const silent: HttpRequestConfig = { showError: false };

export async function getMessages(
  id: number,
  beforeMessageId?: number,
  pageSize = 20,
  config: HttpRequestConfig = {},
) {
  return await http.get<MessageSummary[]>(
    `/mm/chat/conversations/${id}/messages`,
    { beforeMessageId, pageSize },
    config,
  );
}

export async function getMessageDelta(
  id: number,
  afterMessageId?: number,
  pageSize = 20,
  config: HttpRequestConfig = {},
) {
  return await http.get<MessageDeltaResponse>(
    `/mm/chat/conversations/${id}/messages/delta`,
    { afterMessageId, pageSize },
    config,
  );
}

export async function sendMessage(id: number, payload: SendMessagePayload) {
  return await http.post<MessageSummary>(
    `/mm/chat/conversations/${id}/messages`,
    payload,
    // 用户主动发送：插队 + 不与其他请求合并，保证最快拿到响应
    { priority: true, allowDuplicate: true },
  );
}

export async function recallMessage(messageId: number) {
  return await http.post<MessageSummary>(`/mm/chat/messages/${messageId}/recall`, undefined, {
    priority: true,
  });
}

/**
 * 删除一条消息（仅自己不可见，伪删除）。
 * 服务端写入 (messageId, userId) 标记，对方和其它成员不受影响。
 */
export async function deleteMessageForMe(messageId: number) {
  return await http.post<DeleteMessageResult>(
    `/mm/chat/messages/${messageId}/delete`,
    undefined,
    { priority: true, allowDuplicate: true },
  );
}

export async function markRead(id: number, lastReadMessageId?: number) {
  return await http.post<{ lastReadMessageId?: number }>(
    `/mm/chat/conversations/${id}/read`,
    {
      lastReadMessageId,
    },
    { priority: true, ...silent },
  );
}

export async function getMessageReadStatus(messageId: number) {
  return await http.get<MessageReadStatus>(
    `/mm/chat/messages/${messageId}/read-status`,
    undefined,
    silent,
  );
}

/**
 * 批量获取已读状态。
 * 旧实现是「每条消息一个请求」，打开会话时会瞬间发出几十个请求，
 * 既拖慢首屏又挤占并发队列，这里改为一次拿回整个会话的已读状态。
 */
export async function getConversationReadStatus(
  conversationId: number,
  messageIds?: number[],
) {
  return await http.get<MessageReadStatus[]>(
    `/mm/chat/conversations/${conversationId}/read-status`,
    messageIds && messageIds.length > 0 ? { messageIds: messageIds.join(",") } : undefined,
    silent,
  );
}
