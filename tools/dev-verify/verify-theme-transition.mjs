/**
 * 主题切换动画验证（真实浏览器）。
 *
 *   node tools/dev-verify/verify-theme-transition.mjs
 *
 * 覆盖：
 * - 默认主题色 #e3c0df 落到 --theme-color / --accent-color；
 * - 日 -> 夜切换时启用 View Transitions：::view-transition-new(root)
 *   播放 theme-root-reveal（从中心揭开的圆），theme-ripple 命名组播放
 *   theme-ripple-ring（环形波纹），结束后状态与 localStorage 正确；
 * - 不支持 View Transitions 的降级路径：.theme-colors-transitioning
 *   颜色过渡 + 真实波纹元素动画，结束后清理干净；
 * - 动画中快速连点：最终落到最后一次选择，不残留动画类；
 * - prefers-reduced-motion: reduce 时程序化 setTheme 立即生效；
 *   但顶栏 toggleTheme 会强制播放波纹，不能变成无反馈瞬切。
 *
 * 不依赖后端 / 数据库 / Redis，只要求 dev server + chromium。
 * 缺任何一个都会 SKIP 并返回 0。
 *
 * 为什么用动态 import('/src/composables/use-theme.ts')：
 * 登录页没有主题切换按钮，而验证只需要点一次真实的切换入口逻辑；
 * 动态 import 拿到的是应用同一份模块实例，不会绕过 View Transition。
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WEB = process.env.DEV_VERIFY_WEB ?? "http://127.0.0.1:5173";
const DEBUG_PORT = Number(process.env.DEV_VERIFY_THEME_CDP_PORT ?? 9347);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  <- ${detail}`}`);
};
const skip = (reason) => {
  console.log(`SKIP  主题切换动画验证：${reason}`);
  console.log("\n跳过（前置条件不满足）");
  process.exit(0);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const colorLuminance = (hex) => {
  const value = String(hex).replace("#", "");
  if (!/^[\da-f]{6}$/i.test(value)) return NaN;
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const colorContrast = (a, b) => {
  const [lighter, darker] = [colorLuminance(a), colorLuminance(b)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
};

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
const profileDir = mkdtempSync(path.join(tmpdir(), "theme-transition-"));
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

// ── 极简 CDP 客户端 ───────────────────────────────────────────────────────
async function newPageTarget() {
  const res = await fetch(
    `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  );
  return await res.json();
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.pageExceptions = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.exceptionThrown") {
        const detail = msg.params?.exceptionDetails;
        this.pageExceptions.push(detail?.exception?.description ?? detail?.text ?? "unknown");
        return;
      }
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

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

const target = await newPageTarget();
if (!target?.webSocketDebuggerUrl) {
  killChrome();
  skip("无法创建调试页面");
}
const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 393,
  height: 852,
  deviceScaleFactor: 1,
  mobile: true,
});
await cdp.send("Page.navigate", { url: `${WEB}/login` });

/** 轮询页面条件，避免设备慢时固定 sleep 截不到动画中间帧。 */
async function waitFor(expression, timeout = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    try {
      if (await cdp.evaluate(expression)) return true;
    } catch {
      /* 页面还没稳定 */
    }
    await sleep(50);
  }
  return false;
}

// 等登录页挂载完成，再拿主题模块
let mounted = false;
for (let i = 0; i < 60; i += 1) {
  try {
    mounted = await cdp.evaluate(`!!document.querySelector("#app")?.children.length`);
    if (mounted) break;
  } catch {
    /* 页面还在加载 */
  }
  await sleep(200);
}
if (!mounted) {
  console.log("FAIL  登录页在 12s 内没有挂载");
  killChrome();
  process.exit(1);
}
await sleep(300);

try {
  await cdp.evaluate(`(async () => {
    window.__themeTest = await import('/src/composables/use-theme.ts');
    return true;
  })()`);
} catch (error) {
  console.log(`FAIL  无法加载主题模块：${String(error.message ?? error).split("\n")[0]}`);
  killChrome();
  process.exit(1);
}

// ── 1. 初始状态 / 默认主题色 ───────────────────────────────────────────────
const initial = await cdp.evaluate(`(() => {
  const root = document.documentElement;
  return {
    theme: root.getAttribute('data-theme'),
    dark: root.classList.contains('dark'),
    themeColor: getComputedStyle(root).getPropertyValue('--theme-color').trim().toLowerCase(),
    strong: getComputedStyle(root).getPropertyValue('--theme-color-strong').trim().toLowerCase(),
    soft: getComputedStyle(root).getPropertyValue('--theme-color-soft').trim().toLowerCase(),
    accent: getComputedStyle(root).getPropertyValue('--accent-color').trim().toLowerCase(),
    accentAlt: getComputedStyle(root).getPropertyValue('--accent-alt').trim().toLowerCase(),
    actionBg: getComputedStyle(root).getPropertyValue('--theme-action-bg').trim().toLowerCase(),
    actionContrast: getComputedStyle(root).getPropertyValue('--theme-action-contrast').trim().toLowerCase(),
    elPrimary: getComputedStyle(root).getPropertyValue('--el-color-primary').trim().toLowerCase(),
    vt: typeof document.startViewTransition,
  };
})()`);
check("初始主题为日间", initial.theme === "light" && initial.dark === false, JSON.stringify(initial));
check("默认主题色 #e3c0df 作为种子色生效（--theme-color）", initial.themeColor === "#e3c0df", JSON.stringify(initial));
check(
  "日间强调色 / EP primary 压深到可读色（白底对比度 >= 4.5）",
  initial.strong === initial.accent &&
    initial.accent === initial.elPrimary &&
    colorContrast(initial.strong, "#ffffff") >= 4.5,
  JSON.stringify(initial),
);
check(
  "日间柔和底色是主题浅色，accent-alt 仍是种子色（不再有蓝色）",
  colorLuminance(initial.soft) > 0.8 &&
    (initial.accentAlt === "#e3c0df" || initial.accentAlt === "rgb(227, 192, 223)"),
  JSON.stringify(initial),
);
check(
  "日间深色动作按钮 = 强调色，白字对比度 >= 4.5",
  initial.actionBg === initial.strong &&
    initial.actionContrast === "#ffffff" &&
    colorContrast(initial.actionBg, "#ffffff") >= 4.5,
  JSON.stringify(initial),
);
check("当前 chromium 支持 View Transitions", initial.vt === "function", initial.vt);

// 动画从日间开始，确保路径一致
await cdp.evaluate(`window.__themeTest.setTheme('light', { animate: false })`);
await sleep(50);

// ── 2. 日 -> 夜：View Transition + 圆形揭开 + 环形波纹 ─────────────────────
await cdp.evaluate(`(() => {
  window.__vtResult = window.__themeTest.setTheme('dark');
  return true;
})()`, false);
const caughtVt = await waitFor(`
  document.documentElement.getAttribute('data-theme') === 'dark' &&
  document.getAnimations().some((animation) => animation.animationName === 'theme-root-reveal')
`);

const mid = await cdp.evaluate(`(() => {
  const root = document.documentElement;
  const layer = document.getElementById('theme-ripple-layer');
  const animations = document.getAnimations()
    .filter((animation) => animation.effect && animation.effect.pseudoElement)
    .map((animation) => ({
      name: animation.animationName,
      pseudo: animation.effect.pseudoElement,
    }));
  return {
    theme: root.getAttribute('data-theme'),
    switching: root.classList.contains('theme-switching'),
    layer: !!layer,
    ringName: layer ? getComputedStyle(layer).viewTransitionName : null,
    endRadius: root.style.getPropertyValue('--theme-ripple-end-radius'),
    diameter: layer ? layer.style.getPropertyValue('--theme-ripple-diameter') : null,
    animations,
  };
})()`);
check("能在动画窗口内捕获切换帧", caughtVt === true);
check("切换后 data-theme 为 dark", mid.theme === "dark", JSON.stringify(mid));
check("切换期间挂上 .theme-switching", mid.switching === true);
check("生成波纹层并命名为 theme-ripple", mid.layer && mid.ringName === "theme-ripple", JSON.stringify(mid));
check("圆形揭开的结束半径按视口算出", /^\d+(\.\d+)?%$/.test(mid.endRadius), mid.endRadius);
check("波纹层直径为正的像素值", /^\d+(\.\d+)?px$/.test(mid.diameter), mid.diameter);
check(
  "整页播放 theme-root-reveal（圆形揭开）",
  mid.animations.some(
    (a) => a.name === "theme-root-reveal" && a.pseudo === "::view-transition-new(root)",
  ),
  JSON.stringify(mid.animations),
);
check(
  "波纹组播放 theme-ripple-ring（环形波纹）",
  mid.animations.some(
    (a) => a.name === "theme-ripple-ring" && a.pseudo === "::view-transition-new(theme-ripple)",
  ),
  JSON.stringify(mid.animations),
);

await cdp.evaluate(`(async () => { await window.__vtResult; })()`);
await sleep(80);
const afterVt = await cdp.evaluate(`(() => {
  const root = document.documentElement;
  const layer = document.getElementById('theme-ripple-layer');
  return {
    theme: root.getAttribute('data-theme'),
    dark: root.classList.contains('dark'),
    switching: root.classList.contains('theme-switching'),
    stored: localStorage.getItem('theme'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    layerSwitching: layer ? getComputedStyle(layer).viewTransitionName : 'missing',
    strong: getComputedStyle(root).getPropertyValue('--theme-color-strong').trim().toLowerCase(),
    accent: getComputedStyle(root).getPropertyValue('--accent-color').trim().toLowerCase(),
    actionBg: getComputedStyle(root).getPropertyValue('--theme-action-bg').trim().toLowerCase(),
    actionContrast: getComputedStyle(root).getPropertyValue('--theme-action-contrast').trim().toLowerCase(),
    elPrimary: getComputedStyle(root).getPropertyValue('--el-color-primary').trim().toLowerCase(),
  };
})()`);
check("动画结束后主题状态正确", afterVt.theme === "dark" && afterVt.dark === true, JSON.stringify(afterVt));
check("动画结束后清理 .theme-switching", afterVt.switching === false);
check("夜间选择写入 localStorage", afterVt.stored === "dark", afterVt.stored);
check("夜间背景色已应用", afterVt.bodyBg === "rgb(2, 6, 23)", afterVt.bodyBg);
check(
  "夜间强调色 / EP primary 回到种子色 #e3c0df",
  afterVt.strong === "#e3c0df" &&
    afterVt.accent === "#e3c0df" &&
    afterVt.elPrimary === "#e3c0df",
  JSON.stringify(afterVt),
);
check(
  "夜间深色动作按钮保持深色底 + 可读白字",
  afterVt.actionContrast === "#ffffff" &&
    colorContrast(afterVt.actionBg, "#ffffff") >= 4.5,
  JSON.stringify(afterVt),
);
check("动画结束后波纹层恢复未命名", afterVt.layerSwitching === "none", afterVt.layerSwitching);

// ── 3. 降级路径：模拟不支持 View Transitions ───────────────────────────────
await cdp.evaluate(`(() => {
  window.__nativeStartViewTransition = document.startViewTransition;
  document.startViewTransition = undefined;
  window.__fallbackResult = window.__themeTest.setTheme('light');
  return true;
})()`, false);
const caughtFallback = await waitFor(`
  document.documentElement.classList.contains('theme-colors-transitioning') &&
  !!document.getElementById('theme-ripple-layer')?.classList.contains('is-rippling')
`);
const fallback = await cdp.evaluate(`(() => {
  const root = document.documentElement;
  const layer = document.getElementById('theme-ripple-layer');
  const animations = layer ? layer.getAnimations() : [];
  return {
    theme: root.getAttribute('data-theme'),
    colorClass: root.classList.contains('theme-colors-transitioning'),
    rippling: layer ? layer.classList.contains('is-rippling') : false,
    ringAnimations: animations
      .filter((animation) => animation.effect.getKeyframes().length === 4)
      .map((animation) => ({
        duration: animation.effect.getTiming().duration,
        state: animation.playState,
      })),
    bodyTransition: getComputedStyle(document.body).transitionProperty,
  };
})()`);
check("能在动画窗口内捕获降级路径", caughtFallback === true);
check("降级路径切到 light", fallback.theme === "light", JSON.stringify(fallback));
check("降级路径挂上颜色过渡类", fallback.colorClass === true);
check("降级路径波纹元素开始扩散", fallback.rippling === true);
check(
  "降级路径播放 1100ms 波纹动画",
  fallback.ringAnimations.length > 0 && fallback.ringAnimations.every((a) => a.duration === 1100),
  JSON.stringify(fallback.ringAnimations),
);
check(
  "降级路径确实对颜色属性做 transition",
  fallback.bodyTransition.includes("background-color") && fallback.bodyTransition.includes("color"),
  fallback.bodyTransition,
);

await cdp.evaluate(`(async () => { await window.__fallbackResult; })()`);
await sleep(80);
const afterFallback = await cdp.evaluate(`(() => {
  const root = document.documentElement;
  const layer = document.getElementById('theme-ripple-layer');
  return {
    theme: root.getAttribute('data-theme'),
    colorClass: root.classList.contains('theme-colors-transitioning'),
    rippling: layer ? layer.classList.contains('is-rippling') : null,
    stored: localStorage.getItem('theme'),
  };
})()`);
check(
  "降级动画结束后清理类并写入存储",
  afterFallback.theme === "light" &&
    afterFallback.colorClass === false &&
    afterFallback.rippling === false &&
    afterFallback.stored === "light",
  JSON.stringify(afterFallback),
);

// ── 4. 动画中快速连点：最终落到最后一次选择 ───────────────────────────────
await cdp.evaluate(`(() => {
  // 仍处于降级路径（startViewTransition 已被置空），连续点三次：
  // light -> dark -> light -> dark，最终必须是 dark
  window.__themeTest.setTheme('dark');
  window.__themeTest.setTheme('light');
  window.__themeTest.setTheme('dark');
  return true;
})()`);
// 降级动画现在 1100ms，等它完整结束再断言，避免把「仍在切换」当成残留
await sleep(1400);
const rapid = await cdp.evaluate(`(() => {
  const root = document.documentElement;
  return {
    theme: root.getAttribute('data-theme'),
    dark: root.classList.contains('dark'),
    switching: root.classList.contains('theme-switching'),
    colorClass: root.classList.contains('theme-colors-transitioning'),
    stored: localStorage.getItem('theme'),
  };
})()`);
check(
  "快速连点合并为最后一次选择",
  rapid.theme === "dark" && rapid.dark === true && rapid.stored === "dark",
  JSON.stringify(rapid),
);
check(
  "快速连点后不残留动画类",
  rapid.switching === false && rapid.colorClass === false,
  JSON.stringify(rapid),
);

// ── 5. 减少动态效果：立即切换 ─────────────────────────────────────────────
await cdp.send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
const reduced = await cdp.evaluate(`(async () => {
  const startedAt = performance.now();
  await window.__themeTest.setTheme('light');
  const root = document.documentElement;
  return {
    elapsed: performance.now() - startedAt,
    theme: root.getAttribute('data-theme'),
    switching: root.classList.contains('theme-switching'),
    colorClass: root.classList.contains('theme-colors-transitioning'),
    stored: localStorage.getItem('theme'),
  };
})()`);
check(
  "减少动态效果时立即切到 light",
  reduced.theme === "light" && reduced.stored === "light",
  JSON.stringify(reduced),
);
check(
  "减少动态效果时不挂任何动画类",
  reduced.switching === false && reduced.colorClass === false,
  JSON.stringify(reduced),
);
check("减少动态效果时切换耗时 < 100ms", reduced.elapsed < 100, `${reduced.elapsed.toFixed(1)}ms`);

// ── 6. 减少动态效果下，用户主动点顶栏仍要播放波纹 ─────────────────────────
// 这一步专门防「系统开了移除动画，按钮点了却只是瞬切」的回归。
await cdp.evaluate(`(() => {
  document.startViewTransition = window.__nativeStartViewTransition;
  window.__forcedToggle = window.__themeTest.toggleTheme();
  return true;
})()`, false);
const caughtForced = await waitFor(`
  document.documentElement.classList.contains('theme-switching') &&
  document.getAnimations().some((animation) => animation.animationName === 'theme-root-reveal')
`);
const forcedMid = await cdp.evaluate(`(() => {
  const root = document.documentElement;
  return {
    theme: root.getAttribute('data-theme'),
    switching: root.classList.contains('theme-switching'),
    animations: document.getAnimations()
      .filter((animation) => animation.effect && animation.effect.pseudoElement)
      .map((animation) => ({
        name: animation.animationName,
        pseudo: animation.effect.pseudoElement,
      })),
  };
})()`);
check("减少动态效果下点击按钮仍能捕获切换帧", caughtForced === true);
check("减少动态效果下点击按钮仍切到 dark", forcedMid.theme === "dark", JSON.stringify(forcedMid));
check(
  "减少动态效果下点击按钮仍播放环形波纹",
  forcedMid.animations.some(
    (a) => a.name === "theme-ripple-ring" && a.pseudo === "::view-transition-new(theme-ripple)",
  ),
  JSON.stringify(forcedMid.animations),
);
await cdp.evaluate(`(async () => { await window.__forcedToggle; })()`);
await sleep(80);
const afterForced = await cdp.evaluate(`(() => {
  const root = document.documentElement;
  return {
    theme: root.getAttribute('data-theme'),
    switching: root.classList.contains('theme-switching'),
    colorClass: root.classList.contains('theme-colors-transitioning'),
    stored: localStorage.getItem('theme'),
  };
})()`);
check(
  "减少动态效果下点击按钮动画结束后状态正确",
  afterForced.theme === "dark" &&
    afterForced.switching === false &&
    afterForced.colorClass === false &&
    afterForced.stored === "dark",
  JSON.stringify(afterForced),
);

// ── 6. 自定义主题色：生成全套色阶 + 持久化 ────────────────────────────────
await cdp.evaluate(`window.__themeTest.setThemeColor('#e3c0df')`);
await cdp.evaluate(`window.__themeTest.setTheme('light', { animate: false })`);
const customLight = await cdp.evaluate(`(() => {
  const m = window.__themeTest;
  const ok = m.setThemeColor('#4f8cff');
  const cs = getComputedStyle(document.documentElement);
  return {
    ok,
    seed: cs.getPropertyValue('--theme-color').trim().toLowerCase(),
    strong: cs.getPropertyValue('--theme-color-strong').trim().toLowerCase(),
    actionBg: cs.getPropertyValue('--theme-action-bg').trim().toLowerCase(),
    actionContrast: cs.getPropertyValue('--theme-action-contrast').trim().toLowerCase(),
    ep: cs.getPropertyValue('--el-color-primary').trim().toLowerCase(),
    stored: localStorage.getItem('themeColor'),
    transitioning: document.documentElement.classList.contains('theme-color-transitioning'),
    duration: cs.getPropertyValue('--theme-color-transition-duration').trim(),
  };
})()`);
check(
  "自定义主题色写入种子色并持久化",
  customLight.ok === true &&
    customLight.seed === "#4f8cff" &&
    customLight.stored === "#4f8cff",
  JSON.stringify(customLight),
);
check(
  "自定义主题色同步 Element Plus primary 与深色动作按钮",
  customLight.ep === customLight.strong &&
    customLight.actionContrast === "#ffffff" &&
    colorContrast(customLight.actionBg, "#ffffff") >= 4.5,
  JSON.stringify(customLight),
);
check(
  "主题色变化时挂上 500ms 纯颜色过渡类",
  customLight.transitioning === true && customLight.duration === "500ms",
  JSON.stringify(customLight),
);
await sleep(650);
const colorTransitionSettled = await cdp.evaluate(
  `!document.documentElement.classList.contains('theme-color-transitioning')`,
);
check("颜色过渡结束后清理类", colorTransitionSettled === true);

// 先切到夜间，再读自定义色在夜间的色阶
await cdp.evaluate(`window.__themeTest.setTheme('dark', { animate: false })`);
const customDarkAfter = await cdp.evaluate(`(() => {
  const cs = getComputedStyle(document.documentElement);
  return {
    theme: document.documentElement.dataset.theme,
    seed: cs.getPropertyValue('--theme-color').trim().toLowerCase(),
    strong: cs.getPropertyValue('--theme-color-strong').trim().toLowerCase(),
    actionBg: cs.getPropertyValue('--theme-action-bg').trim().toLowerCase(),
    actionContrast: cs.getPropertyValue('--theme-action-contrast').trim().toLowerCase(),
    ep: cs.getPropertyValue('--el-color-primary').trim().toLowerCase(),
  };
})()`);
check(
  "自定义色夜间生成更亮的强调色并保持白字动作按钮",
  customDarkAfter.theme === 'dark' &&
    customDarkAfter.seed === "#4f8cff" &&
    customDarkAfter.ep === customDarkAfter.strong &&
    customDarkAfter.actionContrast === "#ffffff" &&
    colorContrast(customDarkAfter.actionBg, "#ffffff") >= 4.5,
  JSON.stringify(customDarkAfter),
);

await cdp.evaluate(`window.__themeTest.setThemeColor('#e3c0df')`);
await cdp.evaluate(`window.__themeTest.setTheme('light', { animate: false })`);
const restored = await cdp.evaluate(`(() => {
  const cs = getComputedStyle(document.documentElement);
  return {
    seed: cs.getPropertyValue('--theme-color').trim().toLowerCase(),
    stored: localStorage.getItem('themeColor'),
    theme: document.documentElement.dataset.theme,
  };
})()`);
check(
  "恢复默认主题色 #e3c0df",
  restored.seed === "#e3c0df" &&
    restored.stored === "#e3c0df" &&
    restored.theme === "light",
  JSON.stringify(restored),
);

check("页面没有未捕获异常", cdp.pageExceptions.length === 0, cdp.pageExceptions.join(" | "));

killChrome();
console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
