/**
 * Miku 虚拟光标（DOM 覆盖层）验证。
 *
 * 背景：CSS `cursor` 关键帧在鼠标静止时不会刷新 —— 看起来就是「不动不播、动一下跳一帧」。
 * 现在改成跟随指针的 canvas 覆盖层，所以这里验证的是「覆盖层自己会走帧」，而不是 CSS 动画。
 *
 * 覆盖：
 *   1. 启动阶段只请求首帧（`<cursor>/0.png`），覆盖层已挂载但还没接管系统光标；
 *   2. 指针移到按钮后：`--miku-cursor` = link、原生光标变 `none`、覆盖层按准星定位；
 *   3. 首帧阶段（未加载完剩余帧）画面保持不动；
 *   4. 释放空闲回调后，**鼠标不动**画面也会自己换帧（这是本次修复的核心）；
 *   5. 全部 146 张帧图各请求一次、无重复；
 *   6. 文本输入框上准星 = (3,7)（来自素材 CUR hotspot），定位 = 指针坐标 - 准星。
 *
 * 前置条件：dev server（默认 5173）+ chromium + 可用令牌（Redis）。
 * 缺任意一项只打 SKIP 并返回 0。
 *
 * 运行：node tools/dev-verify/verify-custom-cursor.mjs
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { JWT_KEY, rcli } from "./config.mjs";

const WEB = process.env.DEV_VERIFY_WEB ?? "http://127.0.0.1:5173";
const USER_ID = Number(process.env.DEV_VERIFY_USER_ID ?? 8);
const DEBUG_PORT = Number(process.env.DEV_VERIFY_CDP_PORT ?? 9335);

/** 生成的光标数量（`public/miku-cursors/*`）。 */
const CURSOR_COUNT = 17;
/** 全部帧图数量（首帧 17 + 剩余 129）。 */
const FRAME_COUNT = 146;
/** 文本光标在 32×32 帧图里的准星，见 cursors.generated.ts。 */
const TEXT_HOTSPOT = [3, 7];

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  <- ${detail}`}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const skip = (reason) => {
  console.log(`SKIP  Miku 光标验证：${reason}`);
  console.log("\n跳过（前置条件不满足）");
  process.exit(0);
};

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

/** 伪造开发令牌并写进 Redis —— 与 e2e-chat / verify-chat-layout 同一套做法。 */
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
const profileDir = mkdtempSync(path.join(tmpdir(), "miku-cursor-"));
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

// ── 极简 CDP 客户端 ───────────────────────────────────────────────────────
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

const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
if (!target?.webSocketDebuggerUrl) {
  killChrome();
  skip("无法创建调试页面");
}
const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Network.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 1400,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

const frameRequests = [];
cdp.ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method !== "Network.requestWillBeSent") return;
  const url = msg.params.request.url;
  if (url.includes("/miku-cursors/")) frameRequests.push(url);
});

const expiresAt = new Date(Date.now() + 3600_000).toISOString();
const session = JSON.stringify({
  accessToken: token,
  refreshToken: token,
  accessTokenExpiresAt: expiresAt,
  refreshTokenExpiresAt: expiresAt,
});

// 登录态 + 精细指针 + 手动空闲队列（稳定观察「首帧阶段」）
await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    localStorage.setItem('MM-auth', ${JSON.stringify(session)});
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      const mm = orig(q);
      if (/(hover|pointer)/.test(q)) {
        return new Proxy(mm, {
          get(t, p) {
            if (p === 'matches') return true;
            const v = Reflect.get(t, p);
            return typeof v === 'function' ? v.bind(t) : v;
          },
        });
      }
      return mm;
    };
    window.__mikuIdleQueue = [];
    window.requestIdleCallback = (cb) => {
      window.__mikuIdleQueue.push(cb);
      return window.__mikuIdleQueue.length;
    };
  })();`,
});

const moveTo = async (x, y) => {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
  });
};

const readOverlay = `(() => {
  const canvas = document.querySelector('canvas.miku-cursor');
  const cursorPropOf = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).getPropertyValue('--miku-cursor').trim() : null;
  };
  return {
    canvas: !!canvas,
    display: canvas ? getComputedStyle(canvas).display : null,
    size: canvas ? [canvas.width, canvas.height] : null,
    transform: canvas ? canvas.style.transform : null,
    htmlClass: document.documentElement.className,
    nativeCursor: getComputedStyle(document.documentElement).cursor,
    propHtml: cursorPropOf('html'),
    propConversation: cursorPropOf('.conversation-item'),
    propButton: cursorPropOf('.el-button'),
    frame: canvas ? canvas.toDataURL() : null,
  };
})()`;

await cdp.send("Page.navigate", { url: `${WEB}/chat` });

for (let i = 0; i < 80; i += 1) {
  if (await cdp.evaluate(`!!document.querySelector('.conversation-item')`)) break;
  await sleep(200);
}
for (let i = 0; i < 60; i += 1) {
  if (await cdp.evaluate(`!!document.querySelector('canvas.miku-cursor')`)) break;
  await sleep(200);
}

const before = await cdp.evaluate(readOverlay);
check("覆盖层已挂载（32×32 canvas）", before.canvas && before.size?.[0] === 32, JSON.stringify(before.size));
check("未移动指针前不隐藏系统光标", !String(before.htmlClass).includes("miku-cursor-on"));
check(
  "首帧阶段只请求首帧图",
  frameRequests.length > 0 && frameRequests.every((url) => /\/0\.png\?/.test(url)),
  frameRequests.filter((url) => !/\/0\.png\?/.test(url)).slice(0, 3).join(", "),
);
check("默认光标类型 = normal-select", before.propHtml === "normal-select", String(before.propHtml));

// 移到按钮上
const buttonRect = await cdp.evaluate(`(() => {
  const el = document.querySelector('.el-button');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
if (!buttonRect) {
  killChrome();
  skip("页面上找不到 .el-button");
}
await moveTo(buttonRect.x, buttonRect.y);
await sleep(400);

const onButton = await cdp.evaluate(readOverlay);
check("覆盖层接管：系统光标变 none", String(onButton.htmlClass).includes("miku-cursor-on") && onButton.nativeCursor === "none");
check("覆盖层显示且跟随指针", onButton.display === "block" && onButton.transform !== null, String(onButton.display));
check("按钮 → link 光标类型", onButton.propButton === "link", String(onButton.propButton));
check("会话项 → link 光标类型", onButton.propConversation === "link", String(onButton.propConversation));

const parsed = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(onButton.transform ?? "");
check(
  "按钮准星 (0,0) 定位正确",
  !!parsed && Math.abs(Number(parsed[1]) - buttonRect.x) <= 1 && Math.abs(Number(parsed[2]) - buttonRect.y) <= 1,
  `${onButton.transform} vs (${buttonRect.x},${buttonRect.y})`,
);

const stillA = await cdp.evaluate(`document.querySelector('canvas.miku-cursor').toDataURL()`);
await sleep(320);
const stillB = await cdp.evaluate(`document.querySelector('canvas.miku-cursor').toDataURL()`);
check("首帧阶段画面不自己走帧（帧未加载完）", stillA === stillB);

// 释放空闲：开始加载剩余帧
await cdp.evaluate(`(() => {
  window.__mikuIdleQueue.splice(0).forEach((cb) => cb({ didTimeout: false, timeRemaining: () => 0 }));
  return true;
})()`);

let animated = false;
let lastFrame = await cdp.evaluate(`document.querySelector('canvas.miku-cursor').toDataURL()`);
for (let i = 0; i < 100; i += 1) {
  await sleep(150);
  const next = await cdp.evaluate(`document.querySelector('canvas.miku-cursor').toDataURL()`);
  if (next !== lastFrame) {
    animated = true;
    break;
  }
}
check("鼠标不动时覆盖层自己换帧（核心修复）", animated);

// 等全部帧请求完
for (let i = 0; i < 100; i += 1) {
  const unique = new Set(frameRequests.map((url) => url.split("?")[0]));
  if (unique.size >= FRAME_COUNT) break;
  await sleep(200);
}
const uniqueFrames = new Set(frameRequests.map((url) => url.split("?")[0]));
check(`全部 ${FRAME_COUNT} 张帧图都请求到`, uniqueFrames.size === FRAME_COUNT, `实际 ${uniqueFrames.size}`);
check(
  "帧图没有重复请求",
  frameRequests.length === new Set(frameRequests).size,
  `请求 ${frameRequests.length} 次 / 去重 ${new Set(frameRequests).size}`,
);

// 会话打开后：文件消息卡片也应该走 link（上一条修复的回归项）
await cdp.evaluate(`(() => { document.querySelector('.conversation-item')?.click(); return true; })()`);
for (let i = 0; i < 50; i += 1) {
  if (await cdp.evaluate(`!!document.querySelector('.file-message')`)) break;
  await sleep(200);
}
const fileMessageCursor = await cdp.evaluate(`(() => {
  const el = document.querySelector('.file-message');
  return el ? getComputedStyle(el).getPropertyValue('--miku-cursor').trim() : null;
})()`);
if (fileMessageCursor === null) {
  console.log("INFO  当前会话没有文件消息，跳过文件卡片断言");
} else {
  check("文件消息卡片 → link 光标类型", fileMessageCursor === "link", String(fileMessageCursor));
}

// 文本输入框：准星 (3,7)
let composer = null;
for (let i = 0; i < 60; i += 1) {
  composer = await cdp.evaluate(`(() => {
    const el = document.querySelector('.el-textarea__inner');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (composer) break;
  await sleep(200);
}

if (!composer) {
  console.log("INFO  找不到聊天输入框，跳过文本准星断言");
} else {
  await moveTo(composer.x, composer.y);
  await sleep(350);
  const textState = await cdp.evaluate(`(() => {
    const canvas = document.querySelector('canvas.miku-cursor');
    const el = document.querySelector('.el-textarea__inner');
    return {
      transform: canvas ? canvas.style.transform : null,
      prop: el ? getComputedStyle(el).getPropertyValue('--miku-cursor').trim() : null,
    };
  })()`);
  const textParsed = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(textState.transform ?? "");
  check("输入框 → text-select 光标类型", textState.prop === "text-select", String(textState.prop));
  check(
    `文本准星 (${TEXT_HOTSPOT[0]},${TEXT_HOTSPOT[1]}) 定位正确`,
    !!textParsed &&
      Math.abs(Number(textParsed[1]) - (composer.x - TEXT_HOTSPOT[0])) <= 1 &&
      Math.abs(Number(textParsed[2]) - (composer.y - TEXT_HOTSPOT[1])) <= 1,
    `${textState.transform} vs (${composer.x - TEXT_HOTSPOT[0]},${composer.y - TEXT_HOTSPOT[1]})`,
  );
}

killChrome();
console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
