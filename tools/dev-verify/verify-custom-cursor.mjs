/**
 * Miku 自定义光标：两阶段加载验证。
 *
 * 覆盖「首屏只加载首帧、空闲再补剩余帧」这条链路：
 *   1. 启动时 17 条光标样式全部装好，但内容都只有首帧（`first-frame`）；
 *   2. 此时网络里只允许出现 `<cursor>/0.png`，不允许出现其余帧；
 *   3. `html` / `.conversation-item` / `.el-button` 的 cursor 都指向 Miku 帧图
 *      （会话项是 li，验证白名单确实生效，不会掉回系统手型）；
 *   4. 手动触发空闲回调后，17 条全部升级成完整动画，146 张帧图各请求一次、无重复；
 *   5. 动画时长与 `cursors.generated.ts` 的记录一致（Link 1983.339ms）。
 *
 * 前置条件：dev server（默认 5173）+ chromium + 可用令牌（Redis）。
 * 缺任意一项只打 SKIP 并返回 0，和 verify-chat-layout 一致。
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
/** Link 动画总时长（毫秒），见 cursors.generated.ts。 */
const LINK_DURATION_MS = 1983.339;

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

// ── 极简 CDP 客户端（只用到 Page / Runtime / Network / Emulation）───────────
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

// 记录帧图请求（判断「首帧阶段只请求首帧」）
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

// 注入：
//  - 登录态；
//  - 让 matchMedia 认为「精细指针」（headless 默认 hover:none，否则光标整套不启用）；
//  - 把 requestIdleCallback 换成一个可手动释放的队列 —— 这样能稳定观察「首帧阶段」，
//    不用靠 sleep 猜空闲时机。
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

await cdp.send("Page.navigate", { url: `${WEB}/chat` });

// 等会话列表渲染（需要拿到 `.conversation-item` 才能验证 li 的光标）
for (let i = 0; i < 80; i += 1) {
  if (await cdp.evaluate(`!!document.querySelector('.conversation-item')`)) break;
  await sleep(200);
}

const snapshotA = await cdp.evaluate(`(() => {
  const styles = [...document.querySelectorAll('style[data-miku-cursor]')];
  const cursorOf = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).cursor : null;
  };
  return {
    total: styles.length,
    firstFrame: styles.filter((s) => s.dataset.mikuCursorPhase === 'first-frame').length,
    html: cursorOf('html'),
    conversation: cursorOf('.conversation-item'),
    button: cursorOf('.el-button'),
  };
})()`);

await sleep(300);

check(`${CURSOR_COUNT} 条光标规则全部装上`, snapshotA.total === CURSOR_COUNT, `实际 ${snapshotA.total}`);
check(
  "首帧阶段：全部停留在 first-frame",
  snapshotA.firstFrame === CURSOR_COUNT,
  `first-frame ${snapshotA.firstFrame}/${CURSOR_COUNT}`,
);
check(
  "首帧阶段：网络里只有首帧图（*/0.png）",
  frameRequests.length > 0 && frameRequests.every((url) => /\/0\.png\?/.test(url)),
  frameRequests.filter((url) => !/\/0\.png\?/.test(url)).slice(0, 3).join(", "),
);
check(
  "首帧阶段：html 光标指向 Miku 首帧",
  typeof snapshotA.html === "string" && snapshotA.html.includes("/miku-cursors/normal-select/0.png"),
  String(snapshotA.html ?? "").slice(0, 120),
);
check(
  "会话项（li）拿到 Miku link 光标，没有掉回系统手型",
  typeof snapshotA.conversation === "string" && snapshotA.conversation.includes("/miku-cursors/link/"),
  String(snapshotA.conversation ?? "").slice(0, 120),
);
check(
  "Element Plus 按钮拿到 Miku link 光标",
  typeof snapshotA.button === "string" && snapshotA.button.includes("/miku-cursors/link/"),
  String(snapshotA.button ?? "").slice(0, 120),
);

check(
  "准星取自素材 CUR hotspot（link = 0 0，不是手写的 8 0）",
  typeof snapshotA.conversation === "string" && /\)\s+0\s+0,\s+pointer$/.test(snapshotA.conversation),
  String(snapshotA.conversation ?? "").slice(-40),
);

// 手动释放空闲回调：进入第二阶段
await cdp.evaluate(`(() => {
  const queue = window.__mikuIdleQueue.splice(0);
  queue.forEach((cb) => cb({ didTimeout: false, timeRemaining: () => 0 }));
  return queue.length;
})()`);

// 等 17 条全部升级
let snapshotB = null;
for (let i = 0; i < 100; i += 1) {
  snapshotB = await cdp.evaluate(`(() => {
    const styles = [...document.querySelectorAll('style[data-miku-cursor]')];
    const conversation = document.querySelector('.conversation-item');
    return {
      animated: styles.filter((s) => s.dataset.mikuCursorPhase === 'animated').length,
      total: styles.length,
      duration: conversation ? getComputedStyle(conversation).animationDuration : null,
      steps: (styles.find((s) => s.dataset.mikuCursor === 'link')?.textContent.match(/%/g) || []).length,
    };
  })()`);
  if (snapshotB.animated === CURSOR_COUNT) break;
  await sleep(200);
}
await sleep(500);

check(
  "空闲阶段：全部升级成 animated",
  snapshotB.animated === CURSOR_COUNT,
  `animated ${snapshotB.animated}/${CURSOR_COUNT}`,
);
check(
  "空闲阶段：Link 动画时长与生成数据一致",
  typeof snapshotB.duration === "string" &&
    Math.abs(Number.parseFloat(snapshotB.duration) * 1000 - LINK_DURATION_MS) < 1,
  `实际 ${snapshotB.duration}，期望 ${LINK_DURATION_MS}ms`,
);
check("空闲阶段：Link 关键帧数 = 17", snapshotB.steps === 17, `实际 ${snapshotB.steps}`);

const uniqueFrames = new Set(frameRequests.map((url) => url.split("?")[0]));
check(
  `全部 ${FRAME_COUNT} 张帧图都请求到`,
  uniqueFrames.size === FRAME_COUNT,
  `实际 ${uniqueFrames.size}`,
);
check(
  "帧图没有重复请求",
  frameRequests.length === new Set(frameRequests).size,
  `请求 ${frameRequests.length} 次 / 去重 ${new Set(frameRequests).size}`,
);

killChrome();
console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
