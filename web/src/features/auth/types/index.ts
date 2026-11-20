export interface AuthUser {
  userId: number;
  email: string;
  nickName: string | null;
  userAccount: string | null;
  avatarKey: string | null;
  /**
   * 用户角色："admin" 管理员 / "user" 普通用户。
   * 老后端可能不返回该字段，因此可选；前端一律按 `role === "admin"` 判定管理员，
   * 未知 / 缺省都当作普通用户（权限判断失败时宁可少开入口，也不误开管理界面）。
   */
  role?: string | null;
  /** 上一次使用的头像 key；null 表示还没有可回退的上次头像。 */
  previousAvatarKey: string | null;
  /** 个人主页头像卡自定义背景图 key；null 表示未设置，展示时回退头像图。 */
  profileBackgroundKey: string | null;
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
  /** 用户角色："admin" 管理员 / "user" 普通用户；老后端缺省。 */
  role?: string | null;
  token: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  avatarKey?: string | null;
  /** 上一次使用的头像 key；登录 / 刷新等 AuthResponse 也会返回。 */
  previousAvatarKey?: string | null;
  profileBackgroundKey?: string | null;
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