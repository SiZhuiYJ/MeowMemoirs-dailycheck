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
  /** 上一次使用的头像 key；null 表示没有可回退的上次头像 */
  previousAvatarKey: string | null;
  profileBackgroundKey: string | null; // 个人主页背景图 key，null 表示未设置（回退到头像）
  thirdPartyBindings?: ThirdPartyBinding[]; // 新增：第三方绑定信息
  /**
   * 账号角色："admin" 管理员 / "user" 普通用户 / null 未知（旧缓存或接口未返回）。
   * 用于设置页菜单与意见反馈页按角色切换视图；权限最终仍由后端校验，这里只决定展示。
   */
  role: string | null;
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
    /**
     * 是否管理员：只认后端返回的 role 字段。
     * 本地缓存里没有 role 时返回 false，页面会先拉一次 /mm/Auth/me 补齐角色再决定视图。
     */
    isAdmin(state): boolean {
      return state.user?.role === 'admin';
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
        previousAvatarKey: getVal(['previousAvatarKey', 'PreviousAvatarKey']) || null,
        profileBackgroundKey: getVal(['profileBackgroundKey', 'ProfileBackgroundKey']) || null,
        thirdPartyBindings: getVal(['thirdPartyBindings', 'ThirdPartyBindings']) || [], // 添加第三方绑定信息
        // 登录 / 刷新返回的 AuthResponse 新增 role 字段，缺失时记 null，页面据此再拉 /me 补齐
        role: getVal(['role', 'Role']) ?? null,
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

          const previousAvatarKey = getVal(['previousAvatarKey', 'PreviousAvatarKey']);
          if (previousAvatarKey !== undefined) {
            updateData.previousAvatarKey = previousAvatarKey || null;
          }

          const profileBackgroundKey = getVal(['profileBackgroundKey', 'ProfileBackgroundKey']);
          if (profileBackgroundKey !== undefined) {
            updateData.profileBackgroundKey = profileBackgroundKey || null;
          }

          const thirdPartyBindings = getVal(['thirdPartyBindings', 'ThirdPartyBindings']);
          if (thirdPartyBindings !== undefined) updateData.thirdPartyBindings = thirdPartyBindings;

          // 角色可能由管理端调整，每次拉取 /me 都以服务端为准刷新
          const role = getVal(['role', 'Role']);
          if (role !== undefined) updateData.role = role ?? null;

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