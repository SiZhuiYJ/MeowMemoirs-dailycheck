/**
 * 验证「判定结果 -> <html> 属性 / CSS 变量」这一段契约。
 *
 * 为什么需要单独测：CSS 侧的结构切换（.desktop-only / .mobile-only）和尺寸计算
 * 全都依赖 use-device-layout 写出的 data-* 属性和 --app-* 变量。
 * verify-device-layout.mjs 只测了纯函数，测不到「到底写没写、写成了什么」。
 * 这段契约一旦断了，表现是「CSS 与 JS 判定不一致」，非常难查。
 *
 * 用最小 DOM 桩在 Node 里跑，不需要浏览器：
 *   node tools/dev-verify/verify-device-layout-dom.mjs
 */
import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Node 不认识 Vite 的 "@/" 别名，这里补上解析规则，
// 否则被 import 的 .ts 源码里一句 `from "@/utils/device-layout"` 就会直接报错。
// 用 Node 原生的同步钩子，不需要额外的 loader 文件。
const WEB_SRC = fileURLToPath(new URL("../../web/src/", import.meta.url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(WEB_SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  <- ${detail}`}`);
};

// ── 最小 DOM 桩 ───────────────────────────────────────────────────────────
const attributes = new Map();
const cssVars = new Map();
const viewportSize = { width: 852, height: 393, visualHeight: 393 };

globalThis.document = {
  // vue 的 DOM 运行时在导入阶段就会执行 document.createElement("template")，
  // 这里必须给出一个最小实现（测试只用到响应式 API，不会真的用它渲染模板）。
  createElement: () => ({ innerHTML: "", content: { firstChild: null }, style: {} }),
  documentElement: {
    get clientWidth() { return viewportSize.width; },
    get clientHeight() { return viewportSize.height; },
    setAttribute: (name, value) => attributes.set(name, value),
    style: { setProperty: (name, value) => cssVars.set(name, value) },
  },
};

const noop = () => {};
const mediaStub = (query) => ({
  matches: query.includes("coarse"),
  addEventListener: noop,
  removeEventListener: noop,
});

globalThis.window = {
  matchMedia: mediaStub,
  get innerWidth() { return viewportSize.width; },
  get innerHeight() { return viewportSize.height; },
  visualViewport: {
    get height() { return viewportSize.visualHeight; },
    scale: 1,
    addEventListener: noop,
    removeEventListener: noop,
  },
  screen: { orientation: { addEventListener: noop, removeEventListener: noop } },
  addEventListener: noop,
  removeEventListener: noop,
  requestAnimationFrame: (cb) => { cb(); return 1; },
  cancelAnimationFrame: noop,
};

const {
  installDeviceLayout,
  useDeviceLayout,
  refreshDeviceLayout,
} = await import("../../web/src/composables/use-device-layout.ts");

const api = useDeviceLayout();
installDeviceLayout();

// ── 1. 横屏手机（852x393）：走桌面布局 ───────────────────────────────────
check("横屏手机写入 data-layout=desktop", attributes.get("data-layout") === "desktop", `实际 ${attributes.get("data-layout")}`);
check("横屏手机写入 data-orientation=landscape", attributes.get("data-orientation") === "landscape", `实际 ${attributes.get("data-orientation")}`);
check("横屏手机仍标记 data-phone=true（几何上是手机）", attributes.get("data-phone") === "true");
check("横屏手机写入 data-short=true（过矮）", attributes.get("data-short") === "true");
check("横屏手机识别为触屏", attributes.get("data-touch") === "true");
check("横屏手机键盘未弹起", attributes.get("data-keyboard") === "false");
check("useDeviceLayout().isMobile 为 false", api.isMobile.value === false);
check("useDeviceLayout().isDesktop 为 true", api.isDesktop.value === true);
check("useDeviceLayout().isPhoneLandscape 为 true", api.isPhoneLandscape.value === true);
check("useDeviceLayout().isShortViewport 为 true", api.isShortViewport.value === true);
// 设备档位（三档）：横屏手机宽 852 → 平板档（双栏 + 24px 控件）
check("横屏手机写入 data-device=tablet", attributes.get("data-device") === "tablet", `实际 ${attributes.get("data-device")}`);
check("横屏手机 useDeviceLayout().tier 为 tablet", api.tier.value === "tablet", `实际 ${api.tier.value}`);
check("横屏手机 isPhoneTier 为 false（要走双栏）", api.isPhoneTier.value === false);
check("横屏手机 isTabletTier 为 true", api.isTabletTier.value === true);

// CSS 变量：CSS 侧的高度计算直接吃这些值
check("--app-h 写入可视高度 393px", cssVars.get("--app-h") === "393px", `实际 ${cssVars.get("--app-h")}`);
check("--app-w 写入宽度 852px", cssVars.get("--app-w") === "852px", `实际 ${cssVars.get("--app-w")}`);
check("--app-short-side 为 393px", cssVars.get("--app-short-side") === "393px", `实际 ${cssVars.get("--app-short-side")}`);
check("--app-long-side 为 852px", cssVars.get("--app-long-side") === "852px", `实际 ${cssVars.get("--app-long-side")}`);
check("--app-kb 未弹键盘时为 0px", cssVars.get("--app-kb") === "0px", `实际 ${cssVars.get("--app-kb")}`);
check("--app-aspect 约为 2.168", Math.abs(Number(cssVars.get("--app-aspect")) - 852 / 393) < 0.01);

// ── 2. 旋转成竖屏：布局模式必须从桌面翻转成手机 ───────────────────────────
viewportSize.width = 393;
viewportSize.height = 852;
viewportSize.visualHeight = 852;
refreshDeviceLayout();

check("旋转后 data-layout 翻转为 mobile", attributes.get("data-layout") === "mobile", `实际 ${attributes.get("data-layout")}`);
check("旋转后 data-orientation=portrait", attributes.get("data-orientation") === "portrait", `实际 ${attributes.get("data-orientation")}`);
check("旋转后 data-phone 仍为 true", attributes.get("data-phone") === "true");
check("旋转后不再是过矮视口", attributes.get("data-short") === "false");
check("旋转后 --app-h 为 852px", cssVars.get("--app-h") === "852px", `实际 ${cssVars.get("--app-h")}`);
check("旋转后 isMobile 翻转为 true", api.isMobile.value === true);
check("旋转后 isPhonePortrait 为 true", api.isPhonePortrait.value === true);
// 竖屏手机宽 393 → 手机档（单栏）：data-device 必须跟着翻
check("旋转后 data-device 翻转为 phone", attributes.get("data-device") === "phone", `实际 ${attributes.get("data-device")}`);
check("旋转后 isPhoneTier 为 true（单栏）", api.isPhoneTier.value === true);
check("旋转后 isTabletTier 为 false", api.isTabletTier.value === false);

// ── 3. 软键盘弹起：只影响 --app-h，不改布局判定 ──────────────────────────
viewportSize.visualHeight = 852 - 320;
refreshDeviceLayout();

check("键盘弹起写入 data-keyboard=true", attributes.get("data-keyboard") === "true");
check("键盘弹起 --app-h 收缩到 532px", cssVars.get("--app-h") === "532px", `实际 ${cssVars.get("--app-h")}`);
check("键盘弹起 --app-kb 为 320px", cssVars.get("--app-kb") === "320px", `实际 ${cssVars.get("--app-kb")}`);
check("键盘弹起不改变布局判定", attributes.get("data-layout") === "mobile" && attributes.get("data-orientation") === "portrait");

// 横屏 + 键盘：依然按横屏走桌面布局
viewportSize.width = 852;
viewportSize.height = 393;
viewportSize.visualHeight = 393 - 200;
refreshDeviceLayout();
check("横屏 + 软键盘仍写入 data-layout=desktop", attributes.get("data-layout") === "desktop", `实际 ${attributes.get("data-layout")}`);
check("横屏 + 软键盘写入 data-keyboard=true", attributes.get("data-keyboard") === "true");
check("横屏 + 软键盘 --app-h 为 193px", cssVars.get("--app-h") === "193px", `实际 ${cssVars.get("--app-h")}`);

// ── 4. 换成桌面：横屏但大屏也要保持 desktop ──────────────────────────────
viewportSize.visualHeight = 900;
viewportSize.width = 1440;
viewportSize.height = 900;
refreshDeviceLayout();

check("桌面写入 data-layout=desktop", attributes.get("data-layout") === "desktop", `实际 ${attributes.get("data-layout")}`);
check("桌面 data-phone=false", attributes.get("data-phone") === "false");
check("桌面 data-short=false", attributes.get("data-short") === "false");
check("桌面 isMobile 为 false", api.isMobile.value === false);
check("桌面 isDesktop 为 true", api.isDesktop.value === true);
check("桌面 --app-h 为 900px", cssVars.get("--app-h") === "900px", `实际 ${cssVars.get("--app-h")}`);
check("桌面写入 data-device=desktop", attributes.get("data-device") === "desktop", `实际 ${attributes.get("data-device")}`);
check("桌面 isDesktopTier 为 true", api.isDesktopTier.value === true);

// ── 4b. 小窗口：桌面布局 + 紧凑密度（用户实际场景 900x700）─────────────
// 关键：data-compact 与 data-layout 是两条独立的轴。
// 900x700 是**桌面布局**但属于**小窗口**，密度要按移动端那套收。
viewportSize.width = 900;
viewportSize.height = 700;
viewportSize.visualHeight = 700;
refreshDeviceLayout();

check("900x700 是桌面布局", attributes.get("data-layout") === "desktop", `实际 ${attributes.get("data-layout")}`);
check("900x700 标记为小窗口(data-compact=true)", attributes.get("data-compact") === "true", `实际 ${attributes.get("data-compact")}`);
check("900x700 isSmallWindow 为 true", api.isSmallWindow.value === true);
check("900x700 不算过矮(data-short=false)", attributes.get("data-short") === "false");
check("900x700 不算手机", attributes.get("data-phone") === "false");
// 900x700 是桌面布局，但宽度在平板档 —— 聊天页按「双栏 + 24px/6px」排
check("900x700 落在平板档(data-device=tablet)", attributes.get("data-device") === "tablet", `实际 ${attributes.get("data-device")}`);

// 竖屏平板（768x1024）：旧实现会判成手机单栏，现在必须是平板档双栏
viewportSize.width = 768;
viewportSize.height = 1024;
viewportSize.visualHeight = 1024;
refreshDeviceLayout();
check("竖屏平板 768x1024 写入 data-device=tablet", attributes.get("data-device") === "tablet", `实际 ${attributes.get("data-device")}`);
check("竖屏平板 768x1024 isPhoneTier 为 false（两个界面一起展示）", api.isPhoneTier.value === false);

// 宽扁小屏（手机横屏）：宽度在手机档，但宽/高 >= 1.5 → 破格走双栏
viewportSize.width = 568;
viewportSize.height = 320;
viewportSize.visualHeight = 320;
refreshDeviceLayout();
check("手机横屏 568x320 写入 data-device=tablet（破格双栏）", attributes.get("data-device") === "tablet", `实际 ${attributes.get("data-device")}`);
check("手机横屏 568x320 isSmallLandscape 为 true", api.isSmallLandscape.value === true);
check("手机横屏 568x320 isPhoneTier 为 false（双栏）", api.isPhoneTier.value === false);

// 同样小，但不够扁（480x400 = 1.2）仍然是单栏
viewportSize.width = 480;
viewportSize.height = 400;
viewportSize.visualHeight = 400;
refreshDeviceLayout();
check("小窗 480x400 写入 data-device=phone（不够扁 → 单栏）", attributes.get("data-device") === "phone", `实际 ${attributes.get("data-device")}`);
check("小窗 480x400 isSmallLandscape 为 false", api.isSmallLandscape.value === false);
check("小窗 480x400 isPhoneTier 为 true", api.isPhoneTier.value === true);

// 大屏电脑（1600x1000）：常规密度档
viewportSize.width = 1600;
viewportSize.height = 1000;
viewportSize.visualHeight = 1000;
refreshDeviceLayout();
check("1600x1000 写入 data-device=desktop", attributes.get("data-device") === "desktop", `实际 ${attributes.get("data-device")}`);

// 大桌面：既不是小窗口，也不紧凑
viewportSize.width = 1600;
viewportSize.height = 1000;
viewportSize.visualHeight = 1000;
refreshDeviceLayout();
check("1600x1000 不是小窗口", attributes.get("data-compact") === "false", `实际 ${attributes.get("data-compact")}`);
check("1600x1000 isSmallWindow 为 false", api.isSmallWindow.value === false);
check("1600x1000 是桌面布局", attributes.get("data-layout") === "desktop");

// 竖屏手机：宽度 <= 1024，属于小窗口（密度按移动端），但布局也是手机
viewportSize.width = 393;
viewportSize.height = 852;
viewportSize.visualHeight = 852;
refreshDeviceLayout();
check("393x852 是小窗口", attributes.get("data-compact") === "true", `实际 ${attributes.get("data-compact")}`);

// ── 5. 幂等：重复 install 不应重建实例 ───────────────────────────────────
const first = installDeviceLayout();
const second = installDeviceLayout();
check("installDeviceLayout 幂等", first === second);

console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
