export interface AuthUser {
  userId: number;
  email: string;
  nickName: string | null;
  userAccount: string | null;
  avatarKey: string | null;
  thirdPartyBindings?: ThirdPartyBinding[]; // 新增：第三方绑定信息
}

export interface ThirdPartyBinding {
  provider: string;
  boundAt: string; // ISO date string
  isBound: boolean;
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
}
export interface AuthData {
  userId: number;
  email: string;
  nickName: string | null;
  userAccount: string | null;
  token: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  avatarKey?: string | null;
}
export type ActionType =
  | "register" // "注册",
  | "signup" // "注册",
  | "login" // "登录",
  | "change-password" // "修改密码",
  | "deactivate" // "注销账号",
  | "reset-password"; // "重置密码",

export interface PasswordPayload {
  newPassword: string;
  oldPassword: string | null;
  code: string | null;
}
export interface RegisterRecord {
  email: string;
  password: string;
  nickName: string | null;
  userAccount: string | null;
  code: string;
}
export interface AccountStatus {
  canUpdate: boolean;
  nextUpdateAt: string | null
}
// 用户基础信息
export interface UserProfile {
  nickName: string | null;
  avatarKey: string | null;
}