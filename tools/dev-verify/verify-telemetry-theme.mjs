/**
 * 埋点诊断页（`/debug/telemetry`）日 / 夜主题验证（真实浏览器）。
 *
 *   node tools/dev-verify/verify-telemetry-theme.mjs
 *
 * 背景：诊断页没有套 app-shell，原来写死了 #f6f7f9 / #fff / #111827 等浅色值，
 * 夜间模式下打开会是一整页白底。现在颜色收敛到页内 `--tp-*` 变量，
 * 由 `html[data-theme="dark"] .telemetry-page` 覆盖。这个套件负责验证：
 *
 *   · 夜间：页面 / 卡片 / 筛选块 / 搜索框 / 事件卡 / 诊断块都是深色，
 *     正文是浅色，错误 / 警告语义色仍可辨认，JSON 代码块是深底浅字；
 *   · 日间：页面 / 卡片回到浅色，正文深色，选中筛选 chip 仍是深底白字；
 *   · 手机档（393x852）同样应用夜间色板；
 *   · 用预置埋点事件确认事件卡与「自动诊断」真的渲染出来（不是只看空页）。
 *
 * 该页面免登录，**不需要后端 / MySQL / Redis**，只要求：
 *   1. dev server 在跑（默认 http://127.0.0.1:5173，DEV_VERIFY_WEB 可覆盖）；
 *   2. 本机有 chromium（chromium-browser / chromium / google-chrome，或 CHROMIUM_BIN）。
 * 缺任何一个都会 SKIP 并返回 0。
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WEB = process.env.DEV_VERIFY_WEB ?? "http://127.0.0.1:5173";
const DEBUG_PORT = Number(process.env.DEV_VERIFY_TELEMETRY_CDP_PORT ?? 9338);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  <- ${detail}`}`);
};

const skip = (reason) => {
  console.log(`SKIP  埋点页主题验证：${reason}`);
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

// ── 启动 chromium ─────────────────────────────────────────────────────────
const profileDir = mkdtempSync(path.join(tmpdir(), "telemetry-theme-"));
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

// ── 颜色工具 ──────────────────────────────────────────────────────────────
function parseColor(value) {
  if (!value) return null;
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

const brightness = (color) => (color ? 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b : null);

function channel(value) {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function relative(color) {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrast(a, b) {
  if (!a || !b) return null;
  const [hi, lo] = [relative(a), relative(b)].sort((left, right) => right - left);
  return (hi + 0.05) / (lo + 0.05);
}

// ── 预置埋点事件：确保事件卡 / 自动诊断真的渲染 ───────────────────────────
const now = Date.now();
const SEED_EVENTS = [
  {
    id: "seed-error",
    ts: new Date(now - 3000).toISOString(),
    t: now - 3000,
    level: "error",
    category: "error",
    name: "seed-error",
    sessionId: "seed-session",
    pageLoadId: "seed-load",
    loadCount: 2,
    route: "/chat",
    data: { message: "模拟上传失败" },
    stack: "Error: 模拟上传失败\n    at seed.js:1:1",
  },
  {
    id: "seed-warn",
    ts: new Date(now - 2000).toISOString(),
    t: now - 2000,
    level: "warn",
    category: "file",
    name: "file-upload-failed",
    sessionId: "seed-session",
    pageLoadId: "seed-load",
    loadCount: 2,
    route: "/chat",
    data: { fileName: "测试图片.png" },
  },
  {
    id: "seed-load",
    ts: new Date(now - 1000).toISOString(),
    t: now - 1000,
    level: "info",
    category: "app",
    name: "page-load",
    sessionId: "seed-session",
    pageLoadId: "seed-load",
    loadCount: 2,
    route: "/chat",
    data: { navigationType: "reload" },
  },
];

/**
 * 在每个新文档的脚本之前写入主题 / 预置事件。
 * 不能等页面加载后再 setItem：页面卸载时 persistOnHide 会用当前会话的缓冲
 * 覆盖 localStorage，预置事件会丢。
 */
let seedScriptId = null;

async function installSeed(theme) {
  if (seedScriptId) {
    try {
      await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seedScriptId });
    } catch {
      /* 已被移除 */
    }
    seedScriptId = null;
  }
  const source =
    `try{localStorage.setItem('theme',${JSON.stringify(theme)});` +
    `localStorage.setItem('MM-telemetry-events',${JSON.stringify(JSON.stringify(SEED_EVENTS))});` +
    `sessionStorage.setItem('MM-telemetry-session','seed-session')}catch(e){}`;
  const result = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
  seedScriptId = result.identifier;
}

const MEASURE = `(() => {
  const styleOf = (selector) => {
    const el = document.querySelector(selector);
    return el ? getComputedStyle(el) : null;
  };
  const get = (selector, prop) => styleOf(selector)?.[prop] ?? null;
  const firstEvent = document.querySelector('.event');
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    darkClass: document.documentElement.classList.contains('dark'),
    pageBg: get('.telemetry-page', 'backgroundColor'),
    pageColor: get('.telemetry-page', 'color'),
    metaBg: get('.meta', 'backgroundColor'),
    metaColor: get('.meta', 'color'),
    chipBg: get('.chip:not(.active)', 'backgroundColor'),
    chipColor: get('.chip:not(.active)', 'color'),
    activeChipBg: get('.chip.active', 'backgroundColor'),
    activeChipColor: get('.chip.active', 'color'),
    searchBg: get('.search', 'backgroundColor'),
    searchColor: get('.search', 'color'),
    eventBg: firstEvent ? getComputedStyle(firstEvent).backgroundColor : null,
    eventColor: firstEvent ? getComputedStyle(firstEvent).color : null,
    jsonBg: get('.event-json', 'backgroundColor'),
    jsonColor: get('.event-json', 'color'),
    diagBg: get('.diagnosis', 'backgroundColor'),
    diagText: get('.diag-line', 'color'),
    diagErrorBg: get('.diag-line.error', 'backgroundColor'),
    sectionTitleColor: get('.section-title', 'color'),
    eventTimeColor: get('.event-time', 'color'),
    eventSummaryColor: get('.event-summary', 'color'),
    errorDotBg: get('.dot.error', 'backgroundColor'),
    eventCount: document.querySelectorAll('.event').length,
    errorEventCount: document.querySelectorAll('.event.error').length,
    diagLines: [...document.querySelectorAll('.diag-line')].map((el) => el.textContent.trim()),
  };
})()`;

async function load(theme) {
  await installSeed(theme);
  await cdp.send("Page.navigate", { url: `${WEB}/debug/telemetry` });
  await sleep(2800);
  return await cdp.evaluate(MEASURE);
}

// ==============================================
// 夜间
// ==============================================
const dark = await load("dark");
const darkPageBg = parseColor(dark.pageBg);
const darkPageColor = parseColor(dark.pageColor);
check("夜间：<html> 写入 data-theme=dark 与 .dark", dark.theme === "dark" && dark.darkClass === true, JSON.stringify(dark));
check("夜间：页面背景是深色", brightness(darkPageBg) < 40, String(brightness(darkPageBg)));
check("夜间：正文是浅色", brightness(darkPageColor) > 180, String(brightness(darkPageColor)));
check("夜间：正文 / 背景对比度 >= 4.5", contrast(darkPageColor, darkPageBg) >= 4.5, String(contrast(darkPageColor, darkPageBg)));
check("夜间：meta / 筛选 chip / 搜索框是深色", [dark.metaBg, dark.chipBg, dark.searchBg].every((c) => brightness(parseColor(c)) < 60), JSON.stringify([dark.metaBg, dark.chipBg, dark.searchBg]));
check("夜间：事件卡是深色", brightness(parseColor(dark.eventBg)) < 60, String(brightness(parseColor(dark.eventBg))));
check("夜间：诊断块是深色", brightness(parseColor(dark.diagBg)) < 60, String(brightness(parseColor(dark.diagBg))));
check("夜间：错误诊断条是暗红底", brightness(parseColor(dark.diagErrorBg)) < 80, JSON.stringify(dark.diagErrorBg));
check("夜间：选中筛选 chip 反色（浅底深字）", brightness(parseColor(dark.activeChipBg)) > 180 && brightness(parseColor(dark.activeChipColor)) < 80, JSON.stringify([dark.activeChipBg, dark.activeChipColor]));
check("夜间：错误事件 / 诊断文案渲染正常", dark.errorEventCount > 0 && dark.diagLines.some((line) => line.includes("模拟上传失败")), JSON.stringify({ errorEventCount: dark.errorEventCount, diagLines: dark.diagLines }));

await cdp.evaluate(`(() => { const el = document.querySelector('.event.error') || document.querySelector('.event'); if (el) el.click(); return true; })()`);
await sleep(500);
const darkExpanded = await cdp.evaluate(MEASURE);
check("夜间：JSON 代码块是深底浅字", brightness(parseColor(darkExpanded.jsonBg)) < 40 && brightness(parseColor(darkExpanded.jsonColor)) > 180, JSON.stringify([darkExpanded.jsonBg, darkExpanded.jsonColor]));

// ==============================================
// 日间
// ==============================================
const light = await load("light");
const lightPageBg = parseColor(light.pageBg);
const lightPageColor = parseColor(light.pageColor);
check("日间：<html> 写入 data-theme=light 且没有 .dark", light.theme === "light" && light.darkClass === false, JSON.stringify(light));
check("日间：页面背景是浅色", brightness(lightPageBg) > 200, String(brightness(lightPageBg)));
check("日间：正文是深色", brightness(lightPageColor) < 80, String(brightness(lightPageColor)));
check("日间：正文 / 背景对比度 >= 4.5", contrast(lightPageColor, lightPageBg) >= 4.5, String(contrast(lightPageColor, lightPageBg)));
check("日间：meta / 筛选 chip / 搜索框是浅色", [light.metaBg, light.chipBg, light.searchBg].every((c) => brightness(parseColor(c)) > 200), JSON.stringify([light.metaBg, light.chipBg, light.searchBg]));
check("日间：事件卡 / 诊断块是浅色", brightness(parseColor(light.eventBg)) > 200 && brightness(parseColor(light.diagBg)) > 200, JSON.stringify([light.eventBg, light.diagBg]));
check("日间：错误诊断条是浅红底", brightness(parseColor(light.diagErrorBg)) > 200, JSON.stringify(light.diagErrorBg));
check("日间：选中筛选 chip 仍是深底白字", brightness(parseColor(light.activeChipBg)) < 80 && brightness(parseColor(light.activeChipColor)) > 200, JSON.stringify([light.activeChipBg, light.activeChipColor]));
check("日间：预置事件 / 诊断文案渲染正常", light.errorEventCount > 0 && light.diagLines.some((line) => line.includes("模拟上传失败")), JSON.stringify({ errorEventCount: light.errorEventCount, diagLines: light.diagLines }));

await cdp.evaluate(`(() => { const el = document.querySelector('.event.error') || document.querySelector('.event'); if (el) el.click(); return true; })()`);
await sleep(500);
const lightExpanded = await cdp.evaluate(MEASURE);
check("日间：JSON 代码块保持深底浅字", brightness(parseColor(lightExpanded.jsonBg)) < 80 && brightness(parseColor(lightExpanded.jsonColor)) > 180, JSON.stringify([lightExpanded.jsonBg, lightExpanded.jsonColor]));

// ==============================================
// 手机档：同样应用夜间色板
// ==============================================
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 393,
  height: 852,
  deviceScaleFactor: 1,
  mobile: true,
});
const mobile = await load("dark");
check("夜间手机档：页面背景仍是深色", brightness(parseColor(mobile.pageBg)) < 40, JSON.stringify(mobile.pageBg));
check("夜间手机档：正文仍是浅色", brightness(parseColor(mobile.pageColor)) > 180, JSON.stringify(mobile.pageColor));
await cdp.send("Emulation.clearDeviceMetricsOverride");

killChrome();
console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
