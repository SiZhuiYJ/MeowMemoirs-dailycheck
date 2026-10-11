// composables/useMessageRead.ts
import { ref } from "vue";
import {
  getConversationReadStatus as getConversationReadStatusApi,
  getMessageReadStatus as getMessageReadStatusApi,
  markRead as markReadApi,
} from "../api/messages";
import type { MessageReadStatus, MessageSummary } from "../types";

/** 已读回执合并窗口：一次推送往往带多条，合并成一个请求。 */
const READ_STATUS_FLUSH_MS = 120;

export function useMessageRead(
  conversationId: () => number,
  meUserId: () => number | undefined,
) {
  const messageReadStatus = ref<Map<number, MessageReadStatus>>(new Map());

  /** 已成功上报过的最大已读消息 id，避免每个轮询周期重复上报。 */
  let lastReportedReadId = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingMessageIds = new Set<number>();

  function applyStatuses(statuses: MessageReadStatus[]) {
    if (statuses.length === 0) return;
    const next = new Map(messageReadStatus.value);
    for (const status of statuses) {
      if (status && typeof status.messageId === "number") {
        next.set(status.messageId, status);
      }
    }
    messageReadStatus.value = next;
  }

  async function loadMessageReadStatus(messageId: number) {
    if (!messageId || messageId <= 0) return;
    try {
      const status = (await getMessageReadStatusApi(messageId)).data;
      if (status) applyStatuses([status]);
    } catch {
      // 已读状态属于弱一致性信息，失败静默
    }
  }

  /**
   * 批量获取已读状态。
   * 旧实现是 messageIds.map(loadMessageReadStatus) —— 50 条消息就是 50 个并发请求，
   * 既打爆并发队列又拖慢发送，这里改为一次请求拿回整段状态。
   */
  async function loadBatchMessageReadStatus(messageIds?: number[]) {
    const convId = conversationId();
    if (!convId) return;

    const ids = (messageIds ?? []).filter((id) => Number.isFinite(id) && id > 0);
    if (messageIds && ids.length === 0) return;

    try {
      const statuses = (await getConversationReadStatusApi(
        convId,
        ids.length > 0 ? ids : undefined,
      )).data;
      applyStatuses(statuses ?? []);
    } catch {
      // 静默失败：不阻塞消息展示
    }
  }

  /** 合并短时间内的多条已读回执，尽量只发一个请求。 */
  function queueReadStatusRefresh(messageId: number) {
    if (!messageId || messageId <= 0) return;
    pendingMessageIds.add(messageId);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const ids = Array.from(pendingMessageIds);
      pendingMessageIds.clear();
      void loadBatchMessageReadStatus(ids);
    }, READ_STATUS_FLUSH_MS);
  }

  /**
   * 上报已读位置。
   * 只有当已读位置真的前进了才发请求：旧实现每个轮询 tick 都会 POST 一次，
   * 导致「标记已读」请求持续挤占并发队列。
   */
  async function markRead(lastMessageId?: number) {
    const convId = conversationId();
    if (!convId) return null;

    const targetId = lastMessageId ?? 0;
    if (!targetId || targetId <= lastReportedReadId) return null;

    try {
      const response = await markReadApi(convId, targetId);
      lastReportedReadId = response.data?.lastReadMessageId ?? targetId;
      return response.data;
    } catch {
      // 失败不弹错：下一次进入会话或收到新消息时会重试
      return null;
    }
  }

  /** 获取某条消息的已读显示文本（用于 MessageItem） */
  function getReadInfo(message: MessageSummary) {
    const userId = meUserId();
    if (!userId || message.senderUserId !== userId) {
      return { readText: "", readColor: "" };
    }
    const status = messageReadStatus.value.get(message.id);
    if (!status) return { readText: "", readColor: "#909399" };

    const readCount = status.readCount;
    const total = status.totalRecipients;
    if (total <= 0) return { readText: "", readColor: "#909399" };
    const isAllRead = readCount >= total;

    return {
      readText: `${readCount}/${total} 已读`,
      readColor: isAllRead ? "#67C23A" : "#909399",
    };
  }

  function clearReadStatus() {
    messageReadStatus.value = new Map();
    lastReportedReadId = 0;
    pendingMessageIds.clear();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  return {
    messageReadStatus,
    loadMessageReadStatus,
    loadBatchMessageReadStatus,
    queueReadStatusRefresh,
    markRead,
    getReadInfo,
    clearReadStatus,
  };
}
