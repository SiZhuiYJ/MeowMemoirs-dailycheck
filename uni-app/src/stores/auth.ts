import { defineStore } from 'pinia';
import http from '@/libs/http/config';

export interface ThirdPartyBinding {
  provider: string;
  boundAt: string; // ISO date string
  isBound: boolean;
}

export interface AuthUser {
  userId: number;
  email: string;
  nickName: string | null;
  userAccount: string | null;
  avatarKey: string | null;
  thirdPartyBindings?: ThirdPartyBinding[]; // 新增：第三方绑定信息
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
}

const STORAGE_KEY = 'dailycheck_auth';

function loadInitialState(): AuthState {
  const raw = uni.getStorageSync(STORAGE_KEY);
  if (!raw) {
    return {
      user: null,
      accessToken: null,
      refreshToken: null,
    };
  }
  try {
    return raw as AuthState;
  } catch {
    return {
      user: null,
      accessToken: null,
      refreshToken: null,
    };
  }
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => loadInitialState(),
  getters: {
    isAuthenticated(state): boolean {
      return !!state.accessToken;
    },
  },
  actions: {
    setSession(payload: any): void {
      // Helper to handle inconsistent API response casing
      const getVal = (keys: string[]) => {
        for (const key of keys) {
          if (payload[key] !== undefined) return payload[key];
        }
        return undefined;
      };

      this.user = {
        userId: getVal(['userId', 'UserId']),
        email: getVal(['email', 'Email']),
        nickName: getVal(['nickName', 'NickName']),
        userAccount: getVal(['userAccount', 'UserAccount']),
        avatarKey: getVal(['avatarKey', 'AvatarKey']) || null,
        thirdPartyBindings: getVal(['thirdPartyBindings', 'ThirdPartyBindings']) || [], // 添加第三方绑定信息
      };
      this.accessToken = getVal(['token', 'Token']);
      this.refreshToken = getVal(['refreshToken', 'RefreshToken']);
      this.persist();
    },
    updateUser(partial: Partial<AuthUser>) {
      if (this.user) {
        this.user = { ...this.user, ...partial };
        this.persist();
      }
    },
    async fetchUserInfo() {
      try {
        const res = await http.get('/mm/Auth/me');
        if (res.statusCode === 200 && res.data) {
          const data = res.data;

          // Helper to handle inconsistent API response casing (PascalCase vs camelCase)
          const getVal = (keys: string[]) => {
            for (const key of keys) {
              if (data[key] !== undefined) return data[key];
            }
            return undefined;
          };

          const updateData: Partial<AuthUser> = {};

          const userId = getVal(['userId', 'UserId']);
          if (userId !== undefined) updateData.userId = userId;

          const email = getVal(['email', 'Email']);
          if (email !== undefined) updateData.email = email;

          const nickName = getVal(['nickName', 'NickName']);
          if (nickName !== undefined) updateData.nickName = nickName;

          const userAccount = getVal(['userAccount', 'UserAccount']);
          if (userAccount !== undefined) updateData.userAccount = userAccount;

          const avatarKey = getVal(['avatarKey', 'AvatarKey']);
          if (avatarKey !== undefined) updateData.avatarKey = avatarKey;

          const thirdPartyBindings = getVal(['thirdPartyBindings', 'ThirdPartyBindings']);
          if (thirdPartyBindings !== undefined) updateData.thirdPartyBindings = thirdPartyBindings;

          this.updateUser(updateData);
        }
      } catch (error) {
        console.error('Failed to fetch user info', error);
      }
    },
    clear(): void {
      this.user = null;
      this.accessToken = null;
      this.refreshToken = null;
      try {
        uni.removeStorageSync(STORAGE_KEY);
      } catch {
      }
    },
    persist(): void {
      const data: AuthState = {
        user: this.user,
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
      };
      uni.setStorageSync(STORAGE_KEY, data);
    },
  },
});