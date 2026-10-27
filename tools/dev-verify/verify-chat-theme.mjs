/**
 * 聊天页日 / 夜主题验证（真实浏览器）。
 *
 *   node tools/dev-verify/verify-chat-theme.mjs
 *
 * 背景：聊天页原来把自己锁成固定浅色面，夜间模式下仍然显示白底。
 * 现在改成跟随全局 `data-theme`，颜色由 `styles/chat-theme.scss`
 * 的 `--chat-*` 变量切换。这个套件负责验证：
 *
 *   · 夜间：页面 / 面板 / 气泡 / 弹层都是深色，正文是浅色且对比度 >= 4.5；
 *   · 日间：页面 / 面板 / 气泡回到浅色，正文是深色且对比度 >= 4.5；
 *   · 暗色下会话详情弹层、「更多」下拉菜单也是深色；
 *   · 手机档（393x852）同样应用夜间色板。
 *
 * 前置条件（缺任何一个都会 SKIP 并返回 0）：
 *   1. dev server 在跑（默认 http://127.0.0.1:5173，DEV_VERIFY_WEB 可覆盖）；
 *   2. 本机有 chromium（chromium-browser / chromium / google-chrome，或 CHROMIUM_BIN）；
 *   3. api/appsettings.Development.json 可读且 Redis 可写（与其它套件一致）。
 *
 * 登录用 user 8（DEV_VERIFY_USER_ID 可改）。没有会话数据时只验证空态色板。
 * 会向 Redis 写一条开发令牌（access_token:8），与 e2e / 布局套件相同。
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { JWT_KEY, rcli } from "./config.mjs";

const WEB = process.env.DEV_VERIFY_WEB ?? "http://127.0.0.1:5173";
const USER_ID = Number(process.env.DEV_VERIFY_USER_ID ?? 8);
const DEBUG_PORT = Number(process.env.DEV_VERIFY_CHAT_THEME_CDP_PORT ?? 9337);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  <- ${detail}`}`);
};

const skip = (reason) => {
  console.log(`SKIP  聊天页主题验证：${reason}`);
  console.log("\n跳过（前置条件不满足）");
  process.exit(0);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 前置条件 ──────────────────────────────────────────────────────────────
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

function mintToken() {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: String(USER_ID),
    email: `user${USER_ID}@dev.local`,
    "http://schemas.microsoft.com/ws/2008/identity/claims/role": "user",
    jti: `dev${now}${USER_ID}`,
    typ: "access",
    iss: "MeowMemoirs",
    aud: "MeowMemoirs",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const token = `${signingInput}.${createHmac("sha256", JWT_KEY).update(signingInput).digest("base64url")}`;
  rcli("set", `access_token:${USER_ID}`, token);
  return token;
}

let token;
try {
  token = mintToken();
} catch (error) {
  skip(`无法伪造开发令牌 / 写 Redis：${String(error.message ?? error).split("\n")[0]}`);
}

// ── 启动 chromium ─────────────────────────────────────────────────────────
const profileDir = mkdtempSync(path.join(tmpdir(), "chat-theme-"));
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
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  return false;
}

if (!(await waitForCdp())) {
  killChrome();
  skip(`chromium 的 CDP 端口（${DEBUG_PORT}）没起来`);
}

// ── 极简 CDP 客户端 ───────────────────────────────────────────────────────
async function newPageTarget() {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent("about:blank")}`, {
    method: "PUT",
  });
  return await res.json();
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
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

const page = await newPageTarget();
if (!page?.webSocketDebuggerUrl) {
  killChrome();
  skip("无法创建调试页面");
}
const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

// 注入开发会话（pinia 持久化键为 MM-auth）
const expiresAt = new Date(Date.now() + 3600_000).toISOString();
await cdp.send("Page.navigate", { url: `${WEB}/login` });
await sleep(1800);
await cdp.evaluate(
  `localStorage.setItem('MM-auth', ${JSON.stringify(
    JSON.stringify({
      accessToken: token,
      refreshToken: token,
      accessTokenExpiresAt: expiresAt,
      refreshTokenExpiresAt: expiresAt,
    }),
  )}); localStorage.setItem('themeColor', '#e3c0df'); true`,
);

const MEASURE = `(() => {
  const parse = (value) => {
    if (!value) return null;
    const rgb = value.match(/rgba?\\(([^)]+)\\)/);
    if (rgb) {
      const parts = rgb[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    }
    const srgb = value.match(/color\\(srgb\\s+([^)]+)\\)/);
    if (srgb) {
      const parts = srgb[1].split(/[\\s/]+/).filter(Boolean).map(Number);
      return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: parts[3] ?? 1 };
    }
    return null;
  };
  const brightness = (color) => (color ? 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b : null);
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const relative = (color) => 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  const contrast = (a, b) => {
    if (!a || !b) return null;
    const [hi, lo] = [relative(a), relative(b)].sort((left, right) => right - left);
    return (hi + 0.05) / (lo + 0.05);
  };
  const style = (selector) => {
    const el = document.querySelector(selector);
    return el ? getComputedStyle(el) : null;
  };
  const colorOf = (selector) => {
    const cs = style(selector);
    return cs ? parse(cs.backgroundColor) : null;
  };
  const pageStyle = style('.chat-page');
  const pageColor = pageStyle ? parse(pageStyle.color) : null;
  const pageBg = pageStyle ? parse(pageStyle.backgroundImage) : null;
  const panelBg = colorOf('.left-panel');
  const bubbleStyle = style('.bubble');
  const bubbleBg = bubbleStyle ? parse(bubbleStyle.backgroundColor) : null;
  const bubbleColor = bubbleStyle ? parse(bubbleStyle.color) : null;
  const mineStyle = style('.msg-item.mine .bubble');
  const dialogStyle = style('.chat-dialog');
  const dialogBg = dialogStyle ? parse(dialogStyle.backgroundColor) : null;
  const dialogTitleStyle = style('.chat-dialog-title');
  const dialogTitle = dialogTitleStyle ? parse(dialogTitleStyle.color) : null;
  const metaBg = colorOf('.detail-meta');
  const memberBg = colorOf('.member-row');
  const menuBg = colorOf('.el-dropdown-menu');
  const menuStyle = style('.el-dropdown-menu__item');
  const root = getComputedStyle(document.documentElement);
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    darkClass: document.documentElement.classList.contains('dark'),
    pageBg: pageBg && { ...pageBg, brightness: brightness(pageBg) },
    pageText: pageColor && { ...pageColor, brightness: brightness(pageColor) },
    panelBg: panelBg && { ...panelBg, brightness: brightness(panelBg) },
    panelTextContrast: contrast(pageColor, panelBg),
    bubbleBg: bubbleBg && { ...bubbleBg, brightness: brightness(bubbleBg) },
    bubbleTextContrast: contrast(bubbleColor, bubbleBg),
    mineBubbleBg: mineStyle ? parse(mineStyle.backgroundColor) : null,
    dialogBg: dialogBg && { ...dialogBg, brightness: brightness(dialogBg) },
    dialogTitle: dialogTitle && { ...dialogTitle, brightness: brightness(dialogTitle) },
    metaBg: metaBg && { ...metaBg, brightness: brightness(metaBg) },
    memberBg: memberBg && { ...memberBg, brightness: brightness(memberBg) },
    menuBg: menuBg && { ...menuBg, brightness: brightness(menuBg) },
    menuText: menuStyle ? parse(menuStyle.color) : null,
    chatAccent: root.getPropertyValue('--chat-accent').trim(),
    themeStrong: root.getPropertyValue('--theme-color-strong').trim(),
    conversations: document.querySelectorAll('.conversation-list li').length,
    messages: document.querySelectorAll('.message-list .msg-item').length,
    hasDetailButton: !!document.querySelector('.open-detail'),
    hasMoreTrigger: !!document.querySelector('.social-dropdown-trigger'),
  };
})()`;

async function loadChat(theme) {
  await cdp.evaluate(`localStorage.setItem('theme', ${JSON.stringify(theme)}); true`);
  await cdp.send("Page.navigate", { url: `${WEB}/chat` });
  await sleep(4200);
  return await cdp.evaluate(MEASURE);
}

async function openFirstConversation() {
  const opened = await cdp.evaluate(
    `(() => { const li = document.querySelector('.conversation-list li'); if (!li) return false; li.click(); return true; })()`,
  );
  if (opened) await sleep(2500);
  return opened;
}

// ==============================================
// 夜间
// ==============================================
const dark = await loadChat("dark");
check("夜间：<html> 写入 data-theme=dark 与 .dark", dark.theme === "dark" && dark.darkClass === true, JSON.stringify(dark));
check(
  "夜间：页面背景是深色渐变",
  dark.pageBg && dark.pageBg.brightness < 40,
  dark.pageBg ? String(dark.pageBg.brightness) : "未取到背景",
);
check(
  "夜间：面板是深色半透明面",
  dark.panelBg && dark.panelBg.brightness < 60,
  dark.panelBg ? String(dark.panelBg.brightness) : "未取到面板",
);
check(
  "夜间：正文是浅色",
  dark.pageText && dark.pageText.brightness > 180,
  dark.pageText ? String(dark.pageText.brightness) : "未取到文字色",
);
check(
  "夜间：正文 / 面板对比度 >= 4.5",
  dark.panelTextContrast && dark.panelTextContrast >= 4.5,
  String(dark.panelTextContrast),
);
check(
  "夜间：聊天强调色跟随主题色阶（--chat-accent = --theme-color-strong）",
  dark.chatAccent === dark.themeStrong,
  `${dark.chatAccent} != ${dark.themeStrong}`,
);

if (dark.conversations === 0) {
  console.log("INFO  夜间：没有会话数据，跳过气泡 / 弹层断言（空态已通过）");
} else if (!(await openFirstConversation())) {
  check("夜间：打开第一个会话", false);
} else {
  const chat = await cdp.evaluate(MEASURE);
  if (chat.messages > 0) {
    check("夜间：普通气泡是深色", chat.bubbleBg && chat.bubbleBg.brightness < 80, JSON.stringify(chat.bubbleBg));
    check(
      "夜间：气泡文字 / 气泡对比度 >= 4.5",
      chat.bubbleTextContrast && chat.bubbleTextContrast >= 4.5,
      String(chat.bubbleTextContrast),
    );
    if (chat.mineBubbleBg) {
      check("夜间：自己的气泡也是深色", chat.mineBubbleBg && (0.2126 * chat.mineBubbleBg.r + 0.7152 * chat.mineBubbleBg.g + 0.0722 * chat.mineBubbleBg.b) < 100, JSON.stringify(chat.mineBubbleBg));
    }
  } else {
    console.log("INFO  夜间：会话没有消息，跳过气泡断言");
  }

  if (chat.hasDetailButton) {
    await cdp.evaluate(`document.querySelector('.open-detail').click(); true`);
    await sleep(1200);
    const dialog = await cdp.evaluate(MEASURE);
    check(
      "夜间：会话详情弹层是深色",
      dialog.dialogBg && dialog.dialogBg.brightness < 90,
      JSON.stringify(dialog.dialogBg),
    );
    check(
      "夜间：弹层标题是浅色",
      dialog.dialogTitle && dialog.dialogTitle.brightness > 180,
      JSON.stringify(dialog.dialogTitle),
    );
    check(
      "夜间：信息卡 / 成员行是深色",
      (!dialog.metaBg || dialog.metaBg.brightness < 90) && (!dialog.memberBg || dialog.memberBg.brightness < 90),
      JSON.stringify({ meta: dialog.metaBg, member: dialog.memberBg }),
    );
    await cdp.evaluate(`document.querySelector('.chat-dialog-close')?.click(); true`);
    await sleep(700);
  }

  if (chat.hasMoreTrigger) {
    await cdp.evaluate(`document.querySelector('.social-dropdown-trigger').click(); true`);
    await sleep(900);
    const menu = await cdp.evaluate(MEASURE);
    check(
      "夜间：「更多」下拉菜单是深色",
      menu.menuBg && menu.menuBg.brightness < 90,
      JSON.stringify(menu.menuBg),
    );
    check(
      "夜间：下拉菜单文字是浅色",
      menu.menuText && (0.2126 * menu.menuText.r + 0.7152 * menu.menuText.g + 0.0722 * menu.menuText.b) > 150,
      JSON.stringify(menu.menuText),
    );
    await cdp.evaluate(`document.body.click(); true`);
    await sleep(400);
  }
}

// ==============================================
// 日间
// ==============================================
const light = await loadChat("light");
check("日间：<html> 写入 data-theme=light 且没有 .dark", light.theme === "light" && light.darkClass === false, JSON.stringify(light));
check(
  "日间：页面背景是浅色",
  light.pageBg && light.pageBg.brightness > 200,
  light.pageBg ? String(light.pageBg.brightness) : "未取到背景",
);
check(
  "日间：面板是浅色",
  light.panelBg && light.panelBg.brightness > 200,
  light.panelBg ? String(light.panelBg.brightness) : "未取到面板",
);
check(
  "日间：正文是深色",
  light.pageText && light.pageText.brightness < 80,
  light.pageText ? String(light.pageText.brightness) : "未取到文字色",
);
check(
  "日间：正文 / 面板对比度 >= 4.5",
  light.panelTextContrast && light.panelTextContrast >= 4.5,
  String(light.panelTextContrast),
);
check(
  "日间：聊天强调色跟随主题色阶（--chat-accent = --theme-color-strong）",
  light.chatAccent === light.themeStrong,
  `${light.chatAccent} != ${light.themeStrong}`,
);

if (light.conversations > 0 && (await openFirstConversation())) {
  const chat = await cdp.evaluate(MEASURE);
  if (chat.messages > 0) {
    check("日间：普通气泡是浅色", chat.bubbleBg && chat.bubbleBg.brightness > 200, JSON.stringify(chat.bubbleBg));
    check(
      "日间：气泡文字 / 气泡对比度 >= 4.5",
      chat.bubbleTextContrast && chat.bubbleTextContrast >= 4.5,
      String(chat.bubbleTextContrast),
    );
  }
}

// ==============================================
// 手机档：同样应用夜间色板
// ==============================================
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 393,
  height: 852,
  deviceScaleFactor: 1,
  mobile: true,
});
const mobile = await loadChat("dark");
check("夜间手机档：页面背景仍是深色", mobile.pageBg && mobile.pageBg.brightness < 40, JSON.stringify(mobile.pageBg));
await cdp.send("Emulation.clearDeviceMetricsOverride");

killChrome();
console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
