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
  | "reset-password" // "重置密码",
  | "change-email" // "换绑邮箱（新邮箱）",
  | "change-email-current"; // "换绑邮箱（验证当前邮箱）"

export interface ChangeEmailPayload {
  /** 需要换绑到的新邮箱 */
  newEmail: string;
  /** 新邮箱收到的验证码 */
  newEmailCode: string;
  /** 当前密码（普通账号与 currentEmailCode 二选一） */
  password?: string | null;
  /** 当前邮箱收到的验证码（普通账号与 password 二选一） */
  currentEmailCode?: string | null;
}

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