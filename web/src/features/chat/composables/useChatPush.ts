import { computed, onBeforeUnmount, ref } from "vue";
import {
  HubConnectionBuilder,
  HttpTransportType,
  LogLevel,
} from "@microsoft/signalr";
import type { MessageSummary } from "../types";
import { telemetry } from "@/libs/telemetry";

interface IncomingMessagePayload {
  conversationId: number;
  message?: MessageSummary;
  /** 服务端若直接带上未读总数，可直接采用，省掉一次列表刷新。 */
  unreadCount?: number;
}

interface PushOptions {
  fetchConversations: (options?: { silent?: boolean }) => Promise<void>;
  syncCurrentMessages: () => Promise<unknown>;
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
  }) => Promise<void> | void;
  onFriendRequestsUpdated?: () => Promise<void> | void;
  onFriendshipsUpdated?: () => Promise<void> | void;
  getAllConversationIds: () => number[];
  /** 收到新消息：由上层本地更新会话列表/未读数，避免整表重拉。 */
  onIncomingMessage?: (payload: IncomingMessagePayload) => Promise<void> | void;
}

/** 降级轮询间隔：只在实时连接不可用时使用，且只做增量同步。 */
const POLLING_INTERVAL_MS = 10000;

export function useChatPush(options: PushOptions) {
  const polling = ref(false);
  const realtimeConnected = ref(false);
  const lastSyncAt = ref("");
  const syncError = ref("");

  let timer: ReturnType<typeof setInterval> | null = null;
  let connection: any = null;
  let shouldKeepRealtime = false;
  let visibilityBound = false;
  const subscribedConversationIds = new Set<number>();
  /** 连接建立时服务端已自动加入的会话分组。 */
  let serverJoinedConversationIds = new Set<number>();

  const statusText = computed(() => {
    if (syncError.value) return `推送异常：${syncError.value}`;
    if (realtimeConnected.value) return "实时连接中";
    if (!polling.value) return "推送已停止";
    if (!lastSyncAt.value) return "正在连接...";
    return `离线轮询中（最近同步：${new Date(lastSyncAt.value).toLocaleTimeString()}）`;
  });

  /**
   * 一轮同步：
   * 1) 静默刷新会话列表（未读数/排序以服务端为准）；
   * 2) 只增量拉取当前会话的新消息，不再整段重载。
   */
  async function tick() {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      await options.fetchConversations({ silent: true });
      if (options.hasConversation()) {
        await options.syncCurrentMessages();
        await options.markRead();
      }
      lastSyncAt.value = new Date().toISOString();
      syncError.value = "";
    } catch (error: any) {
      const isNetworkError = error?.message === "Network Error" || !error?.response;
      if (error?.code === "ECONNABORTED") {
        syncError.value = "同步超时，正在重试";
      } else if (isNetworkError) {
        syncError.value = "无法连接服务端，已切换为重试模式";
      } else {
        syncError.value = error?.response?.data?.message || error?.message || "同步失败";
      }
    }
  }

  function startPolling() {
    if (timer) return;
    polling.value = true;
    void tick();
    timer = setInterval(() => {
      void tick();
    }, POLLING_INTERVAL_MS);
  }

  function stopPolling() {
    polling.value = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  /** 页面回到前台时立刻补一次同步，避免切回标签页要等一个轮询周期。 */
  function handleVisibilityChange() {
    if (typeof document === "undefined") return;
    if (document.hidden) return;
    void tick();
  }

  function bindVisibility() {
    if (visibilityBound || typeof document === "undefined") return;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    visibilityBound = true;
  }

  function unbindVisibility() {
    if (!visibilityBound || typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    visibilityBound = false;
  }

  async function subscribeConversation(conversationId: number) {
    if (!conversationId || !connection || !realtimeConnected.value) return;
    if (subscribedConversationIds.has(conversationId)) return;

    // 先登记，避免并发调用时重复 invoke
    subscribedConversationIds.add(conversationId);
    try {
      await connection.invoke("SubscribeConversation", conversationId);
    } catch (error: any) {
      subscribedConversationIds.delete(conversationId);
      syncError.value = error?.message || "订阅会话失败";
    }
  }

  async function subscribeAllKnownConversations() {
    const allIds = options.getAllConversationIds();
    const currentId = options.getConversationId();
    if (currentId && !allIds.includes(currentId)) allIds.push(currentId);
    if (allIds.length === 0) return;

    // 服务端在连接建立时已经把这些连接自动加入了用户的全部会话分组，
    // 因此这里只补订阅「连接之后才出现的新会话」，避免每次事件都发 N 个
    // hub 调用（每个调用服务端都要查一次成员关系）。
    const pending = allIds.filter(
      (id) => !subscribedConversationIds.has(id) && !serverJoinedConversationIds.has(id),
    );
    if (pending.length === 0) return;

    const CONCURRENCY = 4;
    for (let index = 0; index < pending.length; index += CONCURRENCY) {
      await Promise.allSettled(
        pending.slice(index, index + CONCURRENCY).map((id) => subscribeConversation(id)),
      );
    }
  }

  function resetSubscriptions() {
    subscribedConversationIds.clear();
  }

  /** 记录服务端在连接建立时已自动加入的会话，避免重复订阅。 */
  function seedServerJoinedConversations() {
    serverJoinedConversationIds = new Set(options.getAllConversationIds());
  }

  async function connectRealtime() {
    const token = options.getToken();
    if (!token) throw new Error("缺少登录令牌，无法建立 SignalR 连接");

    const connectStartedAt = Date.now();
    telemetry.track("signalr", "signalr-connect-start", {
      tokenTail: token.slice(-12),
      baseUrl: options.getBaseUrl(),
      online: typeof navigator === "undefined" ? true : navigator.onLine,
    }, "info");

    const baseUrl = options.getBaseUrl().replace(/\/+$/, "");
    connection = new HubConnectionBuilder()
      .withUrl(`${baseUrl}/hubs/chat`, {
        accessTokenFactory: () => options.getToken(),
        transport: HttpTransportType.WebSockets | HttpTransportType.LongPolling,
      })
      .configureLogging(LogLevel.Warning)
      .withAutomaticReconnect([0, 2000, 5000, 10000, 20000, 30000])
      .withKeepAliveInterval(15000)
      .withServerTimeout(45000)
      .build();

    /**
     * 新消息事件。
     * 旧实现先 await fetchConversations() 再处理消息，等于把「看到消息」的延迟
     * 绑定在一次全量列表刷新上；现在直接用推送里的消息做本地更新。
     */
    connection.on("chat:message-updated", async (payload: any) => {
      const conversationId = Number(payload?.conversationId) || 0;
      const message = payload?.message as MessageSummary | undefined;

      // 新会话（本地列表里没有）先补齐列表，并订阅这个连接之后才出现的会话
      const isKnown = options
        .getAllConversationIds()
        .includes(conversationId);
      if (conversationId && !isKnown) {
        await options.fetchConversations({ silent: true });
        await subscribeConversation(conversationId);
      }

      if (options.onIncomingMessage && conversationId) {
        await options.onIncomingMessage({
          conversationId,
          message,
          unreadCount: payload?.unreadCount,
        });
      }

      if (conversationId && conversationId === options.getConversationId()) {
        if (message && options.upsertMessage) {
          await options.upsertMessage(message);
        } else {
          await options.syncCurrentMessages();
        }
        await options.markRead();
      }
    });

    connection.on("chat:inbox-updated", async () => {
      await options.fetchConversations({ silent: true });
      await subscribeAllKnownConversations();
    });

    connection.on("chat:message-read", async (payload: any) => {
      if (!options.onMessageRead) return;

      // 服务端现在会把一次批量已读合并成单个事件（messageIds），
      // 兼容只有 messageId 的旧格式。
      const ids: number[] = Array.isArray(payload?.messageIds) && payload.messageIds.length > 0
        ? payload.messageIds
        : [payload?.messageId];

      for (const messageId of ids) {
        if (!messageId) continue;
        await options.onMessageRead({
          messageId,
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

    connection.onclose((error: any) => {
      realtimeConnected.value = false;
      resetSubscriptions();
      telemetry.track("signalr", "signalr-closed", {
        error: error?.message ?? null,
        keepRealtime: shouldKeepRealtime,
        willFallbackToPolling: shouldKeepRealtime,
      }, shouldKeepRealtime ? "warn" : "info");
      if (!shouldKeepRealtime) return;
      syncError.value = "实时连接已断开，正在重连";
      startPolling();
    });

    connection.onreconnecting((error: any) => {
      realtimeConnected.value = false;
      resetSubscriptions();
      telemetry.track("signalr", "signalr-reconnecting", {
        error: error?.message ?? null,
      }, "warn");
      syncError.value = error?.message || "连接中断，正在重连";
      startPolling();
    });

    connection.onreconnected(async () => {
      try {
        realtimeConnected.value = true;
        syncError.value = "";
        stopPolling();
        telemetry.track("signalr", "signalr-reconnected", {}, "info");
        await options.fetchConversations({ silent: true });
        // 重连后服务端会重新自动加入全部会话分组，这里重置本地记录即可
        resetSubscriptions();
        seedServerJoinedConversations();
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
    syncError.value = "";
    telemetry.track("signalr", "signalr-connected", {
      inMs: Date.now() - connectStartedAt,
      transport: connection.transport?.name ?? null,
      connectionId: connection.connectionId ?? null,
    }, "info");
    stopPolling();
    resetSubscriptions();
    // 连接建立时服务端已把本连接加入全部会话分组（ChatHub.OnConnectedAsync）
    seedServerJoinedConversations();
    await subscribeAllKnownConversations();
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
    bindVisibility();
    try {
      await connectRealtime();
      syncError.value = "";
    } catch (error: any) {
      const isTimeout = error?.code === "ECONNABORTED";
      const isNetworkError = error?.message === "Network Error" || !error?.response;

      telemetry.captureError("signalr-connect-failed", error, {
        tokenMissing: !options.getToken(),
        willFallbackToPolling: true,
      });

      if (isTimeout) {
        syncError.value = "连接超时，已降级为离线轮询";
      } else if (isNetworkError) {
        syncError.value = "无法连接服务端，已降级为离线轮询";
      } else {
        syncError.value = error?.message || "实时通道不可用，已降级为离线轮询";
      }

      startPolling();
    }
  }

  async function stopPush() {
    shouldKeepRealtime = false;
    unbindVisibility();
    stopPolling();
    await disconnectRealtime();
  }

  async function togglePush(force?: boolean) {
    if (force === true) {
      await startPush();
      return;
    }
    if (force === false) {
      await stopPush();
      return;
    }
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
  };
}
