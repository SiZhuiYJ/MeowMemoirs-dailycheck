// composables/useMessages.ts
import { ref } from "vue";
import { useAuthStore } from "@/stores";
import {
  getMessageDelta as getMessageDeltaApi,
  getMessages as getMessagesApi,
  recallMessage as recallMessageApi,
  sendMessage as sendMessageApi,
} from "../api/messages";
import { useErrorHandler } from "./useErrorHandler";
import type {
  MessageSummary,
  PendingTextMessage,
  SendMessagePayload,
} from "../types";

/** 乐观消息与真实消息的兜底匹配窗口（服务端 HTTP 回包丢失时用）。 */
const OPTIMISTIC_MATCH_WINDOW_MS = 2 * 60 * 1000;

export function useMessages(conversationId: () => number) {
  const messages = ref<MessageSummary[]>([]);
  /** 首屏/切换会话时的阻塞式加载（会显示骨架）。 */
  const loading = ref(false);
  /** 翻页加载更早的历史消息。 */
  const loadingMore = ref(false);
  /** 发送中（不阻塞列表交互）。 */
  const sending = ref(false);
  /** 本地乐观发送的文本消息。 */
  const pendingTextMessages = ref<PendingTextMessage[]>([]);
  const { setError, clearError } = useErrorHandler();

  let tempIdSeed = 0;
  function nextTempId() {
    tempIdSeed -= 1;
    return tempIdSeed;
  }

  // 消息去重合并工具
  function mergeMessages(
    current: MessageSummary[],
    incoming: MessageSummary[],
    mode: "append" | "prepend" = "append",
  ) {
    if (incoming.length === 0) return current;
    const merged =
      mode === "prepend"
        ? [...incoming, ...current]
        : [...current, ...incoming];
    const deduped = new Map<number, MessageSummary>();
    for (const msg of merged) {
      deduped.set(msg.id, msg);
    }
    return Array.from(deduped.values()).sort((a, b) => a.id - b.id);
  }

  function removePendingText(tempId: number) {
    const index = pendingTextMessages.value.findIndex((item) => item.tempId === tempId);
    if (index === -1) return null;
    const [removed] = pendingTextMessages.value.splice(index, 1);
    return removed ?? null;
  }

  /**
   * 服务端消息到达时，清掉对应的本地乐观消息。
   * 正常情况下由 sendMessage 的回包精确清理；这里处理
   * 「SignalR 推送先于 HTTP 回包到达」和「回包丢失」两种情况。
   */
  function dropMatchingPendingText(message: MessageSummary) {
    if (pendingTextMessages.value.length === 0) return;
    if (message.messageType !== "text") return;

    const index = pendingTextMessages.value.findIndex((pending) => {
      if (pending.senderUserId !== message.senderUserId) return false;
      if (pending.content !== (message.content ?? "")) return false;
      if ((pending.replyToMessageId ?? null) !== (message.replyToMessageId ?? null)) return false;
      const pendingTime = Date.parse(pending.createdAt) || 0;
      const serverTime = Date.parse(message.createdAt) || 0;
      if (Number.isNaN(serverTime) || pendingTime === 0) return true;
      return Math.abs(serverTime - pendingTime) <= OPTIMISTIC_MATCH_WINDOW_MS;
    });

    if (index >= 0) {
      pendingTextMessages.value.splice(index, 1);
    }
  }

  function upsertMessage(message: MessageSummary) {
    dropMatchingPendingText(message);
    messages.value = mergeMessages(messages.value, [message]);
  }

  function upsertMessages(incoming: MessageSummary[]) {
    if (incoming.length === 0) return;
    for (const message of incoming) {
      dropMatchingPendingText(message);
    }
    messages.value = mergeMessages(messages.value, incoming);
  }

  async function loadMessages(beforeId?: number, limit = 50, options?: { silent?: boolean }) {
    const convId = conversationId();
    if (!convId) return;
    const silent = options?.silent === true;
    if (!silent) {
      loading.value = true;
      clearError();
    }
    try {
      const data = (await getMessagesApi(convId, beforeId, limit, { showError: !silent })).data;
      if (!beforeId) {
        messages.value = [...data].sort((a, b) => a.id - b.id);
      }
      return data;
    } catch (error: any) {
      if (!silent) setError(error, "加载消息失败");
      return undefined;
    } finally {
      if (!silent) loading.value = false;
    }
  }

  /**
   * 加载更早的历史消息。
   * 返回本次新增条数，供列表做滚动位置锚定（避免刷新后跳到最新处）。
   */
  async function loadMore() {
    const convId = conversationId();
    if (!convId || messages.value.length === 0 || loadingMore.value) return 0;

    const firstId = messages.value[0]?.id;
    if (!firstId) return 0;

    loadingMore.value = true;
    try {
      const older = await loadMessages(firstId, 20, { silent: true });
      if (!older || older.length === 0) return 0;
      const before = messages.value.length;
      messages.value = mergeMessages(messages.value, older, "prepend");
      return messages.value.length - before;
    } finally {
      loadingMore.value = false;
    }
  }

  /**
   * 增量拉取新消息（替代旧的 refreshLoadedMessages）。
   * 旧实现会按「已加载条数」重新分页拉取全部消息，10 条历史就是 10 个请求，
   * 且整段替换数组导致列表重排、滚动位置丢失。
   */
  async function syncLatest(options?: { pageSize?: number }) {
    const convId = conversationId();
    if (!convId) return 0;

    // 会话已打开但消息还没加载（首次进入的空列表）：直接拉首屏
    if (messages.value.length === 0) {
      const initial = await loadMessages(undefined, 50, { silent: true });
      return initial?.length ?? 0;
    }

    const lastMsg = messages.value[messages.value.length - 1];
    const lastId = lastMsg?.id;
    if (!lastId) return 0;

    try {
      const delta = (await getMessageDeltaApi(convId, lastId, options?.pageSize ?? 50, {
        showError: false,
      })).data;
      const newMessages = (delta?.messages ?? [])
        .filter((m) => m.id > lastId)
        .sort((a, b) => a.id - b.id);
      if (newMessages.length === 0) return 0;
      upsertMessages(newMessages);
      return newMessages.length;
    } catch {
      // 增量同步失败保持静默，由推送状态栏统一提示
      return 0;
    }
  }

  /** 兼容旧调用点：无历史时加载首屏，否则做增量同步。 */
  async function refreshLoadedMessages() {
    const convId = conversationId();
    if (!convId) return;
    if (messages.value.length === 0) {
      await loadMessages(undefined, 50, { silent: true });
      return;
    }
    await syncLatest();
  }

  /**
   * 发送消息（乐观更新）。
   * 立即插入本地消息并返回，服务端确认后替换为真实消息；
   * 失败时保留本地消息并标记 failed，用户可重试，不会丢内容。
   */
  async function sendMessage(payload: SendMessagePayload) {
    const convId = conversationId();
    if (!convId) return null;

    const auth = useAuthStore();
    const isText = (payload.messageType ?? "text") === "text";
    let tempId = 0;

    if (isText) {
      tempId = nextTempId();
      pendingTextMessages.value = [
        ...pendingTextMessages.value,
        {
          tempId,
          senderUserId: auth.user?.userId ?? 0,
          senderNickName: auth.user?.nickName ?? auth.user?.userAccount ?? null,
          messageType: "text",
          content: payload.content ?? "",
          createdAt: new Date().toISOString(),
          replyToMessageId: payload.replyToMessageId ?? null,
          replyToMessage: null,
          status: "sending",
        },
      ];
    }

    sending.value = true;
    try {
      const result = await sendMessageApi(convId, payload);
      if (isText && tempId) removePendingText(tempId);
      if (result.data) {
        upsertMessage(result.data);
      }
      return result.data;
    } catch (error: any) {
      if (isText && tempId) {
        const target = pendingTextMessages.value.find((item) => item.tempId === tempId);
        if (target) {
          target.status = "failed";
          target.errorText = error?.message || "发送失败";
        }
      } else {
        setError(error, "发送消息失败");
        return null;
      }
      return null;
    } finally {
      sending.value = false;
    }
  }

  /** 重试发送失败的本地消息。 */
  async function retrySendMessage(tempId: number) {
    const target = pendingTextMessages.value.find((item) => item.tempId === tempId);
    if (!target || target.status !== "failed") return;

    target.status = "sending";
    target.errorText = undefined;
    target.createdAt = new Date().toISOString();

    const payload: SendMessagePayload = {
      messageType: target.messageType,
      content: target.content,
      replyToMessageId: target.replyToMessageId ?? null,
    };

    const convId = conversationId();
    if (!convId) return;

    sending.value = true;
    try {
      const result = await sendMessageApi(convId, payload);
      removePendingText(tempId);
      if (result.data) upsertMessage(result.data);
    } catch (error: any) {
      target.status = "failed";
      target.errorText = error?.message || "发送失败";
    } finally {
      sending.value = false;
    }
  }

  /** 放弃一条发送失败的本地消息。 */
  function discardPendingTextMessage(tempId: number) {
    removePendingText(tempId);
  }

  async function recallMessage(messageId: number) {
    clearError();
    try {
      const result = await recallMessageApi(messageId);
      if (result.data) {
        upsertMessage(result.data);
      }
      return result.data;
    } catch (error: any) {
      setError(error, "撤回消息失败");
      return null;
    }
  }

  // 清空消息（切换会话时调用）
  function resetMessages() {
    messages.value = [];
    pendingTextMessages.value = [];
  }

  return {
    messages,
    pendingTextMessages,
    loading,
    loadingMore,
    sending,
    loadMessages,
    loadMore,
    syncLatest,
    pullLatestMessages: syncLatest,
    refreshLoadedMessages,
    sendMessage,
    retrySendMessage,
    discardPendingTextMessage,
    recallMessage,
    upsertMessage,
    upsertMessages,
    resetMessages,
  };
}
