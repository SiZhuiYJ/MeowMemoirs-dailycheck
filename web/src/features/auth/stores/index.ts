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

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AuthUser | null>();
  const accessToken = ref<string | null>();
  const refreshToken = ref<string | null>();
  const accessTokenExpiresAt = ref<string | null>();
  const refreshTokenExpiresAt = ref<string | null>();
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

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

  // 自动刷新token的函数
  function setupAutoRefresh() {
    // 清除现有的定时器
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }

    if (!accessTokenExpiresAt.value || !refreshToken.value) return;

    try {
      const expiresAt = new Date(accessTokenExpiresAt.value);
      const now = new Date();
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();

      // 在token过期前5分钟刷新
      const refreshTime = Math.max(timeUntilExpiry - 5 * 60 * 1000, 0);

      if (refreshTime > 0) {
        refreshTimer = setTimeout(async () => {
          try {
            // 调用刷新接口
            const refreshResponse = await http.post<AuthData>(
              "/mm/Auth/refresh",
              {
                refreshToken: refreshToken.value,
              },
              {
                skipAuth: true,
                skipAuthRefresh: true,
              },
            );
            setSession(refreshResponse.data);
          } catch (error) {
            console.error("自动刷新token失败:", error);
            notifyWarning("自动续期失败，请检查网络后重试");
          }
        }, refreshTime);
      }
    } catch (error) {
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

    try {
      localStorage.removeItem(CACHE_PREFIX + "auth");
      router.push("/login");
    } catch { }
  }

  watch([accessTokenExpiresAt, refreshToken], () => {
    if (accessToken.value && refreshToken.value) {
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
