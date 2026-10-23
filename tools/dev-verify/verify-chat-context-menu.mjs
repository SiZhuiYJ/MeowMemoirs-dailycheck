/**
 * 聊天页右键菜单验证（真实浏览器 / CDP）。
 *
 *   node tools/dev-verify/verify-chat-context-menu.mjs
 *
 * 覆盖：
 *   1. 右键图片消息 -> 「复制图片 / 撤回 / 预览 / 删除」菜单；
 *   2. 右键用户头像 -> 「艾特 / 查看主页」，艾特会写入输入框；
 *   3. 右键会话列表项 -> 「置顶 / 消息免打扰 / 删除会话」，
 *      置顶与免打扰各切换一次并复原，删除只验证确认框、不真正删除；
 *   4. 头像菜单「查看主页」跳转 /user/:id，主页「发消息」回到并选中对应会话。
 *
 * 前置条件（缺失时 SKIP 并返回 0）：
 *   - dev server（默认 5173，DEV_VERIFY_WEB 可覆盖）
 *   - chromium（CHROMIUM_BIN 可指定）
 *   - 可伪造开发令牌（api/appsettings.Development.json）且 Redis 可写
 *
 * 使用 user 8 与 conversation 10（预置群聊）；会在收起菜单前点击「取消」，
 * 不会真正删除会话。置顶/免打扰切换后会再次切换复原。
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { API, JWT_KEY, dbq, rcli } from "./config.mjs";

const WEB = process.env.DEV_VERIFY_WEB ?? "http://127.0.0.1:5173";
const USER_ID = Number(process.env.DEV_VERIFY_USER_ID ?? 8);
const CONVERSATION_TITLE = process.env.DEV_VERIFY_CONVERSATION_TITLE ?? "妙妙屋";
const NON_FRIEND_USER_ID = Number(process.env.DEV_VERIFY_NON_FRIEND_USER_ID ?? 12);
const DEBUG_PORT = Number(process.env.DEV_VERIFY_CDP_PORT ?? 9334);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  <- ${detail}`}`);
};

const skip = (reason) => {
  console.log(`SKIP  聊天页右键菜单验证：${reason}`);
  console.log("\n跳过（前置条件不满足）");
  process.exit(0);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (typeof WebSocket === "undefined") skip("当前 Node 没有全局 WebSocket（需要 Node >= 22）");

function findChromium() {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  for (const name of ["chromium-browser", "chromium", "google-chrome", "google-chrome-stable"]) {
    try {
      execFileSync("sh", ["-c", `command -v ${name}`], { stdio: "ignore" });
      return name;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

const chromium = findChromium();
if (!chromium) skip("找不到 chromium（可用 CHROMIUM_BIN 指定）");

try {
  const res = await fetch(WEB, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) skip(`dev server 返回 ${res.status}（${WEB}）`);
} catch {
  skip(`dev server 不可达（${WEB}），先跑 npm run dev`);
}

function mintToken(userId = USER_ID) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: String(userId),
    email: `user${userId}@dev.local`,
    "http://schemas.microsoft.com/ws/2008/identity/claims/role": "user",
    jti: `devctx${now}${userId}`,
    typ: "access",
    iss: "MeowMemoirs",
    aud: "MeowMemoirs",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const token = `${signingInput}.${createHmac("sha256", JWT_KEY).update(signingInput).digest("base64url")}`;
  rcli("set", `access_token:${userId}`, token);
  return token;
}

let token;
try {
  token = mintToken();
} catch (error) {
  skip(`无法伪造开发令牌 / 写 Redis：${String(error.message ?? error).split("\n")[0]}`);
}

async function api(authToken, method, apiPath, body) {
  const res = await fetch(`${API}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${apiPath} -> ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

// 临时群聊：用于验证「管理撤回提示出现在原消息位置」，不碰 conversation 10 的真实数据。
let tempRecallGroupId = 0;
let tempRecallTitle = "";
let tempRecallTargetId = 0;
let tempRecallBeforeId = 0;
let tempRecallAfterId = 0;
let tempRecallExpectedPrompt = "";

process.on("exit", () => {
  if (!tempRecallGroupId) return;
  try {
    dbq(`DELETE FROM chat_conversations WHERE id = ${tempRecallGroupId}`);
  } catch {
    /* 清理失败不阻塞测试 */
  }
});

try {
  const memberToken = mintToken(11);
  tempRecallTitle = `ctx-recall-ui-${Date.now()}`;
  const tempGroup = await api(token, "POST", "/mm/chat/conversations", {
    conversationType: "group",
    title: tempRecallTitle,
    memberUserIds: [11],
  });
  tempRecallGroupId = tempGroup.id;

  const before = await api(memberToken, "POST", `/mm/chat/conversations/${tempGroup.id}/messages`, {
    messageType: "text",
    content: "before-moderation-recall",
  });
  const target = await api(memberToken, "POST", `/mm/chat/conversations/${tempGroup.id}/messages`, {
    messageType: "text",
    content: "target-moderation-recall",
  });
  const after = await api(memberToken, "POST", `/mm/chat/conversations/${tempGroup.id}/messages`, {
    messageType: "text",
    content: "after-moderation-recall",
  });
  tempRecallBeforeId = before.id;
  tempRecallTargetId = target.id;
  tempRecallAfterId = after.id;

  await api(token, "POST", `/mm/chat/messages/${target.id}/recall`);

  const detail = await api(token, "GET", `/mm/chat/conversations/${tempGroup.id}`);
  const nameOf = (id) => {
    const member = detail.members.find((m) => m.userId === id);
    return member?.nickName || member?.userAccount || String(id);
  };
  tempRecallExpectedPrompt = `群主 ${nameOf(USER_ID)} 撤回了 ${nameOf(11)} 的消息`;
} catch (error) {
  check("创建管理撤回临时群", false, String(error.message ?? error));
}

const profileDir = mkdtempSync(path.join(tmpdir(), "chat-context-menu-"));
const chrome = spawn(
  chromium,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

function killChrome() {
  try {
    chrome.kill("SIGKILL");
  } catch {
    /* 已退出 */
  }
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

process.on("exit", killChrome);
process.on("SIGINT", () => {
  killChrome();
  process.exit(130);
});

async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return await res.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  return null;
}

if (!(await waitForCdp())) {
  killChrome();
  skip(`chromium 的 CDP 端口（${DEBUG_PORT}）没起来`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = (this.id += 1);
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

const page = await fetch(
  `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent("about:blank")}`,
  { method: "PUT" },
).then((res) => res.json());

if (!page?.webSocketDebuggerUrl) {
  killChrome();
  skip("无法创建调试页面");
}

const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

const expiresAt = new Date(Date.now() + 3600_000).toISOString();
await cdp.send("Page.navigate", { url: `${WEB}/login` });
await sleep(2000);
await cdp.evaluate(
  `localStorage.setItem('MM-auth', ${JSON.stringify(
    JSON.stringify({
      accessToken: token,
      refreshToken: token,
      accessTokenExpiresAt: expiresAt,
      refreshTokenExpiresAt: expiresAt,
    }),
  )}); true`,
);

async function waitFor(expression, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(expression)) return true;
    await sleep(150);
  }
  return false;
}

const dispatchContextMenu = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, buttons: 2,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }));
  return true;
})()`;

const menuLabels = `[...document.querySelectorAll('.chat-context-menu .chat-context-menu__label')].map((el) => el.textContent.trim())`;
const clickMenuLabel = (label) => `(() => {
  const target = [...document.querySelectorAll('.chat-context-menu__item')]
    .find((el) => el.textContent.includes(${JSON.stringify(label)}));
  if (!target) return false;
  target.click();
  return true;
})()`;
const closeMenu = `(() => {
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  return true;
})()`;

const openConversationMenu = `(() => {
  const li = [...document.querySelectorAll('.conversation-list li')]
    .find((el) => el.textContent.includes(${JSON.stringify(CONVERSATION_TITLE)}));
  if (!li) return false;
  const rect = li.getBoundingClientRect();
  li.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, buttons: 2,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }));
  return true;
})()`;

// ── 进入会话 ─────────────────────────────────────────────────────────────
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await cdp.send("Page.navigate", { url: `${WEB}/chat` });
await sleep(3500);

check("聊天页已挂载", await waitFor(`Boolean(document.querySelector('.conversation-list'))`, 8000));

const openedConversation = await cdp.evaluate(`(() => {
  const items = [...document.querySelectorAll('.conversation-list li')];
  const target = items.find((li) => li.textContent.includes(${JSON.stringify(CONVERSATION_TITLE)})) || items[0];
  if (!target) return false;
  target.click();
  return true;
})()`);
check(`找到并打开会话（${CONVERSATION_TITLE}）`, openedConversation);

const imageReady = await waitFor(`Boolean(document.querySelector('.message-list .image-message'))`, 10000);
check("会话中渲染出图片消息", imageReady);

// ── 1. 图片消息右键菜单 ──────────────────────────────────────────────────
if (imageReady) {
  await cdp.evaluate(dispatchContextMenu(".message-list .image-message"));
  await sleep(250);
  check("右键图片 -> 出现自定义菜单", await cdp.evaluate(`Boolean(document.querySelector('.chat-context-menu'))`));

  const labels = await cdp.evaluate(menuLabels);
  for (const label of ["复制图片", "撤回", "预览", "删除"]) {
    check(`图片菜单包含「${label}」`, labels.includes(label), JSON.stringify(labels));
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 5, y: 5, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 5, button: "left", clickCount: 1 });
  await sleep(300);
  check("点击菜单外 -> 菜单关闭", !(await cdp.evaluate(`Boolean(document.querySelector('.chat-context-menu'))`)));
} else {
  console.log("INFO  没有图片消息，跳过图片菜单断言");
}

// ── 1b. 文本消息右键菜单（不再只有图片有菜单）──────────────────────────
const textMenuOpened = await cdp.evaluate(dispatchContextMenu(".message-list .msg-item .bubble"));
check("右键文本消息", textMenuOpened);
if (textMenuOpened) {
  await sleep(250);
  const textLabels = await cdp.evaluate(menuLabels);
  for (const label of ["复制文字", "引用", "撤回", "删除"]) {
    check(`文本菜单包含「${label}」`, textLabels.includes(label), JSON.stringify(textLabels));
  }
  check("文本菜单不含「复制图片」", !textLabels.includes("复制图片"), JSON.stringify(textLabels));

  const clickedQuote = await cdp.evaluate(clickMenuLabel("引用"));
  await sleep(300);
  check("点击「引用」后出现引用条", clickedQuote && (await cdp.evaluate(`Boolean(document.querySelector('.replying-banner'))`)));

  const cancelledQuote = await cdp.evaluate(`(() => {
    const button = document.querySelector('.replying-cancel');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await sleep(300);
  check("取消引用", cancelledQuote && !(await cdp.evaluate(`Boolean(document.querySelector('.replying-banner'))`)));
}

// 群主（user 8）右键「别人的」文本消息：菜单里应有撤回（管理撤回）
const ownerOtherMenu = await cdp.evaluate(`(() => {
  const item = [...document.querySelectorAll('.message-list .msg-item:not(.mine)')]
    .find((el) => el.querySelector('.bubble'));
  if (!item) return false;
  const bubble = item.querySelector('.bubble');
  const rect = bubble.getBoundingClientRect();
  bubble.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, buttons: 2,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }));
  return true;
})()`);
if (ownerOtherMenu) {
  await sleep(250);
  const ownerOtherLabels = await cdp.evaluate(menuLabels);
  check("群主右键他人文本消息显示「撤回」", ownerOtherLabels.includes("撤回"), JSON.stringify(ownerOtherLabels));
  await cdp.evaluate(closeMenu);
  await sleep(200);
}

// ── 1c. 系统消息 / 文件类消息（存在时）也应有菜单 ──────────────────────
// 文件/系统消息通常比最近 50 条更早，先往上翻几页把它们加载出来。
for (let attempt = 0; attempt < 4; attempt += 1) {
  const hasFileLike = await cdp.evaluate(
    `Boolean(document.querySelector('.message-list .document-message, .message-list .audio-message, .message-list .video-message'))`,
  );
  const hasSystem = await cdp.evaluate(`Boolean(document.querySelector('.message-list .system-notice-item'))`);
  if (hasFileLike && hasSystem) break;

  const scrolled = await cdp.evaluate(`(() => {
    const wrap = document.querySelector('.main-panel .el-scrollbar__wrap');
    if (!wrap) return false;
    wrap.scrollTop = 0;
    wrap.dispatchEvent(new Event('scroll', { bubbles: true }));
    return true;
  })()`);
  if (!scrolled) break;
  await sleep(1600);
}

const systemReady = await cdp.evaluate(`(() => {
  const item = [...document.querySelectorAll('.message-list .system-notice-item')]
    .find((el) => el.querySelector('.system-notice-body'));
  if (!item) return false;
  const rect = item.getBoundingClientRect();
  item.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, buttons: 2,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }));
  return true;
})()`);
if (systemReady) {
  await sleep(250);
  const systemLabels = await cdp.evaluate(menuLabels);
  check("系统消息菜单包含「复制内容」", systemLabels.includes("复制内容"), JSON.stringify(systemLabels));
  check("系统消息菜单包含「删除」", systemLabels.includes("删除"), JSON.stringify(systemLabels));
  await cdp.evaluate(closeMenu);
  await sleep(200);
}

const fileMessageSelector = ".message-list .msg-item .audio-message, .message-list .msg-item .document-message, .message-list .msg-item .video-message";
const fileMenuOpened = await cdp.evaluate(dispatchContextMenu(fileMessageSelector));
if (fileMenuOpened) {
  await sleep(250);
  const fileLabels = await cdp.evaluate(menuLabels);
  check("文件类消息菜单包含「预览/播放」", fileLabels.some((label) => label.includes("预览") || label.includes("播放")), JSON.stringify(fileLabels));
  check("文件类消息菜单包含「下载」", fileLabels.includes("下载"), JSON.stringify(fileLabels));
  check("文件类消息菜单包含「引用」", fileLabels.includes("引用"), JSON.stringify(fileLabels));
  check("文件类消息菜单包含「删除」", fileLabels.includes("删除"), JSON.stringify(fileLabels));
  await cdp.evaluate(closeMenu);
  await sleep(200);
}

// ── 2. 头像右键菜单 ──────────────────────────────────────────────────────
const avatarReady = await cdp.evaluate(`(() => {
  const avatar = document.querySelector('.message-list .msg-item:not(.mine) .message-avatar');
  if (!avatar) return false;
  const rect = avatar.getBoundingClientRect();
  avatar.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, buttons: 2,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }));
  return true;
})()`);
check("找到并右键他人头像", avatarReady);

if (avatarReady) {
  await sleep(250);
  const labels = await cdp.evaluate(menuLabels);
  check("头像菜单包含「艾特」", labels.includes("艾特"), JSON.stringify(labels));
  check("头像菜单包含「查看主页」", labels.includes("查看主页"), JSON.stringify(labels));

  const clickedMention = await cdp.evaluate(clickMenuLabel("艾特"));
  await sleep(350);
  check("点击「艾特」", clickedMention);
  const mentionState = await cdp.evaluate(`(() => {
    const textarea = document.querySelector('.composer .el-textarea__inner');
    return textarea ? { value: textarea.value, focused: document.activeElement === textarea } : null;
  })()`);
  check(
    "艾特写入输入框（以 @ 开头）",
    Boolean(mentionState && mentionState.value.trim().startsWith("@")),
    JSON.stringify(mentionState),
  );
  check("艾特后输入框保持聚焦", mentionState?.focused === true, JSON.stringify(mentionState));

  // 清空输入框，避免影响后面的测试
  await cdp.evaluate(`(() => {
    const textarea = document.querySelector('.composer .el-textarea__inner');
    if (!textarea) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, '');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

// ── 3. 会话列表右键菜单 ──────────────────────────────────────────────────
const listMenuOpen = await cdp.evaluate(openConversationMenu);
check("右键会话列表项", listMenuOpen);
await sleep(250);

if (listMenuOpen) {
  const labels = await cdp.evaluate(menuLabels);
  const pinLabel = labels.find((label) => label.includes("置顶"));
  const muteLabel = labels.find((label) => label.includes("免打扰"));
  check("会话菜单包含置顶/取消置顶", Boolean(pinLabel), JSON.stringify(labels));
  check("会话菜单包含消息免打扰/取消", Boolean(muteLabel), JSON.stringify(labels));
  check("会话菜单包含「删除会话」", labels.includes("删除会话"), JSON.stringify(labels));

  const itemState = () => cdp.evaluate(`(() => {
    const li = [...document.querySelectorAll('.conversation-list li')]
      .find((el) => el.textContent.includes(${JSON.stringify(CONVERSATION_TITLE)}));
    return li ? { pinned: Boolean(li.querySelector('.pinned-icon')), muted: Boolean(li.querySelector('.muted-icon')) } : null;
  })()`);

  // —— 置顶：切一次再切回来（复原）——
  const before = await itemState();
  if (pinLabel && before) {
    await cdp.evaluate(clickMenuLabel(pinLabel));
    await sleep(900);
    const afterPin = await itemState();
    check(`点击「${pinLabel}」后置顶状态翻转`, Boolean(afterPin) && afterPin.pinned === !before.pinned,
      `before=${JSON.stringify(before)} after=${JSON.stringify(afterPin)}`);

    // 等第一次请求彻底落地再开菜单：连续两次切换若并发，服务端的处理顺序不保证
    await sleep(1500);
    await cdp.evaluate(openConversationMenu);
    await sleep(200);
    const revertLabels = await cdp.evaluate(menuLabels);
    const revertPinLabel = revertLabels.find((label) => label.includes("置顶"));
    await cdp.evaluate(clickMenuLabel(revertPinLabel));
    await sleep(900);
    const restored = await itemState();
    check("置顶状态已复原", Boolean(restored) && restored.pinned === before.pinned,
      `want=${JSON.stringify(before)} got=${JSON.stringify(restored)}`);

    // —— 消息免打扰：切一次再切回来 ——
    await cdp.evaluate(openConversationMenu);
    await sleep(200);
    const muteLabels = await cdp.evaluate(menuLabels);
    const currentMuteLabel = muteLabels.find((label) => label.includes("免打扰"));
    const beforeMute = await itemState();
    await cdp.evaluate(clickMenuLabel(currentMuteLabel));
    await sleep(900);
    const afterMute = await itemState();
    check(`点击「${currentMuteLabel}」后免打扰状态翻转`, Boolean(afterMute) && afterMute.muted === !beforeMute.muted,
      `before=${JSON.stringify(beforeMute)} after=${JSON.stringify(afterMute)}`);

    await sleep(1500);
    await cdp.evaluate(openConversationMenu);
    await sleep(200);
    const revertMuteLabels = await cdp.evaluate(menuLabels);
    const revertMuteLabel = revertMuteLabels.find((label) => label.includes("免打扰"));
    await cdp.evaluate(clickMenuLabel(revertMuteLabel));
    await sleep(900);
    const restoredMute = await itemState();
    check("免打扰状态已复原", Boolean(restoredMute) && restoredMute.muted === beforeMute.muted,
      `want=${JSON.stringify(beforeMute)} got=${JSON.stringify(restoredMute)}`);
  }

  // —— 删除：只确认弹窗出现，不真正删除 ——
  await cdp.evaluate(openConversationMenu);
  await sleep(200);
  const clickedDelete = await cdp.evaluate(clickMenuLabel("删除会话"));
  await sleep(500);
  check("点击「删除会话」", clickedDelete);
  const confirmState = await cdp.evaluate(`(() => {
    const box = document.querySelector('.el-message-box');
    return box ? box.textContent : '';
  })()`);
  check("删除会话弹出确认框（说明仅自己不可见）", confirmState.includes("仅对你不可见"), confirmState.slice(0, 120));
  const cancelled = await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('.el-message-box__btns button')]
      .find((el) => el.textContent.includes('取消'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  check("取消删除", cancelled);
  await sleep(400);
}

// ── 4. 查看主页 -> 发消息 回到会话 ───────────────────────────────────────
const profileAvatarReady = await cdp.evaluate(`(() => {
  const avatar = document.querySelector('.message-list .msg-item:not(.mine) .message-avatar');
  if (!avatar) return false;
  const rect = avatar.getBoundingClientRect();
  avatar.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, buttons: 2,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }));
  return true;
})()`);

if (profileAvatarReady) {
  await sleep(250);
  await cdp.evaluate(clickMenuLabel("查看主页"));
  await sleep(2200);
  const profilePath = await cdp.evaluate(`location.pathname`);
  check("「查看主页」跳转到 /user/:id", /^\/user\/\d+$/.test(profilePath), profilePath);
  check("用户主页渲染出资料卡", await cdp.evaluate(`Boolean(document.querySelector('.user-home-card'))`));
  check("用户主页显示昵称", await cdp.evaluate(`Boolean(document.querySelector('.user-home-identity h2')?.textContent.trim())`));
  check("用户主页有「发消息」按钮", await cdp.evaluate(`[...document.querySelectorAll('.user-home-composer button')].some((el) => el.textContent.includes('发消息'))`));

  // 底部操作栏应与聊天页 composer 一样悬浮，滚动内容用 el-scrollbar 并给操作栏让位。
  const homeLayout = await cdp.evaluate(`(() => {
    const page = document.querySelector('.user-home-page');
    const panel = document.querySelector('.user-home-panel');
    const bar = document.querySelector('.user-home-composer');
    const scrollbar = document.querySelector('.user-home-scrollbar');
    const wrap = scrollbar?.querySelector('.el-scrollbar__wrap');
    const content = document.querySelector('.user-home-scroll-content');
    if (!page || !panel || !bar || !scrollbar || !wrap || !content) return null;
    const pageRect = page.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    return {
      position: getComputedStyle(bar).position,
      bottomGap: Math.round(pageRect.bottom - barRect.bottom),
      barHeight: Math.round(barRect.height),
      contentPadBottom: Math.round(parseFloat(getComputedStyle(content).paddingBottom)),
      panelRadius: Math.round(parseFloat(getComputedStyle(panel).borderRadius)),
      panelBackground: getComputedStyle(panel).backgroundColor,
      barInsidePanel: panel.contains(bar),
      scrollInsidePanel: panel.contains(scrollbar),
      barWithinPanel: barRect.right <= panelRect.right + 1 && barRect.bottom <= panelRect.bottom + 1,
      hasScrollbar: true,
    };
  })()`);
  check("用户主页底部操作栏为悬浮定位", homeLayout?.position === "absolute", JSON.stringify(homeLayout));
  check("用户主页底部操作栏贴近页面底部", Boolean(homeLayout) && homeLayout.bottomGap >= 0 && homeLayout.bottomGap <= 24, JSON.stringify(homeLayout));
  check("滚动内容为底部操作栏留出空间", Boolean(homeLayout) && homeLayout.contentPadBottom >= homeLayout.barHeight, JSON.stringify(homeLayout));
  check("用户主页使用 el-scrollbar 滚动条", homeLayout?.hasScrollbar === true, JSON.stringify(homeLayout));
  check(
    "按钮与滚动条包裹在白色圆角卡片内",
    Boolean(homeLayout)
      && homeLayout.panelRadius >= 6
      && homeLayout.panelBackground !== "rgba(0, 0, 0, 0)"
      && homeLayout.barInsidePanel === true
      && homeLayout.scrollInsidePanel === true
      && homeLayout.barWithinPanel === true,
    JSON.stringify(homeLayout),
  );

  // 复制账号：把 Clipboard API 置为不可用，验证会走 execCommand 兜底（局域网 http 下常见）。
  const copyProbe = await cdp.evaluate(`(() => {
    const account = document.querySelector('.user-home-account span')?.textContent.trim() ?? '';
    window.__legacyCopiedAccount = '';
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    } catch (error) {
      return { error: String(error), account };
    }
    document.execCommand = (command) => {
      if (command !== 'copy') return false;
      const textarea = document.querySelector('textarea[readonly]');
      window.__legacyCopiedAccount = textarea?.value ?? '';
      return true;
    };
    const button = [...document.querySelectorAll('.user-home-account button')]
      .find((el) => el.textContent.includes('复制账号'));
    if (!button) return { error: 'copy button not found', account };
    button.click();
    return { account };
  })()`);
  await sleep(400);
  const copiedAccount = await cdp.evaluate(`window.__legacyCopiedAccount`);
  check(
    "复制账号在 Clipboard API 不可用时仍能成功",
    Boolean(copyProbe?.account) && copiedAccount === copyProbe.account,
    JSON.stringify({ copyProbe, copiedAccount }),
  );

  const clickedChat = await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('.user-home-composer button')]
      .find((el) => el.textContent.includes('发消息'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  check("点击「发消息」", clickedChat);
  await sleep(3000);
  check("回到 /chat", (await cdp.evaluate(`location.pathname`)) === "/chat");
  check("返回后自动选中会话（聊天头部有标题）",
    await cdp.evaluate(`Boolean(document.querySelector('.chat-header h3')?.textContent.trim())`));
}

// ── 4.1 单聊详情点击头像 -> 用户主页 ───────────────────────────────────
const openedDirectDetail = await cdp.evaluate(`(() => {
  const button = document.querySelector('.open-detail');
  if (!button) return false;
  button.click();
  return true;
})()`);
check("打开单聊详情", openedDirectDetail);
await sleep(900);

const directAvatarInfo = await cdp.evaluate(`(() => {
  const avatar = document.querySelector('.direct-friend-avatar');
  if (!avatar) return null;
  return { userId: Number(avatar.dataset.userId) };
})()`);
const clickedDirectAvatar = await cdp.evaluate(`(() => {
  const avatar = document.querySelector('.direct-friend-avatar');
  if (!avatar) return false;
  avatar.click();
  return true;
})()`);
await sleep(2200);
const directProfilePath = await cdp.evaluate(`location.pathname`);
check(
  "点击单聊详情头像跳转到对应用户主页",
  clickedDirectAvatar && Boolean(directAvatarInfo?.userId) && directProfilePath === `/user/${directAvatarInfo.userId}`,
  JSON.stringify({ directAvatarInfo, directProfilePath }),
);
check("单聊对方主页渲染出资料卡", await cdp.evaluate(`Boolean(document.querySelector('.user-home-card'))`));

const backFromDirectProfile = await cdp.evaluate(`(() => {
  const button = [...document.querySelectorAll('.user-home-composer button')]
    .find((el) => el.textContent.includes('返回聊天'));
  if (!button) return false;
  button.click();
  return true;
})()`);
check("从单聊对方主页返回聊天", backFromDirectProfile);
await sleep(1800);

// ── 4a. 群聊详情点击成员头像 -> 用户主页 ───────────────────────────────
const reopenedGroup = await cdp.evaluate(`(() => {
  const li = [...document.querySelectorAll('.conversation-list li')]
    .find((el) => el.textContent.includes(${JSON.stringify(CONVERSATION_TITLE)}));
  if (!li) return false;
  li.click();
  return true;
})()`);
check("重新打开群聊会话", reopenedGroup);
await sleep(1800);

const openedDetail = await cdp.evaluate(`(() => {
  const button = document.querySelector('.open-detail');
  if (!button) return false;
  button.click();
  return true;
})()`);
check("打开群聊详情", openedDetail);
await sleep(900);

const memberAvatarInfo = await cdp.evaluate(`(() => {
  const avatar = document.querySelector('.member-avatar-link');
  if (!avatar) return null;
  return { userId: Number(avatar.dataset.userId) };
})()`);
const clickedMemberAvatar = await cdp.evaluate(`(() => {
  const avatar = document.querySelector('.member-avatar-link');
  if (!avatar) return false;
  avatar.click();
  return true;
})()`);
await sleep(2200);
const memberProfilePath = await cdp.evaluate(`location.pathname`);
check(
  "点击群成员头像跳转到对应用户主页",
  clickedMemberAvatar && Boolean(memberAvatarInfo?.userId) && memberProfilePath === `/user/${memberAvatarInfo.userId}`,
  JSON.stringify({ memberAvatarInfo, memberProfilePath }),
);
check("群成员主页渲染出资料卡", await cdp.evaluate(`Boolean(document.querySelector('.user-home-card'))`));

// 返回聊天，后面的临时群/普通成员测试还要继续在 /chat 里进行。
const backToChat = await cdp.evaluate(`(() => {
  const button = [...document.querySelectorAll('.user-home-composer button')]
    .find((el) => el.textContent.includes('返回聊天'));
  if (!button) return false;
  button.click();
  return true;
})()`);
check("从群成员主页返回聊天", backToChat);
await sleep(1800);

// ── 4c. 搜索好友结果头像 -> 用户主页；非好友主页 -> 添加好友 ───────────
const openedSocialMenu = await cdp.evaluate(`(() => {
  const button = document.querySelector('.social-dropdown-trigger button');
  if (!button) return false;
  button.click();
  return true;
})()`);
check("打开社交操作菜单", openedSocialMenu);
await sleep(400);

const clickedAddFriendMenu = await cdp.evaluate(`(() => {
  const item = [...document.querySelectorAll('.el-dropdown-menu__item')]
    .find((el) => el.textContent.includes('添加好友'));
  if (!item) return false;
  item.click();
  return true;
})()`);
check("打开添加好友搜索弹窗", clickedAddFriendMenu);
await sleep(700);

const searchDialogReady = await cdp.evaluate(
  `Boolean(document.querySelector('.friend-search-panel .search-toolbar .el-input__inner'))`,
);
check("搜索好友弹窗已打开", searchDialogReady);
if (searchDialogReady) {
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.friend-search-panel .search-toolbar .el-input__inner');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'user_2gjfaaa');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(200);

  const clickedSearch = await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('.friend-search-panel .search-toolbar button')]
      .find((el) => el.textContent.includes('搜索'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  check("点击搜索好友", clickedSearch);

  const searchResultReady = await waitFor(`Boolean(document.querySelector('.search-result-avatar-link'))`, 8000);
  check("搜索结果显示用户头像", searchResultReady);
  if (searchResultReady) {
    const searchAvatarInfo = await cdp.evaluate(`(() => {
      const avatar = document.querySelector('.search-result-avatar-link');
      if (!avatar) return null;
      const info = { userId: Number(avatar.dataset.userId) };
      avatar.click();
      return info;
    })()`);
    await sleep(2200);
    const searchProfilePath = await cdp.evaluate(`location.pathname`);
    check(
      "点击搜索结果头像跳转到用户主页",
      Boolean(searchAvatarInfo?.userId) && searchProfilePath === `/user/${searchAvatarInfo.userId}`,
      JSON.stringify({ searchAvatarInfo, searchProfilePath }),
    );
    check("搜索结果用户主页渲染出资料卡", await cdp.evaluate(`Boolean(document.querySelector('.user-home-card'))`));

    const backFromSearchProfile = await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('.user-home-composer button')]
        .find((el) => el.textContent.includes('返回聊天'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    check("从搜索结果用户主页返回聊天", backFromSearchProfile);
    await sleep(1800);
  }
}

// 非好友主页：应出现「添加好友」，发送后变为「申请已发送」
try {
  dbq(`DELETE FROM user_friend_requests WHERE requester_user_id = ${USER_ID} AND receiver_user_id = ${NON_FRIEND_USER_ID} AND request_status = 'pending'`);
} catch (error) {
  console.error("清理好友申请失败（继续）:", error);
}
await cdp.send("Page.navigate", { url: `${WEB}/user/${NON_FRIEND_USER_ID}` });
await sleep(2200);

const addFriendButtonText = await cdp.evaluate(`(() => {
  const button = [...document.querySelectorAll('.user-home-composer button')]
    .find((el) => el.textContent.includes('添加好友'));
  return button ? button.textContent.trim() : null;
})()`);
check("非好友主页显示「添加好友」按钮", Boolean(addFriendButtonText), String(addFriendButtonText));

const clickedAddFriend = await cdp.evaluate(`(() => {
  const button = [...document.querySelectorAll('.user-home-composer button')]
    .find((el) => el.textContent.includes('添加好友'));
  if (!button) return false;
  button.click();
  return true;
})()`);
check("点击「添加好友」", clickedAddFriend);
await sleep(1200);

const addFriendState = await cdp.evaluate(`(() => {
  const button = [...document.querySelectorAll('.user-home-composer button')]
    .find((el) => el.textContent.includes('申请已发送') || el.textContent.includes('已添加好友') || el.textContent.includes('发送中'));
  return button ? { text: button.textContent.trim(), disabled: button.disabled } : null;
})()`);
check(
  "发送好友申请后按钮状态更新",
  Boolean(addFriendState) && (addFriendState.text.includes('申请已发送') || addFriendState.text.includes('已添加好友')),
  JSON.stringify(addFriendState),
);

try {
  dbq(`DELETE FROM user_friend_requests WHERE requester_user_id = ${USER_ID} AND receiver_user_id = ${NON_FRIEND_USER_ID} AND request_status = 'pending'`);
  check("好友申请测试数据已清理", true);
} catch (error) {
  check("好友申请测试数据已清理", false, String(error));
}

await cdp.send("Page.navigate", { url: `${WEB}/chat` });
await sleep(2500);

// ── 4b. 管理撤回提示必须出现在原消息位置，而不是底部 ───────────────────
if (tempRecallGroupId) {
  const openedTempGroup = await cdp.evaluate(`(() => {
    const items = [...document.querySelectorAll('.conversation-list li')];
    const target = items.find((li) => li.textContent.includes(${JSON.stringify(tempRecallTitle)}));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  check("打开管理撤回临时群", openedTempGroup);
  await sleep(2400);

  const recalledText = await cdp.evaluate(
    `document.querySelector('[data-message-id="${tempRecallTargetId}"] .recalled-message')?.textContent.trim() ?? ''`,
  );
  check(
    "管理撤回提示显示在原消息位置",
    recalledText === tempRecallExpectedPrompt,
    `want=${JSON.stringify(tempRecallExpectedPrompt)} got=${JSON.stringify(recalledText)}`,
  );

  const order = await cdp.evaluate(
    `[...document.querySelectorAll('.message-list .msg-item[data-message-id]')].map((el) => Number(el.dataset.messageId))`,
  );
  check(
    "被撤回消息保持原顺序（before < target < after）",
    order.indexOf(tempRecallTargetId) > order.indexOf(tempRecallBeforeId)
      && order.indexOf(tempRecallAfterId) > order.indexOf(tempRecallTargetId),
    JSON.stringify({ before: tempRecallBeforeId, target: tempRecallTargetId, after: tempRecallAfterId, order }),
  );

  const systemTexts = await cdp.evaluate(
    `[...document.querySelectorAll('.message-list .system-notice-body .system-notice-text')].map((el) => el.textContent.trim())`,
  );
  const messageCount = await cdp.evaluate(
    `document.querySelectorAll('.message-list .msg-item[data-message-id]').length`,
  );
  check(
    "没有在会话底部追加额外系统消息",
    !systemTexts.some((text) => text.includes(tempRecallExpectedPrompt)) && messageCount === 3,
    `messages=${messageCount} systems=${JSON.stringify(systemTexts)}`,
  );

  try {
    dbq(`DELETE FROM chat_conversations WHERE id = ${tempRecallGroupId}`);
    tempRecallGroupId = 0;
  } catch (error) {
    console.error("清理管理撤回临时群失败:", error);
  }
  check("管理撤回临时群已清理", tempRecallGroupId === 0);
}

// ── 5. 普通成员：右键别人的消息不应出现「撤回」 ───────────────────────
// 切到 user 11（conversation 10 里的普通成员），重新加载页面。
try {
  const memberToken = mintToken(11);
  const memberExpiresAt = new Date(Date.now() + 3600_000).toISOString();
  await cdp.evaluate(
    `localStorage.setItem('MM-auth', ${JSON.stringify(
      JSON.stringify({
        accessToken: memberToken,
        refreshToken: memberToken,
        accessTokenExpiresAt: memberExpiresAt,
        refreshTokenExpiresAt: memberExpiresAt,
      }),
    )}); true`,
  );
  await cdp.send("Page.navigate", { url: `${WEB}/chat` });
  await sleep(3500);

  const openedAsMember = await cdp.evaluate(`(() => {
    const items = [...document.querySelectorAll('.conversation-list li')];
    const target = items.find((li) => li.textContent.includes(${JSON.stringify(CONVERSATION_TITLE)})) || items[0];
    if (!target) return false;
    target.click();
    return true;
  })()`);
  check("普通成员重新登录并打开会话", openedAsMember);
  await sleep(2500);

  const memberOtherMenu = await cdp.evaluate(`(() => {
    const item = [...document.querySelectorAll('.message-list .msg-item:not(.mine)')]
      .find((el) => el.querySelector('.bubble'));
    if (!item) return false;
    const bubble = item.querySelector('.bubble');
    const rect = bubble.getBoundingClientRect();
    bubble.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, buttons: 2,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
    return true;
  })()`);
  if (memberOtherMenu) {
    await sleep(250);
    const memberOtherLabels = await cdp.evaluate(menuLabels);
    check(
      "普通成员右键他人文本消息不显示「撤回」",
      !memberOtherLabels.includes("撤回"),
      JSON.stringify(memberOtherLabels),
    );
    check("普通成员右键他人文本消息仍可复制/引用/删除",
      ["复制文字", "引用", "删除"].every((label) => memberOtherLabels.includes(label)),
      JSON.stringify(memberOtherLabels));
    await cdp.evaluate(closeMenu);
  }
} catch (error) {
  check("普通成员撤回菜单验证", false, String(error.message ?? error));
}

await cdp.send("Emulation.clearDeviceMetricsOverride");
killChrome();

console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
