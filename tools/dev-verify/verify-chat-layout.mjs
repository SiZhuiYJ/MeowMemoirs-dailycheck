/**
 * 聊天页「三档布局」验证（真实浏览器）。
 *
 *   node tools/dev-verify/verify-chat-layout.mjs
 *
 * 为什么需要它：verify-device-layout.mjs 只验证**判定规则**与 SCSS 源码里的声明，
 * 管不到「真实浏览器里控件到底多高」「平板是不是真的并排两栏」—— 而这正是需求本身：
 *
 *   | 档位       | 宽度         | 结构               | 控件 / 间距 |
 *   | 大屏电脑端 | > 1200       | 双栏               | 32px / 12px |
 *   | 平板端     | 600 ~ 1200   | 双栏（两个一起展示）| 24px / 6px  |
 *   | 手机端     | <= 600（不够扁） | 单栏（二选一）   | 24px / 6px  |
 *
 * 另外「宽度虽小但够扁」（宽/高 >= 1.5，典型是手机横屏 480x320 / 568x320）
 * 不按单栏排，而是归到平板端走**双栏** —— 横向还有余量，两栏就比单栏好用。
 *
 * 做法：用 CDP 驱动 headless chromium 打开真实页面，逐个视口量 getBoundingClientRect，
 * 断言档位、控件高度、间距、单/双栏、无横向溢出 —— 判定用的是真 CSS 生效后的值。
 *
 * ## 前置条件（缺任何一个都会 SKIP 并返回 0，不会让 run-all 变红）
 *
 * 1. 前端 dev server 在跑：默认 http://127.0.0.1:5173，可用 DEV_VERIFY_WEB 覆盖；
 * 2. 本机有 chromium（chromium-browser / chromium / google-chrome，或 CHROMIUM_BIN）；
 * 3. 开发令牌可伪造（读 api/appsettings.Development.json）且 Redis 可写；
 * 4. Node >= 22（用全局 WebSocket 直连 CDP，不额外装 puppeteer）。
 *
 * 登录用 user 8（DEV_VERIFY_USER_ID 可改）。没有会话数据时只验证空态。
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { JWT_KEY, rcli } from "./config.mjs";

const WEB = process.env.DEV_VERIFY_WEB ?? "http://127.0.0.1:5173";
const USER_ID = Number(process.env.DEV_VERIFY_USER_ID ?? 8);
const DEBUG_PORT = Number(process.env.DEV_VERIFY_CDP_PORT ?? 9333);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  <- ${detail}`}`);
};

const skip = (reason) => {
  console.log(`SKIP  聊天页布局验证：${reason}`);
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

/** 伪造开发令牌并写进 Redis —— 与 e2e-chat.mjs 同一套做法。 */
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
const profileDir = mkdtempSync(path.join(tmpdir(), "chat-layout-"));
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

/** 等 CDP 端口起来（最多约 20s）。 */
async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
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

// ── 极简 CDP 客户端（只用到 Page / Runtime / Emulation）─────────────────────
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

// ── 注入开发会话（pinia 持久化键为 MM-auth）──────────────────────────────
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

/** 在页面里量一遍布局。 */
const MEASURE = `(() => {
  const vis = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const page = document.querySelector('.chat-page');
  if (!page) return { error: 'chat page not mounted' };
  const cs = getComputedStyle(page);
  const controls = [...document.querySelectorAll('.chat-page .el-button:not(.is-link), .chat-page .el-input__wrapper, .chat-page .el-select__wrapper, .chat-page .el-textarea__inner')]
    .filter(vis)
    .map((el) => Math.round(el.getBoundingClientRect().height));
  const list = document.querySelector('.conversation-list');
  const msgList = document.querySelector('.message-list');
  const sidebar = document.querySelector('.left-panel');
  const main = document.querySelector('.main-panel');
  const sidebarVis = vis(sidebar);
  const mainVis = vis(main);
  const sideBySide = sidebarVis && mainVis
    ? main.getBoundingClientRect().x >= sidebar.getBoundingClientRect().right - 0.5
    : null;
  return {
    tier: document.documentElement.getAttribute('data-device'),
    controlH: Math.round(parseFloat(cs.getPropertyValue('--chat-control-h'))),
    gap: Math.round(parseFloat(cs.getPropertyValue('--chat-gap'))),
    controlHeights: [...new Set(controls)],
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    listGap: list ? Math.round(parseFloat(getComputedStyle(list).gap)) : null,
    msgGap: msgList ? Math.round(parseFloat(getComputedStyle(msgList).gap)) : null,
    sidebarVis,
    mainVis,
    sideBySide,
    itemCount: document.querySelectorAll('.conversation-list li').length,
    // 会话列表头像 vs 行高：行高由两行文字决定（40~48px），头像应该贴着它，
    // 而不是跟着列表宽度一路缩到 32px、在行里空出一大截
    // （见 ConversationSidebarList.vue 里 device-mobile 那段注释）。
    listItems: [...document.querySelectorAll('.conversation-list li')].slice(0, 6).map((li) => {
      const rect = li.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(li).paddingTop) || 0;
      const avatar = li.querySelector('.conversation-avatar');
      const round1 = (n) => Math.round(n * 10) / 10;
      return {
        content: round1(rect.height - pad * 2),
        avatar: avatar ? round1(avatar.getBoundingClientRect().height) : 0,
      };
    }),
    backBtnVisible: vis(document.querySelector('.back-to-list')),
    // 圆形按钮必须是正方形：EP 的 .el-button--small.is-circle 把宽度写死成
    // --el-button-size（24px），而高度被聊天页接管成 --chat-control-h（桌面 32px），
    // 曾经出现 24×32 的「椭圆下载按钮」（图片消息 hover 覆盖层里那个）。
    circleButtons: [...document.querySelectorAll('.chat-page .el-button.is-circle')]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { w: Math.round(rect.width), h: Math.round(rect.height) };
      }),
    msgCount: document.querySelectorAll('.message-list .msg-item').length,
  };
})()`;

const VIEWPORTS = [
  { name: "大屏电脑 1920x1080", width: 1920, height: 1080, tier: "desktop", columns: 2 },
  { name: "大屏电脑 1366x768", width: 1366, height: 768, tier: "desktop", columns: 2 },
  { name: "大屏边界 1201x800", width: 1201, height: 800, tier: "desktop", columns: 2 },
  { name: "平板 1200x800", width: 1200, height: 800, tier: "tablet", columns: 2 },
  { name: "平板竖屏 820x1180", width: 820, height: 1180, tier: "tablet", columns: 2 },
  { name: "平板竖屏 768x1024", width: 768, height: 1024, tier: "tablet", columns: 2 },
  { name: "横屏手机 852x393", width: 852, height: 393, tier: "tablet", columns: 2 },
  { name: "手机边界 601x900", width: 601, height: 900, tier: "tablet", columns: 2 },
  { name: "手机 600x900", width: 600, height: 900, tier: "phone", columns: 1 },
  // 宽扁小屏：宽度在手机档，但宽/高 >= 1.5 → 破格双栏（手机横屏就属于这一类）
  { name: "小屏横屏 600x400（宽/高 1.50）", width: 600, height: 400, tier: "tablet", columns: 2 },
  { name: "手机横屏 568x320（宽/高 1.78）", width: 568, height: 320, tier: "tablet", columns: 2 },
  { name: "手机横屏 480x320（宽/高 1.50）", width: 480, height: 320, tier: "tablet", columns: 2 },
  { name: "小窗 480x400（宽/高 1.20）", width: 480, height: 400, tier: "phone", columns: 1 },
  { name: "手机 iPhone 15 393x852", width: 393, height: 852, tier: "phone", columns: 1 },
  { name: "手机 360x800", width: 360, height: 800, tier: "phone", columns: 1 },
  { name: "手机 320x568", width: 320, height: 568, tier: "phone", columns: 1 },
];

for (const vp of VIEWPORTS) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: 1,
    mobile: vp.columns === 1,
  });
  await cdp.send("Page.navigate", { url: `${WEB}/chat` });
  await sleep(3800);

  const listState = await cdp.evaluate(MEASURE);
  if (listState?.error) {
    check(`${vp.name} 页面挂载`, false, listState.error);
    continue;
  }

  const wantControl = vp.tier === "desktop" ? 32 : 24;
  const wantGap = vp.tier === "desktop" ? 12 : 6;
  const tag = `[${vp.name}]`;

  check(`${tag} 档位 = ${vp.tier}`, listState.tier === vp.tier, `实际 ${listState.tier}`);
  check(
    `${tag} 控件高度 ${wantControl}px（按钮/输入框/下拉框一致）`,
    listState.controlHeights.length > 0 && listState.controlHeights.every((h) => h === wantControl),
    `实测 ${JSON.stringify(listState.controlHeights)}`,
  );
  check(
    `${tag} 间距 ${wantGap}px（--chat-gap / 会话列表行间距）`,
    listState.gap === wantGap && listState.listGap === wantGap,
    `变量 ${listState.gap}，列表 ${listState.listGap}`,
  );
  check(`${tag} 无横向溢出`, listState.overflowX <= 1, `溢出 ${listState.overflowX}px`);

  if (vp.columns === 1) {
    check(`${tag} 手机档只显示一个界面（会话列表）`, listState.sidebarVis && !listState.mainVis, `sidebar=${listState.sidebarVis} main=${listState.mainVis}`);
  } else {
    check(`${tag} 平板/电脑档两个界面并排`, listState.sidebarVis && listState.mainVis && listState.sideBySide === true, `sidebar=${listState.sidebarVis} main=${listState.mainVis} 并排=${listState.sideBySide}`);
  }

  if (listState.itemCount === 0) {
    console.log(`INFO  ${tag} 没有会话数据，跳过聊天界面断言（空态已通过）`);
    continue;
  }

  // 头像不能比「行内容高」小太多：行里有 13~15px 空白就说明头像缩过头了
  // （旧实现平板档侧栏 300px 时行内容高 48.5、头像只有 34.3）。
  const worstGap = Math.max(...listState.listItems.map((it) => it.content - it.avatar));
  check(
    `${tag} 头像贴着行高（行内容高 - 头像 <= 8px）`,
    listState.listItems.every((it) => it.avatar > 0 && it.content - it.avatar <= 8),
    `最大差 ${worstGap.toFixed(1)}px（${JSON.stringify(listState.listItems)}）`,
  );

  // 点开第一个会话：手机档应切到聊天界面，平板/电脑档应仍是双栏
  await cdp.evaluate(`(() => { const li = document.querySelector('.conversation-list li'); if (li) li.click(); return true; })()`);
  await sleep(2200);

  const chatState = await cdp.evaluate(MEASURE);
  check(`${tag} 聊天界面控件仍是 ${wantControl}px`, chatState.controlHeights.every((h) => h === wantControl), JSON.stringify(chatState.controlHeights));
  check(`${tag} 聊天消息间距 ${wantGap}px`, chatState.msgGap === wantGap, String(chatState.msgGap));
  check(`${tag} 聊天界面无横向溢出`, chatState.overflowX <= 1, `溢出 ${chatState.overflowX}px`);
  check(`${tag} 聊天界面渲染出消息`, chatState.msgCount > 0, String(chatState.msgCount));
  if (chatState.circleButtons.length > 0) {
    check(
      `${tag} 圆形按钮是正方形（宽 = 高，不能是椭圆）`,
      chatState.circleButtons.every((b) => b.w > 0 && Math.abs(b.w - b.h) <= 1),
      JSON.stringify(chatState.circleButtons),
    );
  }

  if (vp.columns === 1) {
    check(`${tag} 手机档聊天时只显示聊天界面`, chatState.mainVis && !chatState.sidebarVis, `sidebar=${chatState.sidebarVis} main=${chatState.mainVis}`);
    check(`${tag} 手机档显示「会话列表」返回按钮`, chatState.backBtnVisible === true);
  } else {
    check(`${tag} 切换会话后仍是双栏`, chatState.sidebarVis && chatState.mainVis && chatState.sideBySide === true);
    check(`${tag} 双栏时不显示返回按钮`, chatState.backBtnVisible === false);
  }
}

await cdp.send("Emulation.clearDeviceMetricsOverride");
killChrome();

console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
