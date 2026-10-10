// utils/chat.ts
import type { AvatarSources } from "@/utils/avatar";
import {
  getConversationAvatarSources as buildConversationAvatarSources,
  getConversationAvatarUrl as buildConversationAvatarUrl,
  getUserAvatarSources,
  getUserAvatarUrl,
} from "@/utils/avatar";
import { parseMessageExtra } from "./fileMeta";
import type {
  UserRole,
  ConversationSummary,
  ConversationDetail,
  ConversationMember,
  MessageReference,
  MessageSummary,
} from "../types";

/**
 * 判断两个日期是否为同一天
 */
export function isSameDay(date1: string | Date, date2: string | Date): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function getMessageSenderName(
  message?: Pick<MessageReference, "senderNickName" | "senderUserId"> | null,
): string {
  if (!message) return "系统";
  if (message.senderNickName?.trim()) return message.senderNickName.trim();
  if (!message.senderUserId) return "系统";
  return String(message.senderUserId);
}

export function getRecalledMessageText(
  message?: Pick<MessageReference, "senderNickName" | "senderUserId"> | null,
): string {
  return `${getMessageSenderName(message)} 撤回了一条消息`;
}

function formatDurationMinutesZh(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return "0 分钟";
  }

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days > 0) parts.push(`${days} 天`);
  if (hours > 0) parts.push(`${hours} 小时`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} 分钟`);

  return parts.join("");
}

export function formatSystemMessageText(content?: string | null): string {
  const normalized = content?.trim();
  if (!normalized) return "[系统通知]";

  const inviteMatch = normalized.match(/^(.+?) invited (.+?) to the group$/i);
  if (inviteMatch) {
    return `${inviteMatch[1]} 邀请 ${inviteMatch[2]} 加入了群聊`;
  }

  const kickMatch = normalized.match(/^(.+?) removed (.+?) from the group$/i);
  if (kickMatch) {
    return `${kickMatch[1]} 将 ${kickMatch[2]} 移出了群聊`;
  }

  const muteMatch = normalized.match(/^(.+?) muted (.+?) for (\d+) minute\(s\)$/i);
  if (muteMatch) {
    return `${muteMatch[1]} 已将 ${muteMatch[2]} 禁言 ${formatDurationMinutesZh(Number(muteMatch[3]))}`;
  }

  const unmuteMatch = normalized.match(/^(.+?) removed the mute for (.+)$/i);
  if (unmuteMatch) {
    return `${unmuteMatch[1]} 已解除 ${unmuteMatch[2]} 的禁言`;
  }

  const disbandMatch = normalized.match(/^(.+?) disbanded the group$/i);
  if (disbandMatch) {
    return `${disbandMatch[1]} 已解散群聊`;
  }

  return normalized;
}

function resolvePreviewMessage(
  source?: ConversationSummary | MessageSummary | MessageReference | null,
): MessageSummary | MessageReference | null {
  if (!source) return null;
  return "conversationType" in source ? source.lastMessage ?? null : source;
}

/**
 * 格式化日期分隔线文本
 * - 本年：MM/DD
 * - 非本年：YYYY/MM/DD
 */
export function formatDateSeparator(date: string | Date): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const currentYear = new Date().getFullYear();

  return year === currentYear ? `${month}/${day}` : `${year}/${month}/${day}`;
}

/**
 * 格式化聊天时间（仅显示时:分）
 */
export function formatChatTimeShort(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 格式化聊天时间
 */
export function formatChatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 获取成员显示名称
 */
export function getMemberDisplayName(
  member?: ConversationMember | null,
): string {
  if (!member) return "";
  return (
    member.nickName?.trim() ||
    member.userAccount?.trim() ||
    String(member.userId)
  );
}

/**
 * 获取单聊对方的成员信息
 */
export function getDirectPeer(
  detail: ConversationDetail | null,
  currentUserId?: number,
): ConversationMember | null {
  if (!detail || detail.conversationType !== "direct" || !currentUserId)
    return null;
  return detail.members.find((m) => m.userId !== currentUserId) ?? null;
}

/**
 * 获取会话显示标题
 */
export function getConversationDisplayTitle(
  item: ConversationSummary | ConversationDetail,
  currentUserId?: number,
): string {
  if (item.conversationType === "direct") {
    // 对于详情，优先使用已有 title 或计算对方昵称
    if ("members" in item) {
      const explicitTitle = item.friendRemark?.trim() || item.title?.trim();
      if (explicitTitle) return explicitTitle;

      const peer = getDirectPeer(item, currentUserId);
      return peer ? getMemberDisplayName(peer) : `单聊 #${item.id}`;
    }
    // 对于摘要，后端可能已设置 title
    return (
      item.title || item.userAccount || String(item.avatarUserId || item.id)
    );
  }
  return item.title || `群聊 #${item.id}`;
}

/**
 * 获取会话头像 URL
 */
export function getConversationAvatarUrl(
  item: ConversationSummary | ConversationDetail,
): string {
  const avatarKey = item.avatarKey;
  if (!avatarKey) return "";
  if (item.conversationType === "group") {
    return buildConversationAvatarUrl(item.id, avatarKey);
  }
  const avatarUserId = item.avatarUserId;
  if (!avatarUserId) return "";
  return getUserAvatarUrl(avatarUserId, avatarKey);
}

export function getConversationAvatarSources(
  item: ConversationSummary | ConversationDetail,
): AvatarSources {
  const avatarKey = item.avatarKey;
  if (!avatarKey) {
    return { src: "", thumbnailSrc: "" };
  }

  if (item.conversationType === "group") {
    return buildConversationAvatarSources(item.id, avatarKey);
  }

  return getUserAvatarSources(item.avatarUserId, avatarKey);
}

/**
 * 获取会话头像占位文字（首字母）
 */
export function getConversationAvatarText(
  item: ConversationSummary | ConversationDetail,
): string {
  if (item.conversationType === "direct") {
    return getConversationDisplayTitle(item).slice(0, 1);
  }
  return (item.title || `群#${item.id}`).slice(0, 1);
}

/**
 * 获取成员头像 URL
 */
export function getMemberAvatarUrl(member: ConversationMember): string {
  if (!member.avatarKey) return "";
  return getUserAvatarUrl(member.userId, member.avatarKey);
}

export function getMemberAvatarSources(member: ConversationMember): AvatarSources {
  return getUserAvatarSources(member.userId, member.avatarKey);
}

/**
 * 根据发送者 ID 获取会话中对应成员的头像 URL
 */
export function getMemberAvatarBySender(
  detail: ConversationDetail,
  senderUserId: number,
): string {
  const member = detail.members.find((m) => m.userId === senderUserId);
  return member ? getMemberAvatarUrl(member) : "";
}

export function getMemberAvatarSourcesBySender(
  detail: ConversationDetail,
  senderUserId: number,
): AvatarSources {
  const member = detail.members.find((m) => m.userId === senderUserId);
  return member ? getMemberAvatarSources(member) : { src: "", thumbnailSrc: "" };
}

/**
 * 获取消息预览文本
 */
export function getMessagePreview(
  source?: ConversationSummary | MessageSummary | MessageReference | null,
): string {
  const message = resolvePreviewMessage(source);
  if (!message) return "暂无消息";
  if (message.isRecalled) return getRecalledMessageText(message);

  if (message.messageType === "text") {
    return message.content?.trim() || "[空消息]";
  }

  if (message.messageType === "system") {
    return formatSystemMessageText(message.content);
  }

  const fileExtra = parseMessageExtra(message.extra);
  const fileLabelMap: Record<"image" | "video" | "audio" | "file", string> = {
    image: "[图片]",
    video: "[视频]",
    audio: "[音频]",
    file: "[文件]",
  };

  const fileLabel = fileLabelMap[message.messageType as keyof typeof fileLabelMap];
  if (fileLabel) {
    return fileExtra?.fileName ? `${fileLabel} ${fileExtra.fileName}` : fileLabel;
  }

  return message.content?.trim() || `[${message.messageType}]`;
}

/**
 * 群成员权限映射
 */
export const groupRoleMap: Record<UserRole, string> = {
  owner: "群主",
  admin: "管理员",
  member: "成员",
};
