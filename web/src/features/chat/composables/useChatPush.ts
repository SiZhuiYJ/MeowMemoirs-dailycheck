import { computed, onBeforeUnmount, ref } from "vue";
import {
  HubConnectionBuilder,
  HttpTransportType,
  LogLevel,
} from "@microsoft/signalr";
import type { MessageSummary } from "../types";

interface PushOptions {
  fetchConversations: () => Promise<void>;
  syncCurrentMessages: () => Promise<void>;
  markRead: () => Promise<void>;
  hasConversation: () => boolean;
  getConversationId: () => number;
  getToken: () => string;
  getBaseUrl: () => string;
  upsertMessage?: (message: MessageSummary) => Promise<void> | void;
  onMessageRead?: (data: {
    messageId: number;
    conversationId: number;
    readByUserId: number;
    readAt: string;
  }) => Promise<void>;
  onFriendRequestsUpdated?: () => Promise<void> | void;
  onFriendshipsUpdated?: () => Promise<void> | void;
  getAllConversationIds: () => number[];
}

export function useChatPush(options: PushOptions) {
  const polling = ref(false);
  const realtimeConnected = ref(false);
  const lastSyncAt = ref("");
  const syncError = ref("");

  let timer: ReturnType<typeof setInterval> | null = null;
  let connection: any = null;
  let shouldKeepRealtime = false;
  const subscribedConversationIds = new Set<number>();

  const statusText = computed(() => {
    if (syncError.value) return `推送异常：${syncError.value}`;
    if (realtimeConnected.value) return "SignalR 实时连接中";
    if (!polling.value) return "推送已停止";
    if (!lastSyncAt.value) return "轮询连接中...";
    return `轮询推送中（最近同步：${new Date(lastSyncAt.value).toLocaleTimeString()}）`;
  });

  async function tick() {
    try {
      await options.fetchConversations();
      if (options.hasConversation()) {
        await options.syncCurrentMessages();
        await options.markRead();
      }
      lastSyncAt.value = new Date().toISOString();
      syncError.value = "";
    } catch (error: any) {
      const isTimeout = error?.code === "ECONNABORTED";
      const isNetworkError = error?.message === "Network Error" || !error?.response;

      if (isTimeout) {
        syncError.value = "同步超时，正在重试";
        return;
      }

      if (isNetworkError) {
        syncError.value = "无法连接服务端，已切换为重试模式";
        return;
      }

      syncError.value = error?.response?.data?.message || error?.message || "同步失败";
    }
  }

  function startPolling() {
    if (timer) return;
    polling.value = true;
    void tick();
    timer = setInterval(() => {
      void tick();
    }, 5000);
  }

  function stopPolling() {
    polling.value = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function subscribeConversation(conversationId: number) {
    if (!conversationId || !connection || !realtimeConnected.value) return;
    if (subscribedConversationIds.has(conversationId)) return;

    try {
      await connection.invoke("SubscribeConversation", conversationId);
      subscribedConversationIds.add(conversationId);
    } catch (error: any) {
      syncError.value = error?.message || "订阅会话失败";
    }
  }

  async function subscribeAllKnownConversations() {
    const allIds = options.getAllConversationIds();
    for (const id of allIds) {
      await subscribeConversation(id);
    }

    const currentId = options.getConversationId();
    if (currentId) {
      await subscribeConversation(currentId);
    }
  }

  function resetSubscriptions() {
    subscribedConversationIds.clear();
  }

  async function connectRealtime() {
    const token = options.getToken();
    if (!token) throw new Error("缺少登录令牌，无法建立 SignalR 连接");

    const baseUrl = options.getBaseUrl().replace(/\/+$/, "");
    connection = new HubConnectionBuilder()
      .withUrl(`${baseUrl}/hubs/chat`, {
        accessTokenFactory: () => options.getToken(),
        transport: HttpTransportType.WebSockets | HttpTransportType.LongPolling,
      })
      .configureLogging(LogLevel.Warning)
      .withAutomaticReconnect()
      .withKeepAliveInterval(15000)
      .withServerTimeout(45000)
      .build();

    connection.on("chat:message-updated", async (payload: any) => {
      await options.fetchConversations();
      await subscribeAllKnownConversations();

      if (payload?.conversationId === options.getConversationId()) {
        if (payload?.message && options.upsertMessage) {
          await options.upsertMessage(payload.message as MessageSummary);
        } else {
          await options.syncCurrentMessages();
        }
        await options.markRead();
      }
    });

    connection.on("chat:inbox-updated", async () => {
      await options.fetchConversations();
      await subscribeAllKnownConversations();
    });

    connection.on("chat:message-read", async (payload: any) => {
      if (options.onMessageRead) {
        await options.onMessageRead({
          messageId: payload.messageId,
          conversationId: payload.conversationId,
          readByUserId: payload.readByUserId,
          readAt: payload.readAt,
        });
      }
    });

    connection.on("chat:friend-requests-updated", async () => {
      if (options.onFriendRequestsUpdated) {
        await options.onFriendRequestsUpdated();
      }
    });

    connection.on("chat:friendships-updated", async () => {
      if (options.onFriendshipsUpdated) {
        await options.onFriendshipsUpdated();
      }
    });

    connection.onclose(() => {
      realtimeConnected.value = false;
      resetSubscriptions();
      if (!shouldKeepRealtime) return;
      startPolling();
    });

    connection.onreconnecting((error: any) => {
      realtimeConnected.value = false;
      resetSubscriptions();
      syncError.value = error?.message || "SignalR 重连中，已临时启用轮询";
      startPolling();
    });

    connection.onreconnected(async () => {
      try {
        realtimeConnected.value = true;
        resetSubscriptions();
        stopPolling();
        syncError.value = "";
        await options.fetchConversations();
        await subscribeAllKnownConversations();
        if (options.hasConversation()) {
          await options.syncCurrentMessages();
          await options.markRead();
        }
      } catch (error: any) {
        syncError.value = error?.message || "重连后同步失败，已回退轮询";
        startPolling();
      }
    });

    await connection.start();
    realtimeConnected.value = true;
    resetSubscriptions();
    stopPolling();
    await subscribeAllKnownConversations();
  }

  async function markMessageReadViaSignalR(messageId: number, conversationId: number) {
    if (!connection || !realtimeConnected.value) {
      await options.markRead();
      return;
    }

    try {
      await connection.invoke("MarkMessageRead", conversationId, messageId);
    } catch (error) {
      console.error("SignalR 标记已读失败，降级为 HTTP:", error);
      await options.markRead();
    }
  }

  async function disconnectRealtime() {
    shouldKeepRealtime = false;
    if (!connection) return;

    try {
      await connection.stop();
    } finally {
      connection = null;
      realtimeConnected.value = false;
      resetSubscriptions();
    }
  }

  async function startPush() {
    shouldKeepRealtime = true;
    try {
      await connectRealtime();
      syncError.value = "";
    } catch (error: any) {
      const isTimeout = error?.code === "ECONNABORTED";
      const isNetworkError = error?.message === "Network Error" || !error?.response;

      if (isTimeout) {
        syncError.value = "连接超时，已自动降级为轮询模式";
      } else if (isNetworkError) {
        syncError.value = "无法连接服务端，已自动降级为轮询模式";
      } else {
        syncError.value = error?.message || "SignalR 不可用，已自动降级为轮询模式";
      }

      startPolling();
    }
  }

  async function stopPush() {
    shouldKeepRealtime = false;
    stopPolling();
    await disconnectRealtime();
  }

  async function togglePush() {
    if (polling.value || realtimeConnected.value) {
      await stopPush();
    } else {
      await startPush();
    }
  }

  onBeforeUnmount(() => {
    void stopPush();
  });

  return {
    polling,
    realtimeConnected,
    syncError,
    statusText,
    startPush,
    stopPush,
    togglePush,
    subscribeConversation,
    markMessageReadViaSignalR,
  };
}
