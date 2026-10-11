import { defineStore } from "pinia";
import type {
  AuthData,
  AuthUser,
  ThirdPartyBinding,
} from "@/features/auth/types";
import router from "@/routers";
import { CACHE_PREFIX } from "@/config";
import { authApi } from "../api";
import http from "@/libs/http";
import { notifyWarning } from "@/utils/notification";
import { telemetry } from "@/libs/telemetry";

/** 两次自动刷新之间的最小间隔，避免 0 延迟导致的刷新风暴。 */
const MIN_REFRESH_INTERVAL_MS = 20_000;
/** 自动刷新最早也要等这么久。 */
const MIN_REFRESH_DELAY_MS = 10_000;
/** 刷新失败的退避重试间隔。 */
const REFRESH_RETRY_DELAY_MS = 30_000;

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AuthUser | null>();
  const accessToken = ref<string | null>();
  const refreshToken = ref<string | null>();
  const accessTokenExpiresAt = ref<string | null>();
  const refreshTokenExpiresAt = ref<string | null>();
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRefreshScheduledAt = 0;
  let lastRefreshAt = 0;
  let refreshing = false;

  const isAuthenticated = computed(() => {
    return !!accessToken.value;
  });

  async function initialAuth() {
    const { data } = await authApi.getAuthData();
    user.value = data;
  }

  function setSession(payload: AuthData): void {
    user.value = {
      userId: payload.userId,
      email: payload.email,
      nickName: payload.nickName,
      userAccount: payload.userAccount,
      avatarKey: payload.avatarKey || null,
    };
    accessToken.value = payload.token;
    refreshToken.value = payload.refreshToken;
    accessTokenExpiresAt.value = payload.accessTokenExpiresAt;
    refreshTokenExpiresAt.value = payload.refreshTokenExpiresAt;

    // 设置自动刷新定时器
    setupAutoRefresh();
  }

  /** 从 localStorage 读取其他标签页持久化的会话（pinia 持久化的原始结构）。 */
  function readPersistedSession(): {
    accessToken?: string | null;
    refreshToken?: string | null;
    accessTokenExpiresAt?: string | null;
    refreshTokenExpiresAt?: string | null;
  } | null {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + "auth");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * 采用其他标签页刚刷新出来的会话。
   *
   * 后端每个用户在 Redis 里只保留一份 access_token/refresh_token，
   * 任何一次刷新都会覆盖它。多标签页/多设备同时刷新时就会互相把对方踢下线：
   * 因此刷新前先看别的标签页是否已经刷过了，能直接复用就不要再刷一次。
   */
  function adoptSessionFromStorage(options?: { silent?: boolean }): boolean {
    const persisted = readPersistedSession();
    if (!persisted?.accessToken) return false;
    if (persisted.accessToken === accessToken.value) return false;

    const expiresAt = persisted.accessTokenExpiresAt ? Date.parse(persisted.accessTokenExpiresAt) : NaN;
    // 已过期的不要采用
    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) return false;

    accessToken.value = persisted.accessToken;
    refreshToken.value = persisted.refreshToken ?? refreshToken.value ?? null;
    accessTokenExpiresAt.value = persisted.accessTokenExpiresAt ?? null;
    refreshTokenExpiresAt.value = persisted.refreshTokenExpiresAt ?? null;

    if (!options?.silent) {
      telemetry.track("auth", "auth-session-adopted", {
        reason: "其他标签页已刷新令牌，直接复用避免互相踢下线",
        accessTokenTail: String(persisted.accessToken).slice(-12),
      }, "info");
    }
    return true;
  }

  const canRefresh = () => Boolean(refreshToken.value);

  /**
   * 自动刷新 token。
   *
   * 旧实现的规则是「过期前 5 分钟刷新」，配合后端 1 分钟的 access token，
   * 算出来的延迟恒为负数 → Math.max(...,0) → setTimeout(0) →
   * 刷完立刻又排一次 0 延迟刷新 = 无限刷新循环，
   * 每轮都会覆盖 Redis 里的令牌，把其他标签页/设备挤掉，
   * 最终有一端刷新失败就跳「登录过期」。
   *
   * 现在改为「按剩余寿命的 20% 提前刷新」，并加最小延迟/最小间隔/进行中保护。
   */
  function setupAutoRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }

    if (!accessTokenExpiresAt.value || !canRefresh()) return;

    try {
      const expiresAt = Date.parse(accessTokenExpiresAt.value);
      if (Number.isNaN(expiresAt)) return;

      const now = Date.now();
      const remaining = expiresAt - now;

      // 令牌已经过期：交给 401 → 刷新链路处理，这里不排定时器（否则会变成忙等）
      if (remaining <= 0) {
        telemetry.track("auth", "auth-auto-refresh-skipped", {
          reason: "令牌已过期，等待 401 触发刷新",
          expiresAt: accessTokenExpiresAt.value,
        }, "warn");
        return;
      }

      // 提前量：剩余寿命的 20%，并限制在 [10s, 5min]
      const margin = Math.min(Math.max(remaining * 0.2, MIN_REFRESH_DELAY_MS), 5 * 60 * 1000);
      let delay = remaining - margin;

      // 生效下限：既避免 0 延迟自旋，也避免短寿命令牌被反复刷新
      const sinceLastRefresh = now - lastRefreshAt;
      delay = Math.max(delay, MIN_REFRESH_DELAY_MS, MIN_REFRESH_INTERVAL_MS - sinceLastRefresh);

      lastRefreshScheduledAt = now;
      telemetry.track("auth", "auth-auto-refresh-scheduled", {
        delayMs: delay,
        tokenRemainingMs: remaining,
        tokenLifetimeMs: Math.round(remaining),
        note: "按剩余寿命 20% 提前刷新",
      }, "debug");

      refreshTimer = setTimeout(async () => {
        refreshTimer = null;
        if (refreshing) return;

        // 先看别的标签页是否已经刷新过
        if (adoptSessionFromStorage()) {
          setupAutoRefresh();
          return;
        }

        refreshing = true;
        const startedAt = Date.now();
        try {
          // 走 http 层的单飞刷新：与「401 兜底刷新」共用同一把锁，
          // 避免两处同时刷新（新令牌会互相覆盖，是频繁掉线的经典成因）。
          await http.refreshSession();
          lastRefreshAt = Date.now();
          telemetry.track("auth", "auth-auto-refresh-success", {
            inMs: Date.now() - startedAt,
          }, "info");
        } catch (error) {
          const status = (error as { response?: { status?: number } })?.response?.status;
          telemetry.track("auth", "auth-auto-refresh-failed", {
            inMs: Date.now() - startedAt,
            status: status ?? null,
            message: (error as Error)?.message,
            willRetryInMs: status === 401 ? null : REFRESH_RETRY_DELAY_MS,
          }, "error");
          console.error("自动刷新token失败:", error);
          notifyWarning(
            status === 401 ? "登录状态已失效，请重新登录" : "自动续期失败，请检查网络后重试",
          );
          // 网络类失败：退避重试；401 由 http 层统一处理登出
          if (status !== 401) {
            refreshTimer = setTimeout(() => {
              refreshTimer = null;
              setupAutoRefresh();
            }, REFRESH_RETRY_DELAY_MS);
          }
        } finally {
          refreshing = false;
        }
      }, delay);
    } catch (error) {
      telemetry.captureError("auth-schedule-refresh-error", error);
      console.error("设置自动刷新失败:", error);
    }
  }

  function updateUser(payload: {
    userAccount?: string;
    nickName?: string;
    avatarKey?: string;
    thirdPartyBindings?: ThirdPartyBinding[]; // 新增：第三方绑定信息
  }): void {
    if (user.value) {
      if (payload.userAccount !== undefined)
        user.value.userAccount = payload.userAccount;
      if (payload.nickName !== undefined)
        user.value.nickName = payload.nickName;
      if (payload.avatarKey !== undefined)
        user.value.avatarKey = payload.avatarKey;
      if (payload.thirdPartyBindings !== undefined) {
        user.value.thirdPartyBindings = payload.thirdPartyBindings;
      }
    }
  }

  function clear(): void {
    user.value = null;
    accessToken.value = null;
    refreshToken.value = null;
    accessTokenExpiresAt.value = null;
    refreshTokenExpiresAt.value = null;

    // 清除定时器
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    refreshing = false;
    lastRefreshAt = 0;

    try {
      localStorage.removeItem(CACHE_PREFIX + "auth");
      router.push("/login");
    } catch { }
  }

  /**
   * 其他标签页刷新令牌后，本标签页自动跟上。
   * 不做这件事的话，本标签页会拿着已被覆盖的旧令牌一直请求 → 不断 401。
   */
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key !== CACHE_PREFIX + "auth") return;
      if (!event.newValue) return;
      adoptSessionFromStorage();
    });
  }

  watch([accessTokenExpiresAt, refreshToken], () => {
    if (accessToken.value && refreshToken.value) {
      // 避免因为自身 setSession 造成的重复排程（同一次 tick 内多次触发）
      if (Date.now() - lastRefreshScheduledAt < 500) return;
      setupAutoRefresh();
      return;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }, { immediate: true });

  return {
    user,
    accessToken,
    refreshToken,
    initialAuth,
    isAuthenticated,
    setSession,
    updateUser,
    clear,
    adoptSessionFromStorage,
  };
},
  {
    // 持久化配置
    persist: {
      // 持久化存储的键名
      key: CACHE_PREFIX + "auth",
      // 存储方式：localStorage
      storage: localStorage,
      // 指定持久化字段
      pick: [
        "accessToken",
        "refreshToken",
        "accessTokenExpiresAt",
        "refreshTokenExpiresAt",
      ],
    },
  });
