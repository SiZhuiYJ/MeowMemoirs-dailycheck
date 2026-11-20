/**
 * 意见反馈列表的展示辅助函数（普通用户 / 管理员共用）。
 *
 * 时间约定：后端所有时间都是 UTC，返回字符串可能带 Z，也可能不带时区后缀；
 * 这里统一先按 UTC 解析再转本地展示，避免被浏览器当成设备本地时间而偏移。
 * 写法和 views/setting/login-records/index.vue 保持一致（该页已有同样逻辑）。
 */

import type { FeedbackApp, FeedbackStatus } from "@/features/setting/types";

/** 两位补零（日期 / 时间格式化共用）。 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * 解析后端时间：约定为 UTC ISO（可能带 Z，也可能不带时区）。
 * 缺时区时按 UTC 处理，避免被当成设备本地时间而偏移。
 */
export function parseUtcDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  let text = String(value).trim();
  if (!text) return null;
  text = text.replace(" ", "T");
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    text += "Z";
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 时间格式化为本地 "YYYY-MM-DD HH:mm"（提交时间 / 回复时间共用）。 */
export function formatLocalTime(value: string | null | undefined): string {
  const date = parseUtcDate(value);
  if (!date) return "时间未知";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 来源端文案：web 网页 / mp 小程序（未知取值兜底为「其他」）。 */
export function feedbackAppLabel(app: FeedbackApp | string | null | undefined): string {
  if (app === "web") return "网页";
  if (app === "mp") return "小程序";
  return "其他";
}

/** 状态文案：pending 待回复 / replied 已回复（未知取值兜底为「待回复」）。 */
export function feedbackStatusLabel(
  status: FeedbackStatus | string | null | undefined,
): string {
  return status === "replied" ? "已回复" : "待回复";
}

/** 状态标签颜色：待回复 warning / 已回复 success。 */
export function feedbackStatusTagType(
  status: FeedbackStatus | string | null | undefined,
): "warning" | "success" {
  return status === "replied" ? "success" : "warning";
}

/**
 * 管理员视角的用户身份文案：昵称优先，其次 @账号名，再邮箱。
 * 用户可能已注销 / 字段为空，全部缺失时显示「未知用户」。
 */
export function feedbackUserLabel(item: {
  nickName?: string | null;
  userAccount?: string | null;
  email?: string | null;
}): string {
  const nickName = (item.nickName ?? "").trim();
  if (nickName) return nickName;
  const userAccount = (item.userAccount ?? "").trim();
  if (userAccount) return `@${userAccount}`;
  const email = (item.email ?? "").trim();
  if (email) return email;
  return "未知用户";
}
