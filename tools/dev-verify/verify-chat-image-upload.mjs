/**
 * 聊天页「图片上传 → 落成图片消息」全流程验证（真实浏览器）。
 *
 *   node tools/dev-verify/verify-chat-image-upload.mjs
 *
 * 为什么需要它：这条链路上有两个**看代码看不出来、一跑就卡死**的坑，都是本套件盯的回归点：
 *
 *   1. 上传结束后气泡必须**立刻**变成正常的图片消息，不能停在「准备中」。
 *      旧实现挂一个隐藏组件把刚上传完的文件重新下一次、下完再回话才收气泡，
 *      而那条消息的组件在回话之前就被卸载了 —— Vue 的 emit 对已卸载组件直接 return，
 *      回话永远传不回来；同时同一 fileKey 的第二个下载请求会被下载队列静默丢弃。
 *      两头一叠，图片就永久停在「准备中」。
 *   2. 自己发的图片必须**贴着自己的头像**（右侧），而不是贴在一个 300px 宽透明盒子的左边。
 *      小图（169px）离开头像一百多像素，看起来就像「消息没发出去」。
 *
 * 断言分三档视口跑：
 *   · 桌面 1400×900：上传动画出现 → 上传结束气泡消失 → 图片贴合头像 → 卡片仍能撑开；
 *   · 手机 360×800：图片被夹到可用宽度、无横向溢出、自己的图片仍贴右；
 *   · 极窄 320×568：无横向溢出（媒体必须能在窄屏里缩）。
 *
 * ## 前置条件（缺任何一个都会 SKIP 并返回 0，不会让 run-all 变红）
 *
 * 1. 前端 dev server 在跑：默认 http://127.0.0.1:5173，可用 DEV_VERIFY_WEB 覆盖；
 * 2. 本机有 chromium（CHROMIUM_BIN 可指定）；
 * 3. 开发令牌可伪造（读 api/appsettings.Development.json）且 Redis 可写；
 * 4. Node >= 22（用全局 WebSocket 直连 CDP）。
 *
 * ## 副作用
 *
 * 会往 conversation 10（DEV_VERIFY_CONVERSATION 可改）真发一张 169×120 的测试图，
 * 文件名形如 `verify-upload-169x120-<随机>.png`；与其它 e2e 套件一致，只动本地开发库。
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
const DEBUG_PORT = Number(process.env.DEV_VERIFY_CDP_PORT ?? 9334);
const IMG_W = Number(process.env.DEV_VERIFY_IMG_W ?? 169);
const IMG_H = Number(process.env.DEV_VERIFY_IMG_H ?? 120);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  <- ${detail}`}`);
};

const skip = (reason) => {
  console.log(`SKIP  聊天页图片上传验证：${reason}`);
  console.log("\n跳过（前置条件不满足）");
  process.exit(0);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value) => Math.round(value * 100) / 100;

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

// ── 测试用图片（内容随机：服务端按内容哈希去重，每次跑都该是新文件） ──────
const seed = Date.now() % 997;
const pngBase64 = makePng(IMG_W, IMG_H, seed).toString("base64");
const FILE_NAME = `verify-upload-${IMG_W}x${IMG_H}-${seed}.png`;

// ── 伪造开发令牌 ──────────────────────────────────────────────────────────
function mintToken() {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: String(USER_ID),
    email: `user${USER_ID}@dev.local`,
    "http://schemas.microsoft.com/ws/2008/identity/claims/role": "user",
    jti: `img${now}${USER_ID}`,
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
const profileDir = mkdtempSync(path.join(tmpdir(), "chat-upload-"));
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

// ── 极简 CDP 客户端 ──────────────────────────────────────────────────────
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.handlers = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        this.consoleErrors.push(msg.params.entry.text);
      }
      const handler = this.handlers.get(msg.method);
      if (handler) handler(msg.params);
    });
  }

  /** 订阅一个 CDP 事件（只留最后一个处理器，本套件够用）。 */
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

const expiresAt = new Date(Date.now() + 3600_000).toISOString();
await cdp.send("Page.navigate", { url: `${WEB}/login` });
await sleep(2200);
await cdp.evaluate(`localStorage.setItem('MM-auth', ${JSON.stringify(JSON.stringify({
  accessToken: token,
  refreshToken: token,
  accessTokenExpiresAt: expiresAt,
  refreshTokenExpiresAt: expiresAt,
}))}); true`);

/** 打开聊天页并点开第一个会话。 */
async function openChat(width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 600,
  });
  await cdp.send("Page.navigate", { url: `${WEB}/chat` });
  await sleep(2500);

  // 会话列表是异步拉的：轮询等它出来，别用固定 sleep 赌（慢机器上会误判成「没有会话」）
  let hasList = false;
  for (let i = 0; i < 40; i += 1) {
    hasList = await cdp.evaluate(`document.querySelectorAll('.conversation-list li').length > 0`);
    if (hasList) break;
    await sleep(250);
  }
  if (!hasList) return false;

  const opened = await cdp.evaluate(
    `(() => { const li = document.querySelector('.conversation-list li'); if (!li) return false; li.click(); return true; })()`,
  );
  if (!opened) return false;

  // 消息列表同理：等到真有消息挂上来再量
  for (let i = 0; i < 40; i += 1) {
    const ready = await cdp.evaluate(`document.querySelectorAll('.message-list .msg-item').length > 0`);
    if (ready) break;
    await sleep(250);
  }

  // 滚到最底部：图片是懒加载的（不在视口里就不下 blob，也就没有 <img>），
  // 窄屏尤其容易漏 —— 不滚下去会误判成「没有图片消息」。
  await cdp.evaluate(`(() => {
    const box = document.querySelector('.message-list-container') || document.querySelector('.message-list')?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
    return true;
  })()`);
  await sleep(1200);
  return true;
}

/**
 * 量一遍「最后一条文件类气泡 + 整体几何」。
 *
 * 关键量：
 *   · mediaMsg：自己发的媒体消息（.msg-item.mine.has-media）里的整体几何；
 *   · bubbleGap：图片右边缘到「头像左边缘」的距离（row-reverse 下头像在右）——
 *     这个值应该正好等于 --chat-gap，说明气泡贴着头像，而不是飘在一大段空白的那头。
 */
const MEASURE = `(() => {
  const px = (el, prop) => (el ? parseFloat(getComputedStyle(el).getPropertyValue(prop)) || 0 : 0);
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, left: r.left }; };
  const page = document.querySelector('.chat-page');
  if (!page) return { error: 'chat page not mounted' };

  const items = [...document.querySelectorAll('.message-list .msg-item')];
  const fileItems = items.filter((el) => el.querySelector('.file-message'));
  const kindOf = (el) => (el.classList.contains('has-media') ? 'media' : el.classList.contains('has-file') ? 'card' : 'other');

  const describe = (el) => {
    const wrap = el.querySelector('.file-item-wrap');
    const img = el.querySelector('.image-message img');
    const media = el.querySelector('.image-message');
    const avatar = el.querySelector('.message-avatar');
    const bubbleWrap = el.querySelector('.bubble-wrap');
    const overlay = el.querySelector('.upload-visual-overlay');
    const kind = kindOf(el);
    return {
      kind,
      mine: el.classList.contains('mine'),
      header: (el.querySelector('.header-text')?.textContent ?? '').trim(),
      wrapW: wrap ? rect(wrap).w : null,
      mediaW: media ? rect(media).w : null,
      imgW: img ? rect(img).w : null,
      bubbleWrapRight: bubbleWrap ? rect(bubbleWrap).right : null,
      imgRight: img ? rect(img).right : null,
      avatarLeft: avatar ? rect(avatar).left : null,
      imgLeft: img ? rect(img).left : null,
      overlay: overlay ? {
        badge: (overlay.querySelector('.upload-progress-badge')?.textContent ?? '').trim(),
        radius: getComputedStyle(overlay).getPropertyValue('--upload-progress').trim(),
        mask: getComputedStyle(overlay, '::before').maskImage,
      } : null,
    };
  };

  const gap = parseFloat(getComputedStyle(page).getPropertyValue('--chat-gap')) || 0;
  return {
    gap,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    total: items.length,
    files: fileItems.map(describe),
    pending: fileItems
      .filter((el) => /发送中|准备中|上传/.test((el.querySelector('.header-text')?.textContent ?? '') + (el.querySelector('.meta.foot')?.textContent ?? '')))
      .map(describe),
    overlayNow: fileItems.map(describe).filter((d) => d.overlay).map((d) => d.overlay),
  };
})()`;

/** 把图片塞进真实的 file input（等价于用户在选择器里选了它）。 */
const INJECT = `(() => {
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
})()`;

// ══════════════════════════════════════════════════════════════════════════
// 场景一：桌面端上传一张小图，走完整个生命周期
// ══════════════════════════════════════════════════════════════════════════
const DESKTOP = { width: 1400, height: 900 };
console.log(`\n— 桌面 ${DESKTOP.width}×${DESKTOP.height}：上传 ${IMG_W}×${IMG_H} 图片 —`);
if (!(await openChat(DESKTOP.width, DESKTOP.height))) {
  skip("会话列表为空（先登录一次让账号有会话数据）");
}

const before = await cdp.evaluate(MEASURE);
const cardWidthsBefore = (before.files ?? []).filter((f) => f.kind === "card" && f.wrapW).map((f) => f.wrapW);
check(
  "上传前：文档 / 音频卡片能撑开（>100px，不再是塌成最小宽度）",
  cardWidthsBefore.length > 0 && cardWidthsBefore.every((w) => w > 120),
  `实测 ${JSON.stringify(cardWidthsBefore)}`,
);

// 想在浏览器里"看到"上传中的动画，必须先让上传慢下来 —— 但
//   · localhost 上 57KB 是瞬间传完的；
//   · Network.emulateNetworkConditions 只限下载，上行不受它影响（实测无效）。
// 所以改用 Fetch 域：**把上传请求按住在"发出前"**，此刻 isUploading 仍是 true、
// 进度仍是 0%，界面必然停在「上传中 + 灰色蒙层」这一帧，采样不再靠抢时间。
let pausedUploadId = null;
await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/mm/files/*/upload*", requestStage: "Request" }] });
cdp.on("Fetch.requestPaused", (params) => {
  pausedUploadId = params.requestId;
});

// 落地那一瞬间不许出现两个同图气泡（待发气泡 + 确认消息）。
// 用 rAF 逐帧盯：这是 16ms 级别的事，靠 200ms 轮询根本抓不到。
await cdp.evaluate(`(() => {
  const name = ${JSON.stringify(FILE_NAME)};
  window.__dupMax = 0;
  const tick = () => {
    const n = document.querySelectorAll('.message-list .msg-item .image-message img[alt="' + name + '"]').length;
    if (n > window.__dupMax) window.__dupMax = n;
    window.__dupRaf = requestAnimationFrame(tick);
  };
  window.__dupRaf = requestAnimationFrame(tick);
  return true;
})()`);

console.log(`INFO  注入文件：${await cdp.evaluate(INJECT)}`);

// 等上传请求被按住（最多 5s）
for (let i = 0; i < 100; i += 1) {
  if (pausedUploadId) break;
  await sleep(50);
}
check("上传请求被按住在发送前（用于观察上传中的界面）", Boolean(pausedUploadId), "没等到 Fetch.requestPaused");

// ── 上传中那一帧：灰蒙层 + 径向挖空（先确认它存在，再验证动画契约） ──
const animationProbe = await cdp.evaluate(`(() => {
  const overlay = document.querySelector('.upload-visual-overlay');
  if (!overlay) return { error: 'no .upload-visual-overlay while uploading' };
  const paint = getComputedStyle(overlay, '::before');
  const badge = (overlay.querySelector('.upload-progress-badge')?.textContent ?? '').trim();
  const readAt = (value) => {
    overlay.style.setProperty('--upload-progress', value);
    return getComputedStyle(overlay, '::before').maskImage;
  };
  const result = {
    scrim: paint.backgroundColor,
    hasMask: paint.maskImage !== 'none',
    m0: readAt('0%'),
    m50: readAt('50%'),
    m100: readAt('100%'),
    badge,
  };
  overlay.style.removeProperty('--upload-progress');
  return result;
})()`);

check("上传中图片上出现了灰色蒙层（.upload-visual-overlay）", !animationProbe?.error, animationProbe?.error ?? "");
if (!animationProbe?.error) {
  const alpha = Number((/rgba?\([^)]*?,\s*([\d.]+)\)/.exec(animationProbe.scrim)?.[1] ?? "1"));
  check(
    "蒙层是「灰色」而不是接近全黑（图片始终看得见）",
    alpha > 0.2 && alpha < 0.85,
    `背景 ${animationProbe.scrim}`,
  );

  /** 从 mask-image 里取出「透明区（挖空）」的半径百分比。 */
  const hollowRadius = (mask) => {
    const match = /rgba\(0,\s*0,\s*0,\s*0\)\s*0(?:px|%)?,\s*rgba\(0,\s*0,\s*0,\s*0\)\s*([\d.]+)%/.exec(mask ?? "");
    return match ? Number(match[1]) : null;
  };

  check(
    "蒙层用 radial-gradient 做遮罩（从中心往外挖空）",
    [animationProbe.m0, animationProbe.m50, animationProbe.m100].every((m) => (m ?? "").includes("radial-gradient")),
    `mask：${String(animationProbe.m0).slice(0, 80)}`,
  );
  check(
    "挖空半径 = 上传进度（0% → 50% → 100%，蒙层由中心向四周让开）",
    hollowRadius(animationProbe.m0) === 0
      && hollowRadius(animationProbe.m50) === 50
      && hollowRadius(animationProbe.m100) === 100,
    `实测 ${[animationProbe.m0, animationProbe.m50, animationProbe.m100].map(hollowRadius).join(" / ")}`,
  );
}

// 放行被按住的上传请求，让流程继续走完
if (pausedUploadId) {
  await cdp.send("Fetch.continueRequest", { requestId: pausedUploadId });
  pausedUploadId = null;
}

// 边上传边采样：既要看到上传遮罩，也要确认它最后会收掉

let pendingStuck = null;
const startedAt = Date.now();
let settled = false;

while (Date.now() - startedAt < 20000) {
  const snap = await cdp.evaluate(MEASURE);
  if (process.env.DEBUG_UPLOAD) {
    const dbg = await cdp.evaluate(`(() => {
      const items = [...document.querySelectorAll('.message-list .msg-item')];
      const last = items[items.length - 1];
      return { n: items.length, cls: last?.className, file: !!last?.querySelector('.file-message'),
        img: !!last?.querySelector('.image-message img'), overlay: !!last?.querySelector('.upload-visual-overlay'),
        header: (last?.querySelector('.header-text')?.textContent ?? '').trim(),
        html: (last?.querySelector('.file-message')?.outerHTML ?? '').slice(0, 260) };
    })()`);
    console.log("DBG", JSON.stringify(dbg));
  }
  const stillPending = (snap.pending ?? []).length > 0;
  if (!stillPending && (snap.files ?? []).some((f) => f.kind === "media" && f.mine && f.imgW)) {
    settled = true;
    break;
  }
  if (stillPending) pendingStuck = Date.now() - startedAt;
  await sleep(90);
}

check("上传结束后待发气泡消失（不会卡在「准备中」/「发送中」）", settled, `已过 ${pendingStuck ?? "-"}ms 仍在待发状态`);

await sleep(900);
const dupMax = await cdp.evaluate(`(() => { if (window.__dupRaf) cancelAnimationFrame(window.__dupRaf); return window.__dupMax ?? 0; })()`);
check(
  "落地时不会闪出两个同图气泡（逐帧采样同一张图最多 1 个）",
  dupMax <= 1,
  `峰值 ${dupMax} 个气泡同时显示同一张图`,
);

const after = await cdp.evaluate(MEASURE);
const myImage = (after.files ?? []).filter((f) => f.kind === "media" && f.mine && f.imgW).pop();
check("落成了一条自己的图片消息", Boolean(myImage), JSON.stringify(after.files?.slice(-2) ?? []));

if (myImage) {
  check(
    `图片按自身宽度显示（${IMG_W}px，没被塞进 300px 盒子）`,
    Math.abs(myImage.imgW - IMG_W) <= 2,
    `实测 img ${round(myImage.imgW)}px`,
  );
  check(
    "媒体气泡贴合图片（.file-item-wrap ≈ img 宽度）",
    Math.abs(myImage.wrapW - myImage.imgW) <= 2,
    `wrap ${round(myImage.wrapW)}px vs img ${round(myImage.imgW)}px`,
  );
  const distanceToAvatar = myImage.avatarLeft - myImage.imgRight;
  check(
    `图片贴着右侧头像（间距 ≈ ${after.gap}px 的 --chat-gap）`,
    Math.abs(distanceToAvatar - after.gap) <= 2,
    `图片右边缘到头像左边缘 ${round(distanceToAvatar)}px`,
  );
  check(
    "气泡右边缘与图片右边缘对齐（没有透明留白）",
    Math.abs(myImage.bubbleWrapRight - myImage.imgRight) <= 2,
    `bubble-wrap ${round(myImage.bubbleWrapRight)} vs img ${round(myImage.imgRight)}`,
  );
}

const cardWidthsAfter = (after.files ?? []).filter((f) => f.kind === "card" && f.wrapW).map((f) => f.wrapW);
check(
  "上传后：文档 / 音频卡片仍能撑开（没被媒体规则带塌）",
  cardWidthsAfter.length > 0 && cardWidthsAfter.every((w) => w > 120),
  `实测 ${JSON.stringify(cardWidthsAfter)}`,
);
check("桌面端无横向溢出", after.overflowX <= 1, `溢出 ${after.overflowX}px`);
check("页面没有渲染错误", cdp.consoleErrors.length === 0, cdp.consoleErrors.slice(0, 3).join(" | "));

// ══════════════════════════════════════════════════════════════════════════
// 场景二 / 三：窄屏 —— 媒体必须跟着收缩，不许顶破气泡
// ══════════════════════════════════════════════════════════════════════════
for (const vp of [
  { name: "手机 360×800", width: 360, height: 800 },
  { name: "极窄 320×568", width: 320, height: 568 },
]) {
  console.log(`\n— ${vp.name} —`);
  if (!(await openChat(vp.width, vp.height))) {
    check(`${vp.name} 能打开会话`, false, "会话列表为空");
    continue;
  }
  const snap = await cdp.evaluate(MEASURE);
  check(`${vp.name} 无横向溢出`, snap.overflowX <= 1, `溢出 ${snap.overflowX}px`);

  const mineMedia = (snap.files ?? []).filter((f) => f.kind === "media" && f.mine && f.imgW);
  const widest = mineMedia.sort((a, b) => b.imgW - a.imgW)[0];
  if (widest) {
    check(
      `${vp.name} 图片不超出气泡（wrap ≥ img）`,
      widest.wrapW + 1 >= widest.imgW,
      `wrap ${round(widest.wrapW)} vs img ${round(widest.imgW)}`,
    );
    check(
      `${vp.name} 自己的图片仍贴右（右侧到头像 ≈ ${snap.gap}px）`,
      Math.abs(widest.avatarLeft - widest.imgRight - snap.gap) <= 2,
      `实测 ${round(widest.avatarLeft - widest.imgRight)}px`,
    );
  } else {
    console.log(`INFO  ${vp.name} 没有自己的图片消息，跳过贴右断言`);
  }
}

await cdp.send("Fetch.disable");
await cdp.send("Emulation.clearDeviceMetricsOverride");
killChrome();

console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
