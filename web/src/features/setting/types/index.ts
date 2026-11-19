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
