/**
 * 聊天文件上传全流程埋点验证（真实浏览器 + 移动端 Chrome UA）。
 *
 *   node tools/dev-verify/verify-chat-upload-flow.mjs
 *
 * 验证「点击上传 → 选择器 → change → 上传 → 消息发出」这条链路的埋点：
 *
 *   1. 移动端触摸点击后，流程记录里必须有 trigger-pointerdown / input-click；
 *   2. 浏览器确实尝试打开文件选择器（CDP 拦截到 Page.fileChooserOpened）；
 *   3. headless 不会真的失焦，所以 2s 后应出现 picker-signal-missing（允许的 warn）；
 *   4. 注入文件后流程继续：file-change → file-upload-start → file-upload-response
 *      → file-upload-done → flow-complete，状态变成 done；
 *   5. 流程 meta 能正确识别 Android Chrome；
 *   6. /debug/telemetry 页面能渲染出这条流程的时间线与诊断，且不会把成功流程误报成
 *      「没有唤起选择器」。
 *
 * 前置条件与其它 chromium 套件一致：dev server（5173）、chromium、可伪造开发令牌。
 * 缺任何一个都 SKIP 并返回 0。
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { JWT_KEY, rcli } from "./config.mjs";
import { makePng } from "./_fixtures.mjs";

const WEB = process.env.DEV_VERIFY_WEB ?? "http://127.0.0.1:5173";
const USER_ID = Number(process.env.DEV_VERIFY_USER_ID ?? 8);
const DEBUG_PORT = Number(process.env.DEV_VERIFY_FLOW_CDP_PORT ?? 9339);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  <- ${detail}`}`);
};

const skip = (reason) => {
  console.log(`SKIP  聊天上传流程埋点验证：${reason}`);
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

const TOKEN_TAG = `flow${Date.now().toString(36)}`;
const pngBase64 = makePng(48, 48, Date.now() % 997).toString("base64");
const FILE_NAME = `verify-flow-${TOKEN_TAG}.png`;

function mintToken() {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: String(USER_ID),
    email: `user${USER_ID}@dev.local`,
    "http://schemas.microsoft.com/ws/2008/identity/claims/role": "user",
    jti: `${TOKEN_TAG}${now}`,
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

const profileDir = mkdtempSync(path.join(tmpdir(), "chat-upload-flow-"));
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

let cdpReady = false;
for (let i = 0; i < 80; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      cdpReady = true;
      break;
    }
  } catch {
    /* 还没起来 */
  }
  await sleep(250);
}
if (!cdpReady) {
  killChrome();
  skip(`chromium 的 CDP 端口（${DEBUG_PORT}）没起来`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.pageErrors = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        this.pageErrors.push(msg.params.exceptionDetails?.text ?? "exception");
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        this.pageErrors.push(msg.params.entry.text);
      }
      const handler = this.handlers.get(msg.method);
      if (handler) handler(msg.params);
    });
  }

  on(method, handler) {
    this.handlers.set(method, handler);
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

const target = await (await fetch(
  `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent("about:blank")}`,
  { method: "PUT" },
)).json();
if (!target?.webSocketDebuggerUrl) {
  killChrome();
  skip("无法创建调试页面");
}

const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Log.enable");

let fileChooserOpened = false;
await cdp.send("Page.setInterceptFileChooserDialog", { enabled: true });
cdp.on("Page.fileChooserOpened", () => {
  fileChooserOpened = true;
});

// 移动端 Chrome UA + 触摸：让 isAndroidChrome / isMobileChrome 为 true
await cdp.send("Emulation.setUserAgentOverride", {
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  platform: "Linux armv8l",
  acceptLanguage: "zh-CN",
});
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 393,
  height: 852,
  deviceScaleFactor: 2.75,
  mobile: true,
});
await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });

const expiresAt = new Date(Date.now() + 3600_000).toISOString();
await cdp.send("Page.navigate", { url: `${WEB}/login` });
await sleep(2200);
await cdp.evaluate(`localStorage.setItem('MM-auth', ${JSON.stringify(JSON.stringify({
  accessToken: token,
  refreshToken: token,
  accessTokenExpiresAt: expiresAt,
  refreshTokenExpiresAt: expiresAt,
}))}); true`);

await cdp.send("Page.navigate", { url: `${WEB}/chat` });
await sleep(2500);

let hasList = false;
for (let i = 0; i < 40; i += 1) {
  hasList = await cdp.evaluate(`document.querySelectorAll('.conversation-list li').length > 0`);
  if (hasList) break;
  await sleep(250);
}
if (!hasList) {
  killChrome();
  skip("会话列表为空（先登录一次让账号有会话数据）");
}

await cdp.evaluate(
  `(() => { const li = document.querySelector('.conversation-list li'); if (!li) return false; li.click(); return true; })()`,
);
for (let i = 0; i < 40; i += 1) {
  const ready = await cdp.evaluate(`!!document.querySelector('.native-file-input')`);
  if (ready) break;
  await sleep(250);
}
await sleep(800);

const initialFlowIds = await cdp.evaluate(`(() => {
  try { return (JSON.parse(localStorage.getItem('MM-telemetry-flows') || '[]') || []).map((f) => f.id); }
  catch { return []; }
})()`);

const inputRect = await cdp.evaluate(`(() => {
  const input = document.querySelector('.native-file-input');
  if (!input) return null;
  const r = input.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
})()`);
check("找到 file input（铺满按钮的透明原生输入）", Boolean(inputRect), "页面里没有 .native-file-input");
if (!inputRect) {
  killChrome();
  process.exit(1);
}
check("file input 命中区足够大（触屏 >= 40px）", inputRect.w >= 40 && inputRect.h >= 40, `rect=${JSON.stringify(inputRect)}`);

// 诊断悬浮按钮默认停在输入区上方：不能压住上传键的 44px 命中区，
// 否则「点上传却打开了诊断页」会伪装成「点上传没反应」。
const uploadOverlap = await cdp.evaluate(`(() => {
  const input = document.querySelector('.native-file-input');
  const fab = document.querySelector('.telemetry-fab');
  if (!input || !fab) return { skipped: true };
  const a = input.getBoundingClientRect();
  const b = fab.getBoundingClientRect();
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return { w, h, ratio: (w * h) / (a.width * a.height) || 0 };
})()`);
check(
  "默认诊断悬浮按钮不压住上传命中区",
  uploadOverlap.skipped || uploadOverlap.ratio === 0,
  JSON.stringify(uploadOverlap),
);

// 触摸点击：pointerdown → touchstart → click → 浏览器尝试打开选择器
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [{ x: inputRect.x, y: inputRect.y, id: 1, radiusX: 8, radiusY: 8, force: 1 }],
});
await sleep(80);
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

for (let i = 0; i < 40; i += 1) {
  if (fileChooserOpened) break;
  await sleep(100);
}
check("点击后浏览器尝试打开文件选择器（Page.fileChooserOpened）", fileChooserOpened);

// headless 不会真的失焦：等 2.4s 让 picker-signal-missing 落下来，验证「没信号」分支
await sleep(2400);

// 注入文件（等价于用户在选择器里选了它）
const injectResult = await cdp.evaluate(`(() => {
  const input = document.querySelector('.native-file-input');
  if (!input) return 'no-input';
  const bin = atob(${JSON.stringify(pngBase64)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], ${JSON.stringify(FILE_NAME)}, { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok:' + file.size;
})()`);
check("文件注入成功", String(injectResult).startsWith("ok:"), String(injectResult));

/** 从 localStorage 读最新一条上传流程（含持久化节流，轮询等它落盘）。 */
async function readLatestFlow() {
  return await cdp.evaluate(`(() => {
    try {
      const flows = JSON.parse(localStorage.getItem('MM-telemetry-flows') || '[]');
      if (!Array.isArray(flows)) return null;
      const uploads = flows.filter((f) => f && f.name === 'chat-file-upload');
      const fresh = uploads.filter((f) => !${JSON.stringify(initialFlowIds)}.includes(f.id));
      const flow = (fresh.length ? fresh : uploads).sort((a, b) => b.startedAt - a.startedAt)[0];
      if (!flow) return null;
      return {
        id: flow.id,
        status: flow.status,
        endReason: flow.endReason ?? null,
        durationMs: flow.durationMs ?? null,
        meta: flow.meta ?? {},
        steps: (flow.steps || []).map((s) => ({ step: s.step, level: s.level, elapsedMs: s.elapsedMs, at: s.at, data: s.data })),
      };
    } catch (error) {
      return { error: String(error) };
    }
  })()`);
}

let flow = null;
for (let i = 0; i < 80; i += 1) {
  flow = await readLatestFlow();
  if (flow && flow.status !== "running") break;
  await sleep(250);
}
check("写出了 chat-file-upload 流程记录", Boolean(flow && flow.id), "localStorage 里没有流程");
if (!flow || !flow.id) {
  killChrome();
  process.exit(1);
}

const steps = new Set((flow.steps ?? []).map((step) => step.step));
const stepList = [...steps];
check("流程以 flow-start 开始", steps.has("flow-start"), stepList.join(","));
check("记录到 pointerdown（用户确实点了按钮）", steps.has("trigger-pointerdown"), stepList.join(","));
check("记录到 input click（事件到达真实 file input）", steps.has("input-click"), stepList.join(","));
check("记录到 change（拿到了文件）", steps.has("file-change"), stepList.join(","));
check("记录到上传开始 / 响应", steps.has("file-upload-start") && steps.has("file-upload-response"), stepList.join(","));
check("记录到消息发出", steps.has("file-upload-done"), stepList.join(","));
check("流程正常结束（flow-complete）", steps.has("flow-complete") && flow.status === "done", `status=${flow.status} steps=${stepList.join(",")}`);
check("headless 无失焦信号时记录了 picker-signal-missing", steps.has("picker-signal-missing"), stepList.join(","));
check("流程识别为 Android Chrome", flow.meta.isAndroidChrome === true && flow.meta.isMobileChrome === true, JSON.stringify(flow.meta));
check("流程 meta 带来源 input", flow.meta.source === "input", String(flow.meta.source));
check("流程带总耗时", typeof flow.durationMs === "number" && flow.durationMs >= 0, String(flow.durationMs));

const doneStep = (flow.steps ?? []).find((step) => step.step === "file-upload-done");
check("消息发出步骤带消息 id", doneStep && typeof doneStep.data?.messageId === "number", JSON.stringify(doneStep?.data ?? null));

// ── 诊断页：流程时间线与结论 ──────────────────────────────────────────────
await cdp.send("Page.navigate", { url: `${WEB}/debug/telemetry` });
await sleep(2000);
const debugPage = await cdp.evaluate(`(() => {
  const flowCards = [...document.querySelectorAll('.flows .flow')];
  const text = flowCards.map((el) => el.textContent || '').join('\\n');
  const diag = [...document.querySelectorAll('.diagnosis .diag-line')].map((el) => el.textContent || '').join('\\n');
  return { flowCount: flowCards.length, text, diag };
})()`);
check("诊断页渲染出了上传流程卡片", debugPage.flowCount > 0, JSON.stringify(debugPage).slice(0, 400));
check("流程时间线包含「消息已发出」", debugPage.text.includes("消息已发出"), debugPage.text.slice(0, 300));
check("流程时间线包含 AndroidChrome / MobileChrome", debugPage.text.includes("AndroidChrome") || debugPage.text.includes("MobileChrome"), debugPage.text.slice(0, 300));
check(
  "成功流程不会被诊断成「没有唤起选择器」",
  !debugPage.diag.includes("没有唤起文件选择器"),
  debugPage.diag.slice(0, 500),
);
check("诊断结论包含「上传流程」", debugPage.diag.includes("上传流程"), debugPage.diag.slice(0, 500));

// ── 场景二：点了 input，但浏览器没有发出任何「选择器已打开」信号 ─────────────
//
// 这正是「移动端 Chrome 点上传连文件管理器都呼不起来」的埋点判定路径。
// headless 里用 CDP 拦截选择器时页面不会真的失焦，等价于「没有信号」。
// 这里不注入文件，等 5s 的硬判定落下，确认流程里出现 picker-not-opened error。
console.log("\n— 场景二：只点击、不选文件，验证「选择器未打开」判定 —");
await cdp.send("Page.navigate", { url: `${WEB}/chat` });
await sleep(2500);
for (let i = 0; i < 40; i += 1) {
  const ready = await cdp.evaluate(`!!document.querySelector('.native-file-input')`);
  if (ready) break;
  await sleep(250);
}
const listReady = await cdp.evaluate(`document.querySelectorAll('.conversation-list li').length > 0`);
if (listReady) {
  await cdp.evaluate(
    `(() => { const li = document.querySelector('.conversation-list li'); if (!li) return false; li.click(); return true; })()`,
  );
  await sleep(1000);
}

const secondRect = await cdp.evaluate(`(() => {
  const input = document.querySelector('.native-file-input');
  if (!input) return null;
  const r = input.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
if (secondRect) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: secondRect.x, y: secondRect.y, id: 1, radiusX: 8, radiusY: 8, force: 1 }],
  });
  await sleep(80);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

let failedFlow = null;
for (let i = 0; i < 40; i += 1) {
  failedFlow = await readLatestFlow();
  if (failedFlow?.steps?.some((step) => step.step === "picker-not-opened")) break;
  await sleep(250);
}
const failedSteps = new Set((failedFlow?.steps ?? []).map((step) => step.step));
check(
  "5s 无失焦信号时记录 picker-not-opened（error）",
  failedSteps.has("picker-not-opened") && failedFlow.steps.some((step) => step.step === "picker-not-opened" && step.level === "error"),
  [...failedSteps].join(","),
);
check("此时流程仍未误判为完成", failedFlow?.status === "running" && !failedSteps.has("flow-complete"), `status=${failedFlow?.status}`);

await cdp.send("Page.navigate", { url: `${WEB}/debug/telemetry` });
await sleep(1800);
const failedDebug = await cdp.evaluate(`(() => {
  const diag = [...document.querySelectorAll('.diagnosis .diag-line')].map((el) => el.textContent || '').join('\\n');
  const flowText = [...document.querySelectorAll('.flows .flow')].map((el) => el.textContent || '').join('\\n');
  return { diag, flowText };
})()`);
check(
  "诊断页把「input click 已触发但没有打开信号」结论化",
  failedDebug.diag.includes("没有唤起文件选择器"),
  failedDebug.diag.slice(0, 500),
);
check(
  "流程时间线能看到「判定：选择器未打开」",
  failedDebug.flowText.includes("判定：选择器未打开") || failedDebug.flowText.includes("picker-not-opened"),
  failedDebug.flowText.slice(0, 400),
);

// ── 场景三：流程没结束时页面被重载 / 系统回收 ─────────────────────────────
//
// 移动端选择器打开时页面被系统回收，下一次启动必须能把上一次流程标成 interrupted，
// 而不是让它永远停在 running。场景二留下的正是这样一条 running 流程。
console.log("\n— 场景三：重载页面，验证上一次未结束的流程会被标记为 interrupted —");
await cdp.send("Page.navigate", { url: `${WEB}/chat` });
await sleep(2600);

let interrupted = null;
for (let i = 0; i < 40; i += 1) {
  const flows = await cdp.evaluate(`(() => {
    try {
      const list = JSON.parse(localStorage.getItem('MM-telemetry-flows') || '[]');
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  })()`);
  interrupted = flows
    .filter((flow) => flow && flow.name === "chat-file-upload" && flow.endReason === "page-reload-or-close")
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
  if (interrupted) break;
  await sleep(250);
}
check(
  "上一次未结束的流程被标记为 page-reload-or-close",
  Boolean(interrupted),
  "localStorage 里没有 endReason=page-reload-or-close 的流程",
);
if (interrupted) {
  check("被中断的流程状态是 aborted", interrupted.status === "aborted", String(interrupted.status));
  check(
    "中断流程里补了 flow-interrupted 步骤",
    (interrupted.steps ?? []).some((step) => step.step === "flow-interrupted"),
    (interrupted.steps ?? []).map((step) => step.step).join(","),
  );
}

await cdp.send("Page.navigate", { url: `${WEB}/debug/telemetry` });
await sleep(1800);
const interruptedDebug = await cdp.evaluate(
  `[...document.querySelectorAll('.diagnosis .diag-line')].map((el) => el.textContent || '').join('\\n')`,
);
check(
  "诊断页提示「上一次上传流程被页面重载 / 关闭打断」",
  interruptedDebug.includes("页面重载") && interruptedDebug.includes("打断"),
  interruptedDebug.slice(0, 500),
);

if (cdp.pageErrors.length > 0) {
  check("页面没有未捕获异常", false, cdp.pageErrors.slice(0, 3).join(" | "));
} else {
  check("页面没有未捕获异常", true);
}

console.log(failures ? `\n失败 ${failures} 项` : "\n全部通过");
killChrome();
process.exit(failures ? 1 : 0);
