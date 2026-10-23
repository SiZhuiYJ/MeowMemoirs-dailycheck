// utils/navigation.ts
import type { RouteLocationRaw } from "vue-router";

/**
 * 聊天页与用户主页之间传递「来源会话」的查询参数名。
 *
 * - /chat -> /user/:userId：进入主页时带上当前正在看的会话 ID；
 * - /user/:userId -> /chat：点「返回聊天」时原样带回来，由聊天页校验后决定是否打开。
 */
export const CHAT_CONVERSATION_QUERY = "conversationId";

/**
 * 把 query / 组件状态里的会话 ID 归一化成正整数。
 *
 * 只接受十进制数字字符串或正整数；非法值（空、负数、小数、科学计数法、数组里的
 * 多个值等）统一返回 0，调用方按「什么都没发生」处理，避免打开错误的会话。
 */
export function parseConversationId(value: unknown): number {
  if (Array.isArray(value)) {
    // 同一个 query key 出现多次时语义不明确，按非法值处理。
    if (value.length !== 1) return 0;
  }

  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : 0;
  }

  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return 0;

  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

/**
 * 用户主页地址。
 * 从聊天页进入时把当前会话 ID 一起带过去，供主页的「返回聊天」回到原会话。
 */
export function buildUserHomeRoute(
  userId: number,
  conversationId?: unknown,
): RouteLocationRaw {
  const path = `/user/${userId}`;
  const originConversationId = parseConversationId(conversationId);

  if (!originConversationId) return { path };

  return {
    path,
    query: { [CHAT_CONVERSATION_QUERY]: String(originConversationId) },
  };
}

/**
 * 聊天页地址。
 * 带 conversationId 时由 /chat 在「当前用户会话列表」内校验后再打开；不带则回到普通列表。
 */
export function buildChatConversationRoute(
  conversationId?: unknown,
): RouteLocationRaw {
  const targetConversationId = parseConversationId(conversationId);

  if (!targetConversationId) return { path: "/chat" };

  return {
    path: "/chat",
    query: { [CHAT_CONVERSATION_QUERY]: String(targetConversationId) },
  };
}
