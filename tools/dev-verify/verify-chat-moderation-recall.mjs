/**
 * 群聊「管理撤回」验证（真实 HTTP 接口）。
 *
 *   node tools/dev-verify/verify-chat-moderation-recall.mjs
 *
 * 规则：
 *   · 群主可撤回管理员 / 成员的消息；
 *   · 管理员仅可撤回普通成员的消息，不能动群主或其它管理员；
 *   · 普通成员 / 单聊不能撤回别人的消息；
 *   · 管理撤回会写一条系统提示：
 *       {群主|管理员} {操作人昵称} 撤回了 {被撤回消息的成员昵称} 的消息
 *   · 撤回自己的消息仍然受 5 分钟窗口约束，且不写系统提示。
 *
 * 脚本会创建一个临时群聊，结束后用 SQL 物理删除（连同消息/成员），
 * 不会改动现有会话。
 */
import { createHmac } from "node:crypto";
import { API, JWT_KEY, dbq } from "./config.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  <- ${detail}`}`);
};

const OWNER = 8;
const ADMIN = 11;
const MEMBER = 14;

function mintToken(userId) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: String(userId),
    email: `user${userId}@dev.local`,
    "http://schemas.microsoft.com/ws/2008/identity/claims/role": "user",
    jti: `modrecall${now}${userId}`,
    typ: "access",
    iss: "MeowMemoirs",
    aud: "MeowMemoirs",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  return `${signingInput}.${createHmac("sha256", JWT_KEY).update(signingInput).digest("base64url")}`;
}

const tokens = {
  [OWNER]: mintToken(OWNER),
  [ADMIN]: mintToken(ADMIN),
  [MEMBER]: mintToken(MEMBER),
};

async function request(userId, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tokens[userId]}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function ok(userId, method, path, body) {
  const res = await request(userId, method, path, body);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${method} ${path} -> ${res.status}: ${typeof res.data === "string" ? res.data : JSON.stringify(res.data)}`);
  }
  return res.data;
}

const getMessages = (userId, conversationId) =>
  ok(userId, "GET", `/mm/chat/conversations/${conversationId}/messages?pageSize=100`);

function findSystem(messages, operatorName, targetName, roleLabel) {
  const expected = `${roleLabel} ${operatorName} 撤回了 ${targetName} 的消息`;
  return messages.find((m) => m.messageType === "system" && (m.content ?? "").includes(expected));
}

let conversationId = 0;
try {
  // ── 准备：临时群 + 管理员 ────────────────────────────────────────────
  const created = await ok(OWNER, "POST", "/mm/chat/conversations", {
    conversationType: "group",
    title: `mod-recall-e2e-${Date.now()}`,
    memberUserIds: [ADMIN, MEMBER],
  });
  conversationId = created.id;
  console.log(`临时群聊 #${conversationId}`);

  await ok(OWNER, "POST", `/mm/chat/conversations/${conversationId}/members/${ADMIN}/role`, {
    memberRole: "admin",
  });

  const detail = await ok(OWNER, "GET", `/mm/chat/conversations/${conversationId}`);
  const nameOf = (id) => {
    const member = detail.members.find((m) => m.userId === id);
    return member?.nickName || member?.userAccount || String(id);
  };
  const ownerName = nameOf(OWNER);
  const adminName = nameOf(ADMIN);
  const memberName = nameOf(MEMBER);
  console.log(`名称：群主=${ownerName} 管理员=${adminName} 成员=${memberName}`);

  // ── 群主撤回管理员的消息 ─────────────────────────────────────────────
  const adminMessage = await ok(ADMIN, "POST", `/mm/chat/conversations/${conversationId}/messages`, {
    messageType: "text",
    content: "admin-message",
  });
  const systemCountBeforeOwnerRecall = (await getMessages(OWNER, conversationId))
    .filter((m) => m.messageType === "system").length;
  await ok(OWNER, "POST", `/mm/chat/messages/${adminMessage.id}/recall`);

  let messages = await getMessages(OWNER, conversationId);
  const recalledAdminMessage = messages.find((m) => m.id === adminMessage.id);
  const ownerAdminPrompt = `群主 ${ownerName} 撤回了 ${adminName} 的消息`;
  check("群主撤回管理员消息成功", recalledAdminMessage?.isRecalled === true);
  check(
    "群主撤回管理员的提示挂在原消息上（recallPrompt）",
    recalledAdminMessage?.recallPrompt === ownerAdminPrompt,
    JSON.stringify(recalledAdminMessage ?? null),
  );
  check("记录执行撤回的用户ID", recalledAdminMessage?.recalledByUserId === OWNER, String(recalledAdminMessage?.recalledByUserId));
  check("撤回后消息内容清空", recalledAdminMessage?.content === null, String(recalledAdminMessage?.content));
  check(
    "管理撤回不新增底部系统消息",
    messages.filter((m) => m.messageType === "system").length === systemCountBeforeOwnerRecall,
    `${systemCountBeforeOwnerRecall} -> ${messages.filter((m) => m.messageType === "system").length}`,
  );

  // ── 群主撤回普通成员的消息 ───────────────────────────────────────────
  const memberMessage = await ok(MEMBER, "POST", `/mm/chat/conversations/${conversationId}/messages`, {
    messageType: "text",
    content: "member-message",
  });
  await ok(OWNER, "POST", `/mm/chat/messages/${memberMessage.id}/recall`);
  messages = await getMessages(OWNER, conversationId);
  const recalledMemberMessage = messages.find((m) => m.id === memberMessage.id);
  check("群主撤回成员消息成功", recalledMemberMessage?.isRecalled === true);
  check(
    "群主撤回成员的提示格式正确",
    recalledMemberMessage?.recallPrompt === `群主 ${ownerName} 撤回了 ${memberName} 的消息`,
    JSON.stringify(recalledMemberMessage ?? null),
  );

  // ── 管理员撤回普通成员的消息 ─────────────────────────────────────────
  const memberMessage2 = await ok(MEMBER, "POST", `/mm/chat/conversations/${conversationId}/messages`, {
    messageType: "text",
    content: "member-message-2",
  });
  await ok(ADMIN, "POST", `/mm/chat/messages/${memberMessage2.id}/recall`);
  messages = await getMessages(OWNER, conversationId);
  const recalledMemberMessage2 = messages.find((m) => m.id === memberMessage2.id);
  check("管理员撤回成员消息成功", recalledMemberMessage2?.isRecalled === true);
  check(
    "管理员撤回成员的提示格式正确",
    recalledMemberMessage2?.recallPrompt === `管理员 ${adminName} 撤回了 ${memberName} 的消息`,
    JSON.stringify(recalledMemberMessage2 ?? null),
  );

  // ── 管理员不能撤回群主的消息 ─────────────────────────────────────────
  const ownerMessage = await ok(OWNER, "POST", `/mm/chat/conversations/${conversationId}/messages`, {
    messageType: "text",
    content: "owner-message",
  });
  const recallOwner = await request(ADMIN, "POST", `/mm/chat/messages/${ownerMessage.id}/recall`);
  check("管理员撤回群主消息被拒（403）", recallOwner.status === 403, `${recallOwner.status} ${JSON.stringify(recallOwner.data)}`);

  // ── 管理员不能撤回另一个管理员的消息 ─────────────────────────────────
  await ok(OWNER, "POST", `/mm/chat/conversations/${conversationId}/members/${MEMBER}/role`, {
    memberRole: "admin",
  });
  const otherAdminMessage = await ok(MEMBER, "POST", `/mm/chat/conversations/${conversationId}/messages`, {
    messageType: "text",
    content: "other-admin-message",
  });
  const recallOtherAdmin = await request(ADMIN, "POST", `/mm/chat/messages/${otherAdminMessage.id}/recall`);
  check("管理员撤回另一个管理员的消息被拒（403）", recallOtherAdmin.status === 403, `${recallOtherAdmin.status} ${JSON.stringify(recallOtherAdmin.data)}`);

  // 把 14 改回普通成员，方便验证「成员不能撤回别人消息」
  await ok(OWNER, "POST", `/mm/chat/conversations/${conversationId}/members/${MEMBER}/role`, {
    memberRole: "member",
  });

  // ── 普通成员不能撤回别人的消息 ───────────────────────────────────────
  const adminMessage2 = await ok(ADMIN, "POST", `/mm/chat/conversations/${conversationId}/messages`, {
    messageType: "text",
    content: "admin-message-2",
  });
  const recallByMember = await request(MEMBER, "POST", `/mm/chat/messages/${adminMessage2.id}/recall`);
  check("普通成员撤回别人消息被拒（403）", recallByMember.status === 403, `${recallByMember.status} ${JSON.stringify(recallByMember.data)}`);

  // ── 自己超过 5 分钟的消息不能撤回 ────────────────────────────────────
  const oldOwnMessage = await ok(OWNER, "POST", `/mm/chat/conversations/${conversationId}/messages`, {
    messageType: "text",
    content: "owner-old-message",
  });
  dbq(`UPDATE chat_messages SET created_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE) WHERE id = ${oldOwnMessage.id}`);
  const recallOldOwn = await request(OWNER, "POST", `/mm/chat/messages/${oldOwnMessage.id}/recall`);
  check("自己超过 5 分钟的消息不能撤回（400）", recallOldOwn.status === 400, `${recallOldOwn.status} ${JSON.stringify(recallOldOwn.data)}`);

  // ── 自己 5 分钟内的消息可撤回，且不产生管理撤回提示 ─────────────────
  const recentOwnMessage = await ok(OWNER, "POST", `/mm/chat/conversations/${conversationId}/messages`, {
    messageType: "text",
    content: "owner-recent-message",
  });
  messages = await getMessages(OWNER, conversationId);
  const beforeOwnRecallSystemCount = messages.filter((m) => m.messageType === "system").length;
  await ok(OWNER, "POST", `/mm/chat/messages/${recentOwnMessage.id}/recall`);
  messages = await getMessages(OWNER, conversationId);
  const recalledOwnMessage = messages.find((m) => m.id === recentOwnMessage.id);
  check("自己的消息 5 分钟内可撤回", recalledOwnMessage?.isRecalled === true);
  check(
    "自己撤回自己的消息不会生成管理撤回提示",
    (recalledOwnMessage?.recallPrompt ?? null) === null,
    JSON.stringify(recalledOwnMessage ?? null),
  );
  check(
    "自己撤回自己的消息不会新增系统消息",
    messages.filter((m) => m.messageType === "system").length === beforeOwnRecallSystemCount,
    `${beforeOwnRecallSystemCount} -> ${messages.filter((m) => m.messageType === "system").length}`,
  );

  // ── 会话列表预览显示被撤回消息上的提示 ───────────────────────────────
  const finalMemberMessage = await ok(MEMBER, "POST", `/mm/chat/conversations/${conversationId}/messages`, {
    messageType: "text",
    content: "final-member-message",
  });
  await ok(OWNER, "POST", `/mm/chat/messages/${finalMemberMessage.id}/recall`);

  const conversations = await ok(OWNER, "GET", "/mm/chat/conversations");
  const summary = conversations.find((c) => c.id === conversationId);
  const expectedFinalPrompt = `群主 ${ownerName} 撤回了 ${memberName} 的消息`;
  check(
    "会话列表预览显示原消息位置的管理撤回提示",
    summary?.lastMessage?.id === finalMemberMessage.id
      && summary.lastMessage.isRecalled === true
      && summary.lastMessage.recallPrompt === expectedFinalPrompt
      && summary.lastMessage.content === null,
    JSON.stringify(summary?.lastMessage ?? null),
  );

  // ── 其他成员看到的是同一条被撤回消息上的提示 ─────────────────────────
  const memberView = await getMessages(MEMBER, conversationId);
  const recalledFinalForMember = memberView.find((m) => m.id === finalMemberMessage.id);
  check("其他成员能看到被撤回消息的占位", recalledFinalForMember?.isRecalled === true);
  check(
    "其他成员也能看到原位置的提示",
    recalledFinalForMember?.recallPrompt === expectedFinalPrompt,
    JSON.stringify(recalledFinalForMember ?? null),
  );
  check(
    "其他成员侧没有额外的底部系统提示",
    !memberView.some((m) => m.messageType === "system" && (m.content ?? "").includes("撤回了")),
    JSON.stringify(memberView.filter((m) => m.messageType === "system").map((m) => m.content)),
  );

  console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
} catch (error) {
  failures += 1;
  console.error("FAIL  套件异常:", error);
} finally {
  if (conversationId) {
    try {
      dbq(`DELETE FROM chat_conversations WHERE id = ${conversationId}`);
      console.log(`已清理临时群聊 #${conversationId}`);
    } catch (error) {
      console.error("清理临时群聊失败:", error);
    }
  }
}
process.exit(failures === 0 ? 0 : 1);
