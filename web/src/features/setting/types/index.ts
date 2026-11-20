/**
 * 登录记录（设备列表）相关类型（GET /mm/LoginRecords）。
 *
 * 语义：一台登录设备一行，展示该设备最后一次登录记录 + 最后活跃时间；
 * 只有「当前设备」会被服务端标记 isCurrent。
 * 字段命名与后端 DTO 的 camelCase 保持一致；`loginType` 后端可能新增取值，
 * 因此用 string 而不是联合类型（页面侧按映射表兜底展示）。
 */

/** 记录范围：domestic 仅国内 / all 全部 */
export type LoginScope = "domestic" | "all";

/** 单条登录记录（一台登录设备 = 该设备最后一次登录记录 + 最近活跃时间） */
export interface LoginRecordItem {
  /** 登录设备 ID（user_login_devices.id），页面以它作为列表 key */
  deviceId: number;
  device?: string | null;
  platform?: string | null;
  /** password / email-code / wechat / register / email-change */
  loginType?: string | null;
  /** 展示用位置：省 · 市 / 境外 / 本地网络 / 未知位置 */
  location?: string | null;
  ipMasked?: string | null;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  isp?: string | null;
  isDomestic?: boolean;
  /** 是否为当前请求所在设备（服务端按 X-Device-Id / token sid 判定） */
  isCurrent?: boolean;
  /** UTC ISO（带 Z），最后一次登录时间 */
  loginAt?: string | null;
  /** UTC ISO（带 Z），最后活跃时间（打开小程序 / 网页时更新） */
  lastActiveAt?: string | null;
}

/**
 * 更新日志相关类型（GET /mm/Changelog）。
 *
 * 语义：一个版本一条记录，`sections` 是「新增 / 修复 / 优化」等分组，
 * 组内条目是纯文本（不要当 HTML 渲染）；`date` 是 `YYYY-MM-DD` 字符串，
 * 直接原样展示，不做时区转换。文件缺失时服务端返回空 items / total 0。
 */

/** 一个更新分组（例如「新增」「修复」） */
export interface ChangelogSection {
  /** 分组标题 */
  title: string;
  /** 组内条目（纯文本） */
  items: string[];
}

/** 单个版本的更新日志 */
export interface ChangelogEntry {
  /** 版本号（展示用，例如 1.2.0） */
  version: string;
  /** 发布日期，`YYYY-MM-DD` 字符串，原样展示 */
  date?: string | null;
  /** 分组列表，可能为空数组 */
  sections: ChangelogSection[];
}

/** GET /mm/Changelog 响应体 */
export interface ChangelogListResponse {
  /** 最新版本号（没有日志时为 null） */
  latestVersion?: string | null;
  /** 最新版本日期 `YYYY-MM-DD`（没有日志时为 null） */
  latestDate?: string | null;
  /** 版本总数 */
  total?: number;
  /** 按日期倒序的版本列表 */
  items?: ChangelogEntry[];
}

/** GET /mm/LoginRecords 响应体 */
export interface LoginRecordListResponse {
  scope?: LoginScope | string;
  page?: number;
  pageSize?: number;
  /** 当前 scope 下的设备数 */
  total?: number;
  /** 国内设备数（最后一次登录为国内的设备，摘要用） */
  domesticTotal?: number;
  /** 全部设备数（摘要用） */
  allTotal?: number;
  /** 按最后活跃时间倒序的设备列表 */
  items?: LoginRecordItem[];
}

/**
 * 意见反馈相关类型（POST /mm/Feedback、GET /mm/Feedback、GET /mm/Feedback/mine）。
 *
 * 语义：普通用户提交反馈并查看「我的反馈」；管理员查看全部反馈并回复。
 * 时间字段均为 UTC 字符串（后端约定不带时区后缀），展示前必须先按 UTC 解析再转本地。
 */

/** 反馈处理状态：pending 待回复 / replied 已回复 */
export type FeedbackStatus = "pending" | "replied";

/** 反馈来源端：web 网页 / mp 小程序 */
export type FeedbackApp = "web" | "mp";

/** 管理员列表的状态筛选值（all 表示全部） */
export type FeedbackStatusFilter = "all" | FeedbackStatus;

/** 管理员列表的来源端筛选值（all 表示全部） */
export type FeedbackAppFilter = "all" | FeedbackApp;

/** 提交反馈请求体（POST /mm/Feedback） */
export interface CreateFeedbackRequest {
  /** 反馈内容（trim 后必填，≤2000 字符） */
  content: string;
  /** 联系方式（可选，trim 后空串按 null 传，≤128 字符） */
  contact?: string | null;
  /** 来源端：网页固定传 "web" / 小程序固定传 "mp" */
  app?: FeedbackApp;
}

/** 管理员回复请求体（POST /mm/Feedback/{id}/reply） */
export interface ReplyFeedbackRequest {
  /** 回复内容（trim 后必填，≤2000 字符） */
  replyContent: string;
}

/** 单条反馈（普通用户视角，不含用户身份字段） */
export interface FeedbackItemDto {
  /** 反馈 ID */
  id: number;
  /** 反馈内容 */
  content: string;
  /** 联系方式（可选） */
  contact?: string | null;
  /** 来源端：web / mp */
  app: FeedbackApp;
  /** 处理状态：pending / replied */
  status: FeedbackStatus;
  /** 管理员回复内容（未回复时为 null） */
  replyContent?: string | null;
  /** 回复时间 UTC 字符串（未回复时为 null） */
  repliedAt?: string | null;
  /** 提交时间 UTC 字符串 */
  createdAt: string;
}

/** 管理员视角下的单条反馈：在 FeedbackItemDto 基础上补充提交者身份 */
export interface AdminFeedbackItemDto extends FeedbackItemDto {
  /** 提交用户 ID */
  userId: number;
  /** 提交用户账号名（可能为空，用户已注销等） */
  userAccount?: string | null;
  /** 提交用户昵称（可能为空） */
  nickName?: string | null;
  /** 提交用户邮箱（可能为空） */
  email?: string | null;
}

/** GET /mm/Feedback/mine 响应体 */
export interface MyFeedbackListResponse {
  page?: number;
  pageSize?: number;
  /** 本人未删除反馈总数 */
  total?: number;
  /** 按提交时间倒序的反馈列表 */
  items?: FeedbackItemDto[];
}

/** GET /mm/Feedback（管理员）响应体 */
export interface AdminFeedbackListResponse {
  page?: number;
  pageSize?: number;
  /** 当前筛选命中的反馈数 */
  total?: number;
  /** 全部反馈中的待回复总数（不受关键词 / 来源端筛选影响，供 tab 徽标） */
  pendingTotal?: number;
  /** 全部反馈中的已回复总数（同上） */
  repliedTotal?: number;
  /** 服务端回显的状态筛选值 */
  status?: FeedbackStatusFilter | string;
  /** 服务端回显的关键词 */
  keyword?: string | null;
  /** 服务端回显的来源端筛选值 */
  app?: FeedbackAppFilter | string;
  /** 按提交时间倒序的反馈列表 */
  items?: AdminFeedbackItemDto[];
}
