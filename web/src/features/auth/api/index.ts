// @/features/auth/api/index.ts
// 认证相关API的统一出口

import http from "@/libs/http";
import type {
  ActionType,
  AuthData,
  AuthUser,
  PasswordPayload,
  RegisterRecord,
  AccountStatus,
  UserProfile,
  ThirdPartyBinding,
} from "../types";
/**
 * 认证API服务
 * 包含用户登录、注册、账户管理等相关接口
 */
export const authApi = {
  /**
   * 退出登录：让服务端撤销该账号当前所有令牌。
   * 失败也不影响本地登出（不阻断用户体验）。
   */
  async logout() {
    return await http.post("/mm/Auth/logout", undefined, { showError: false });
  },

  /**
   * 发送邮箱验证码
   * @param data 包含邮箱和操作类型的对象
   * @returns Promise<void>
   */
  async sendEmailCode(data: { email: string; actionType: ActionType }) {
    return await http.post("/mm/Auth/email-code", data);
  },

  /**
   * 更新用户资料
   * @param data 包含昵称和头像key的对象
   * @returns Promise<AuthData>
   */
  async updateProfile(data: {
    nickName: string | null;
    avatarKey: string | null;
  }) {
    return await http.post<AuthData>("/mm/Auth/profile", data);
  },

  /**
   * 更新用户密码
   * @param data 密码更新数据
   * @returns Promise<void>
   */
  async updatePassword(data: PasswordPayload) {
    return await http.post("/mm/Auth/change-password", data);
  },

  /**
   * 确认账号注销
   * @param data 包含验证码的对象
   * @returns Promise<void>
   */
  async deactivateConfirm(data: { code: string }) {
    return await http.post("/mm/Auth/deactivate", data);
  },

  /**
   * 验证用户名是否可用
   * @param userAccount 用户名
   * @returns Promise<void>
   */
  async validateUserAccount(userAccount: string) {
    return http.post("/mm/Auth/validate-account", undefined, {
      params: { UserAccount: userAccount },
    });
  },
  /**
   * 获取用户信息
   * @returns Promise<AuthData>
   */
  async getAuthData() {
    return await http.get<AuthUser>("/mm/Auth/me");
  },

  /**
   * 邮箱登录
   * @param data 包含邮箱和密码的对象
   * @returns Promise<AuthData>
   */
  async loginWithEmail(data: { email: string; password: string }) {
    return await http.post<AuthData>("/mm/Auth/login", data);
  },

  /**
   * 账号登录
   * @param data 包含用户名和密码的对象
   * @returns Promise<AuthData>
   */
  async loginWithAccount(data: { userAccount: string; password: string }) {
    return await http.post<AuthData>("/mm/Auth/login-account", data);
  },

  /**
   * 邮箱验证码登录
   * @param data 包含邮箱和验证码的对象
   * @returns Promise<AuthData>
   */
  async loginWithEmailCode(data: { email: string; code: string }) {
    return await http.post<AuthData>("/mm/Auth/login-email-code", data);
  },

  /**
   * 用户注册
   * @param data 注册信息
   * @returns Promise<AuthData>
   */
  async register(data: RegisterRecord) {
    return await http.post<AuthData>("/mm/Auth/register", data);
  },
  /**
   * 修改用户账号
   * @param data 包含新用户名和密码的对象
   * @returns Promise<void>
   */
  async updateUserAccount(userAccount: string) {
    return await http.post<AuthData>("/mm/Auth/account", {
      UserAccount: userAccount,
    });
  },
  /**
   * 账号状态查询
   * @returns Promise<{ canUpdate: boolean; nextUpdateAt: string }>
   */
  async checkAccountStatus() {
    return await http.get<AccountStatus>("/mm/Auth/account/status");
  },
  /**
   * 修改基础信息
   * @param data 包含昵称和头像key的对象
   * @returns Promise<AuthData>
   */
  async updateProfileInfo(data: UserProfile) {
    return await http.post<AuthData>("/mm/Auth/profile", data);
  },
  /**
   * 获取用户第三方平台绑定信息
   * @returns Promise<{ provider: string; boundAt: string; isBound: boolean }[] }
   */
  async getThirdPartyBindings() {
    return await http.get<{ bindings: ThirdPartyBinding[] }>(
      "/mm/Auth/bindings",
    );
  },
};

/**
 * 导出所有认证相关的类型
 */
export type {
  ActionType,
  AuthData,
  PasswordPayload,
  RegisterRecord,
} from "../types";

/**
 * 默认导出authApi
 */
export default authApi;
