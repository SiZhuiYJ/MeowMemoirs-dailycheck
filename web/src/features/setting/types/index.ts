/**
 * 登录记录相关类型（GET /mm/LoginRecords）。
 *
 * 字段命名与后端 DTO 的 camelCase 保持一致；`loginType` 后端可能新增取值，
 * 因此用 string 而不是联合类型（页面侧按映射表兜底展示）。
 */

/** 记录范围：domestic 仅国内 / all 全部 */
export type LoginScope = "domestic" | "all";

/** 登录记录状态：current 当前登录 / active 在线 / logged_out 已退出 */
export type LoginStatus = "current" | "active" | "logged_out";

/** 单条登录记录 */
export interface LoginRecordItem {
  id: number;
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
  status?: LoginStatus | null;
  /** UTC ISO（带 Z） */
  loginAt?: string | null;
  logoutAt?: string | null;
}

/** GET /mm/LoginRecords 响应体 */
export interface LoginRecordListResponse {
  scope?: LoginScope | string;
  page?: number;
  pageSize?: number;
  /** 当前 scope 下的总条数 */
  total?: number;
  /** 国内记录总数（摘要用） */
  domesticTotal?: number;
  /** 全部记录总数（摘要用） */
  allTotal?: number;
  items?: LoginRecordItem[];
}
