/**
 * 验证布局判定规则的自洽性。
 *
 * 这个套件不需要后端 / 数据库 / Redis，纯几何计算：
 *   node tools/dev-verify/verify-device-layout.mjs
 *
 * 规则：**横屏一律桌面布局；竖屏按宽度（<=768 走手机布局）**。
 *
 * 覆盖三件事：
 *   1. 典型机型与窗口尺寸的判定表（含横屏手机必须走桌面）；
 *   2. SCSS mixin 与 TS 规则的一致性 —— 用 JS 复刻 responsive-mixins.scss 的媒体查询条件，
 *      在密集矩阵上与 classifyViewport() 逐一比对，任何一边改了都会红；
 *   3. 断点常量漂移 —— 直接解析 SCSS 里的 $bp-* 数值，与 TS 常量比对。
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  classifyViewport,
  DEVICE_LAYOUT_BREAKPOINTS as BP,
} from "../../web/src/utils/device-layout.ts";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  <- ${detail}`}`);
};

const at = (w, h, extra = {}) => classifyViewport({ width: w, height: h, isTouch: false, ...extra });

// ── 1. 典型机型 / 窗口判定表 ───────────────────────────────────────────────
// [名称, 宽, 高, 期望 layout, 期望 isPhone]
// layout 与 isPhone 是两个概念：
//   layout   该用哪套结构（横屏一律 desktop）
//   isPhone  几何上是不是手机（横屏手机依然 true，仅用于埋点与输入方式相关微调）
const CASES = [
  ["iPhone SE 竖屏",             375,  667, "mobile",  true],
  ["iPhone 15 竖屏",             393,  852, "mobile",  true],
  ["iPhone 15 横屏 → 桌面",      852,  393, "desktop", true],
  ["iPhone 15 PM 横屏 → 桌面",   932,  430, "desktop", true],
  ["iPhone SE 横屏 → 桌面",      667,  375, "desktop", true],
  ["Android 常见竖屏",           360,  800, "mobile",  true],
  ["折叠屏展开竖屏",             480, 1024, "mobile",  true],
  ["超大竖屏(480x1200)",         480, 1200, "mobile",  true],
  ["iPad mini 竖屏(768)",        768, 1024, "mobile",  false],
  ["iPad 竖屏(820x1180)",        820, 1180, "desktop", false],
  ["高窄桌面窗口(900x1200)",     900, 1200, "desktop", false],
  ["iPad 横屏",                 1180,  820, "desktop", false],
  ["桌面窗口被拉窄(700x1200)",   700, 1200, "mobile",  false],
  // 700x400 几何上就是个横屏手机的形状（短边 400、长边 700 都在手机范围内），
  // 所以 isPhone=true；但它是横屏，布局依然是桌面 —— 这正是两个概念分离的意义。
  ["被拖扁的电脑窗口(700x400)",  700,  400, "desktop", true],
  ["超宽极矮桌面窗口(1280x400)", 1280,  400, "desktop", false],
  ["小笔记本(1024x600)",        1024,  600, "desktop", false],
  ["笔记本(1366x768)",          1366,  768, "desktop", false],
  ["常见桌面(1920x1080)",       1920, 1080, "desktop", false],
  ["4K 桌面",                   3840, 2160, "desktop", false],
];

for (const [name, w, h, wantLayout, wantPhone] of CASES) {
  const r = at(w, h);
  check(
    `${name.padEnd(26)} ${String(w).padStart(4)}x${String(h).padEnd(4)} -> ${r.layout}`,
    r.layout === wantLayout && r.isPhone === wantPhone,
    `期望 layout=${wantLayout} isPhone=${wantPhone}，实际 layout=${r.layout} isPhone=${r.isPhone}`,
  );
}

// ── 2. 横屏优先：这是本套件的核心 ─────────────────────────────────────────
// 横屏必须走桌面，哪怕宽度只有 667（旧实现按宽度判定会给出手机布局）。
for (const [w, h] of [[852, 393], [667, 375], [932, 430], [600, 500], [700, 400], [400, 300]]) {
  check(`横屏一律桌面: ${w}x${h}`, at(w, h).layout === "desktop", `实际 ${at(w, h).layout}`);
}
// 竖屏且宽度满足手机像素宽度才走手机布局。
for (const [w, h] of [[393, 852], [375, 667], [360, 800], [480, 1024], [768, 1024]]) {
  check(`竖屏窄屏走手机: ${w}x${h}`, at(w, h).layout === "mobile", `实际 ${at(w, h).layout}`);
}

// 方向语义必须与 CSS 的 (orientation: portrait) 一致：height >= width 即竖屏
check("orientation 等高算竖屏(600x600)", at(600, 600).orientation === "portrait");
check("orientation 852x393 算横屏", at(852, 393).orientation === "landscape");

// ── 3. 边界值 ─────────────────────────────────────────────────────────────
const BOUNDARIES = [
  ["竖屏宽 768 走手机",        768, 1024, "mobile"],
  ["竖屏宽 769 走桌面",        769, 1024, "desktop"],
  ["横屏宽 400 仍走桌面",      400,  300, "desktop"],
  ["等高 600x600 算竖屏手机",  600,  600, "mobile"],
];
for (const [name, w, h, want] of BOUNDARIES) {
  const r = at(w, h);
  check(`边界: ${name.padEnd(24)} ${w}x${h} -> ${r.layout}`, r.layout === want, `期望 ${want}`);
}

// ── 4. 横屏手机：桌面布局，但几何上仍是手机 ────────────────────────────────
const landscapePhone = at(852, 393);
check("横屏手机 layout=desktop", landscapePhone.layout === "desktop");
check("横屏手机 isPhone=true（用于埋点/输入方式微调）", landscapePhone.isPhone === true);
check("横屏手机 isPhoneLandscape=true", landscapePhone.isPhoneLandscape === true);
check("横屏手机 isNarrowViewport=false（宽 852）", landscapePhone.isNarrowViewport === false);

// 「高 > 宽」本身绝不能等同于手机：竖屏平板会被误判。
check("仅高>宽不算手机: 820x1180", at(820, 1180).isPhone === false);
check("仅高>宽不算手机: 900x1200", at(900, 1200).isPhone === false);
// 竖屏规则：480x1024 短边不算小（长边超 960），只能靠「竖屏 + 手机像素宽」认定为手机。
check("竖屏规则: 480x1024 认定为手机", at(480, 1024).isPhonePortrait === true);
check("竖屏规则: 481x1200 不再是竖屏手机", at(481, 1200).isPhonePortrait === false);

// ── 5. 过矮视口（压缩纵向留白用，与布局切换无关）─────────────────────────
check("竖屏 393x852 不算过矮", at(393, 852).isShortViewport === false);
check("横屏 852x393 算过矮", at(852, 393).isShortViewport === true);
check("560 高度算过矮(含边界)", at(900, BP.compactHeight).isShortViewport === true);
check("561 高度不算过矮", at(900, BP.compactHeight + 1).isShortViewport === false);

// ── 6. 软键盘：可视高度变化只影响 --app-h，不影响布局判定 ──────────────────
const kb = at(393, 852, { visualHeight: 852 - 320 });
check("软键盘弹起被识别", kb.isKeyboardOpen === true);
check("软键盘不改变布局判定", kb.layout === "mobile" && kb.orientation === "portrait");
check("软键盘后的可视高度被记录", kb.visualHeight === 532);
check("地址栏小变化不算键盘", at(393, 852, { visualHeight: 852 - 60 }).isKeyboardOpen === false);
// 横屏 + 键盘依然按横屏走桌面
const kbLandscape = at(852, 393, { visualHeight: 393 - 200 });
check("横屏 + 软键盘仍走桌面布局", kbLandscape.layout === "desktop" && kbLandscape.isKeyboardOpen === true);

// ── 7. SCSS mixin 与 TS 规则一致性 ────────────────────────────────────────
// 复刻 styles/responsive-mixins.scss 中 @mixin phone 的媒体查询条件：
//   @media (orientation: portrait) and (max-width: 768px)
const phoneByScss = (w, h) => h >= w && w <= BP.narrowViewportWidth;

// 复刻 @mixin desktop 的两条媒体查询，用于验证它确实是 phone 的严格取反：
//   @media (orientation: landscape)  /  @media (min-width: 768.02px)
const desktopByScss = (w, h) =>
  w > h || w >= BP.narrowViewportWidth + 0.02;

let mismatchPhone = null;
let mismatchNegation = null;
for (let w = 240; w <= 2600; w += 1) {
  for (let h = 240; h <= 1800; h += 3) {
    const r = at(w, h);
    if ((r.layout === "mobile") !== phoneByScss(w, h)) {
      mismatchPhone ??= `${w}x${h} js=${r.layout} scss=${phoneByScss(w, h)}`;
    }
    // 同一尺寸不能既命中手机又命中桌面媒体查询
    if (phoneByScss(w, h) === desktopByScss(w, h)) {
      mismatchNegation ??= `${w}x${h} phone=${phoneByScss(w, h)} desktop=${desktopByScss(w, h)}`;
    }
  }
}
check("JS 判定 == SCSS @mixin phone（全矩阵）", mismatchPhone === null, mismatchPhone ?? "");
check("@mixin desktop 是 @mixin phone 的严格取反（全矩阵）", mismatchNegation === null, mismatchNegation ?? "");

// ── 8. 断点常量漂移：直接解析 SCSS ────────────────────────────────────────
const scssPath = fileURLToPath(new URL("../../web/src/styles/responsive-mixins.scss", import.meta.url));
const scss = readFileSync(scssPath, "utf8");
const readScssPx = (varName) => {
  const found = scss.match(new RegExp(`\\$${varName}\\s*:\\s*([0-9.]+)px`));
  return found ? Number(found[1]) : null;
};
const DRIFT = [
  ["bp-phone-portrait-width", "phonePortraitWidth"],
  ["bp-phone-short-side", "phoneShortSide"],
  ["bp-phone-long-side", "phoneLongSide"],
  ["bp-narrow", "narrowViewportWidth"],
  ["bp-compact-height", "compactHeight"],
  ["bp-small-window", "smallWindowWidth"],
];
for (const [scssName, tsName] of DRIFT) {
  const scssValue = readScssPx(scssName);
  check(
    `断点一致: $${scssName} == ${tsName}`,
    scssValue === BP[tsName],
    `scss=${scssValue} ts=${BP[tsName]}`,
  );
}

// @mixin phone 里必须带 orientation: portrait，否则横屏又会退回手机布局。
check(
  "@mixin phone 带 orientation: portrait",
  /@mixin phone\s*\{[^}]*orientation:\s*portrait/.test(scss),
  "responsive-mixins.scss 的 @mixin phone 缺少 orientation: portrait",
);

// ── 9. 小屏紧凑密度与占比宽度（防回归）────────────────────────────────────
// 这两件事与「布局结构」是两条独立的轴，容易被后来的改动顺手删掉：
//   1. 横屏手机走桌面结构，但间距/字号要按小屏收 —— 靠 @mixin compact 同时看「窄」和「矮」；
//   2. 侧栏宽度要按占比，不能写死 px —— 小窗口下写死值会吃掉太多横向空间。
const readSrc = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const chatStyle = readSrc("../../web/src/features/chat/style/index.scss");
const desktopView = readSrc("../../web/src/features/plans/components/DesktopMainView.vue");
const globalStyle = readSrc("../../web/src/styles/responsive.scss");

// @mixin compact 必须同时覆盖「矮」——否则横屏手机拿不到紧凑间距
check(
  "@mixin compact 同时覆盖窄与矮",
  /@mixin compact[^}]*max-height:\s*\$bp-compact-height/s.test(scss),
  "compact() 缺少最大高度条件，横屏手机（852x393）将拿不到紧凑间距",
);

// 聊天左侧会话列表：按占比而不是写死 300px
check(
  "聊天会话列表宽度按占比(clamp)",
  /grid-template-columns:\s*clamp\([^)]*\)\s*minmax\(0,\s*1fr\)/.test(
    chatStyle.split(".layout {")[1]?.split("}")[0] ?? "",
  ),
  "chat 的 .layout 仍是固定宽度，小窗口下会吃掉过多横向空间",
);
check(
  "聊天样式保留既有的大屏 300px 上限",
  chatStyle.includes("300px"),
  "clamp 的上限丢了，大屏会话列表会变窄",
);

// 计划页左侧栏同理
check(
  "计划页侧栏宽度按占比(clamp)",
  desktopView.includes("grid-template-columns: clamp("),
  "DesktopMainView 的 .content 仍是固定侧栏宽度",
);

// 全局小屏层：抽屉/弹层内边距按小屏收
check(
  "全局小屏层收窄 EP 抽屉/弹层内边距",
  globalStyle.includes("--el-drawer-padding-primary") && globalStyle.includes("--el-dialog-padding-primary"),
  "responsive.scss 的 html[data-short] 未收窄 Element Plus 弹层内边距",
);

// ── 10. Element Plus 组件尺寸随窗口适配（防回归）──────────────────────────
// EP 的按钮高度是写死的（默认 32、small 24、large 40），根本不读 --el-component-size，
// 只有输入框等组件读。所以只改变量不够，必须同时接管写死的高度，
// 否则会出现「输入框缩了、按钮没缩」的错位。
const appVue = readSrc("../../web/src/App.vue");

check(
  "EP 尺寸变量流体化（窄窗口更紧凑）",
  /--el-component-size:\s*clamp\(28px/.test(globalStyle),
  "responsive.scss 里 --el-component-size 不是流体值，窄窗口下 EP 组件不会缩",
);
check(
  "接管写死的按钮高度（三档）",
  ["html .el-button {", "html .el-button--small {", "html .el-button--large {"].every((sel) =>
    globalStyle.includes(sel),
  ),
  "按钮高度未接管：EP 写死的 32/24/40px 不会随窗口缩放",
);
// 顺序很关键：小/大按钮同时带 .el-button 类，特异性相同时靠顺序决定胜负
check(
  "按钮三档顺序为 base -> small -> large",
  globalStyle.indexOf("html .el-button {") < globalStyle.indexOf("html .el-button--small {") &&
    globalStyle.indexOf("html .el-button--small {") < globalStyle.indexOf("html .el-button--large {"),
  "顺序写反会让 small/large 按钮被 base 覆盖回默认高度",
);
check(
  "输入框高度接管且用 :not() 排除尺寸变体",
  globalStyle.includes("html .el-input:not(.el-input--small):not(.el-input--large)"),
  "缺少 :not() 守卫会把 --small/--large 输入框的高度压回默认值",
);
check(
  "el-config-provider 绑定响应式 size",
  /<el-config-provider[^>]*:size="elementComponentSize"/.test(appVue),
  "App.vue 未把组件尺寸接到 el-config-provider 上",
);
check(
  "组件尺寸由 isShortViewport 驱动（竖屏手机保留默认尺寸便于点按）",
  /isShortViewport/.test(appVue) && /elementComponentSize/.test(appVue),
  "组件尺寸没有跟随设备判定；注意竖屏手机不应降到 24px，否则触屏难以点中",
);

// ── 11. 小窗口密度 + 会话列表不再溢出（防回归）────────────────────────────
// 两件事：
//   1. 小窗口（<=1024px）即使是桌面布局，密度也要按移动端那套收；
//   2. 会话列表项过去会溢出 li —— 根因是 EP 的 .el-badge 是 width: fit-content，
//      而标题 nowrap 让 min-content 等于整条标题宽，撑破容器。
//      修法必须让 .item 以 flex 子项身份参与收缩，不能靠调 padding。
check(
  "聊天紧凑密度按「小窗口」而非手机断点",
  chatStyle.includes("@include rp.compact(rp.$bp-small-window)"),
  "chat 的紧凑密度阈值退回手机断点后，900x700 这类桌面窗口的会话列表会重新变挤",
);

const sidebarList = readSrc("../../web/src/features/chat/components/ConversationSidebarList.vue");

// 内边距/间距随列表自身宽度缩（容器查询），窄列表下不该吃固定 12px
check(
  "会话列表项的内边距随列表宽度缩（容器查询）",
  /padding:\s*clamp\(6px,[^)]*cqi[^)]*12px\)/.test(sidebarList),
  "缺少基于 cqi 的 padding，窄列表下固定 12px 会吃掉过多横向空间",
);
check(
  "会话列表项的字号/头像随列表宽度缩",
  /--chat-item-fs:\s*clamp\(/.test(sidebarList) && /--chat-item-avatar:\s*clamp\(/.test(sidebarList),
  "缺少 cqi 驱动的字号/头像，窄列表里文字会被挤压",
);

// 把 .item 的规则块抠出来（到配对的 } 为止），只断言「声明」而不是注释里出现的字样
const itemRule = chatStyle.slice(chatStyle.indexOf("\n.item {"));
const itemBlock = itemRule.slice(0, itemRule.indexOf("\n}"));
const itemDeclarations = itemBlock
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
check(
  "会话项用 flex-basis 收缩（溢出根因修复）",
  /flex:\s*1 1 0%/.test(itemDeclarations) && /min-width:\s*0/.test(itemDeclarations),
  "缺少 flex: 1 1 0% / min-width: 0：EP 的 width: fit-content 会把列表项撑出 li",
);
check(
  "会话项不再用 width 与 EP 的 fit-content 抢（声明层面）",
  !/^\s*width:\s*100%/m.test(itemDeclarations),
  "又出现 width: 100% 声明了：它与 EP 的 fit-content 同特异性，谁生效取决于打包顺序",
);
check(
  "会话项有 overflow: hidden 兜底",
  /overflow:\s*hidden/.test(itemDeclarations),
  "缺少兜底裁剪，未预期内容会溢出 li",
);
check(
  "小窗口标记已写到 <html>（data-compact）",
  readSrc("../../web/src/composables/use-device-layout.ts").includes('compact: "data-compact"'),
  "use-device-layout 未写 data-compact，CSS 无法按小窗口切换",
);

// ── 12. 会话列表 li 不溢出父元素（grid 轨道收缩）─────────────────────────
// 实测症状：父 <aside> 宽 200px、ul 内容区 182.67px 时，li 量到 203.69px 溢出。
// 根因：ul 是 display: grid 且未声明 grid-template-columns → 隐式 auto 轨道，
// 其基准尺寸取列表项的 min-content；会话名 nowrap，min-content = 整条标题宽，
// 轨道被撑到比 ul 内容区还宽。
// 注意：只给 li 内部的 .item 加 min-width: 0 没用 —— 溢出的是 li 自己这个 grid item。
const listBlock = chatStyle.slice(
  chatStyle.indexOf("\n.conversation-list {"),
  chatStyle.indexOf("\n.conversation-list {") + 1200,
);
check(
  "会话列表显式声明 minmax(0, 1fr)（grid 轨道可收缩）",
  /grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(listBlock),
  "缺少 grid-template-columns: minmax(0, 1fr)，隐式 auto 轨道会被 nowrap 标题撑宽而溢出",
);
check(
  "会话项(li)自身 min-width: 0",
  /min-width:\s*0/.test(listBlock),
  "li 是 grid item，默认 min-width: auto 仍会被标题顶大",
);
check(
  "极窄列表隐藏时间，给会话名让位",
  /@container \(max-width: 220px\)/.test(sidebarList),
  "标题行里图标+时间占约 90px，窄列表下会话名只剩两三个字",
);

// ── 13. 静态 lint：省略号必须有 nowrap；容器宽度不能硬编码到顶破窄屏 ──────
// 这两条是「内容顶破容器」这一类 bug 的通用特征：
//   1. text-overflow: ellipsis 若同一规则块里没有 white-space: nowrap（或 line-clamp），
//      省略号根本不生效 —— 文字会换行；而没有空格的长文件名（IMG_20240101.jpg）
//      连换行都救不了，min-content 就是整串，直接横向溢出。
//   2. 组件里硬编码 max-width >= 300px，窄屏下会把容器顶破（本该用 min(...)/vw 联动）。
function* walkSources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* walkSources(full);
    } else if (/\.(vue|scss|css)$/.test(entry.name)) {
      yield full;
    }
  }
}

// 判断某个位置是否落在注释里（HTML 注释 / 块注释 / 行注释）。
// 必须跳过：注释里经常引用属性名做说明（例如"缺少 text-overflow: ellipsis 会失效"），
// 不加这层判断 lint 会把自己写的说明文字当成代码报错。
function isInsideComment(text, index) {
  const htmlOpen = text.lastIndexOf("<!--", index);
  if (htmlOpen !== -1 && text.indexOf("-->", htmlOpen) > index) return true;

  const blockOpen = text.lastIndexOf("/*", index);
  if (blockOpen !== -1 && text.indexOf("*/", blockOpen) > index) return true;

  const lineStart = text.lastIndexOf("\n", index) + 1;
  if (text.slice(lineStart, index).includes("//")) return true;

  return false;
}

// 抠出包含 index 的最内层 {...} 规则块
function enclosingRule(text, index) {
  let start = -1;
  let depth = 0;
  for (let i = index; i >= 0; i -= 1) {
    if (text[i] === "}") depth += 1;
    else if (text[i] === "{") {
      if (depth === 0) { start = i; break; }
      depth -= 1;
    }
  }
  if (start === -1) return "";
  let d = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") d += 1;
    else if (text[i] === "}") { d -= 1; if (d === 0) return text.slice(start, i + 1); }
  }
  return text.slice(start);
}

const SRC_ROOT = fileURLToPath(new URL("../../web/src", import.meta.url));
const ellipsisWithoutNowrap = [];
const hardcodedWideMax = [];
for (const file of walkSources(SRC_ROOT)) {
  const text = readFileSync(file, "utf8");
  const rel = path.relative(SRC_ROOT, file);
  const lines = text.split("\n");

  for (const m of text.matchAll(/text-overflow:\s*ellipsis/g)) {
    if (isInsideComment(text, m.index)) continue;
    const block = enclosingRule(text, m.index);
    if (!/white-space:\s*nowrap|line-clamp/.test(block)) {
      const line = text.slice(0, m.index).split("\n").length;
      ellipsisWithoutNowrap.push(`${rel}:${line}`);
    }
  }

  // 只查「真的会顶破窄屏」的硬编码大 max-width。以下都不算问题，跳过：
  //   - 注释里的字样（历史说明里常引用旧值）
  //   - @media (max-width: ...) 这种媒体查询
  //   - 同一规则块里已有 width: 100% / min(...) / % —— 说明它本来就跟着容器缩
  //   - 1200px：页面内容居中上限，是合法用法
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;
    if (trimmed.includes("@media")) return;
    const m = line.match(/max-width:\s*(\d{3,4})px/);
    if (!m) return;
    const value = Number(m[1]);
    if (value < 300 || value === 1200) return;
    if (line.includes("min(")) return;

    const offset = text.split("\n").slice(0, i).join("\n").length;
    const block = enclosingRule(text, offset + line.indexOf("max-width"));
    if (/width:\s*100%|min\(|%/.test(block.replace(/max-width:[^;]*;/, ""))) return;

    hardcodedWideMax.push(`${rel}:${i + 1} -> max-width: ${value}px`);
  });
}

check(
  "省略号都带了 white-space: nowrap（否则省略号不生效）",
  ellipsisWithoutNowrap.length === 0,
  ellipsisWithoutNowrap.join(", "),
);
check(
  "组件里没有硬编码的大 max-width（窄屏会顶破容器）",
  hardcodedWideMax.length === 0,
  hardcodedWideMax.join(", "),
);

// ── 14. 聊天输入框 placeholder 必须随窗口变短 ─────────────────────────────
// EP 的 autosize 在输入框为空时用 placeholder 量高度：
//   element-plus/es/components/input/src/utils.mjs
//   hiddenTextarea.value = targetElement.value || targetElement.placeholder || "";
// 长 placeholder 在窄容器里折行 → 空输入框被算成两行 → 整体过高。
const messagePanel = readSrc("../../web/src/features/chat/components/MessagePanel.vue");
check(
  "输入框改用响应式 placeholder",
  /:placeholder="composerPlaceholder"/.test(messagePanel),
  "又变回静态 placeholder 了：长文案在窄窗口会折行，把空输入框撑成两行",
);
check(
  "小窗口下用短 placeholder",
  /isSmallWindow/.test(messagePanel) && /"输入消息…"/.test(messagePanel),
  "缺少小窗口下的短 placeholder（EP 用 placeholder 量 autosize 高度）",
);
check(
  "长 placeholder 没有被静态绑定回输入框",
  !/placeholder="输入消息，Enter 发送，Shift \+ Enter 换行"/.test(messagePanel),
  "长 placeholder 又被写回到 el-input 的 placeholder 属性上了",
);

// ── 15. 文件预览组件的移动端 / 小屏适配 ─────────────────────────────────
// 工具栏 7 个按钮 × 36px + 6×8px = 300px，360px 手机上只给文件名留约 40px。
const filePreview = readSrc("../../web/src/components/FilePreview/index.vue");
check(
  "文件预览有紧凑密度块",
  /@include rp\.compact\(768px\)/.test(filePreview),
  "缺少 rp.compact 块，小屏下工具栏/缩略图/文本预览都不会收",
);
check(
  "小屏下工具栏按钮缩小",
  /\.toolbar-btn\s*\{[^}]*width:\s*32px/.test(filePreview),
  "小屏未缩小工具栏按钮，文件名会被挤没",
);
check(
  "翻页按钮让开安全区",
  /\.prev-btn\s*\{[^}]*left:\s*calc\(8px \+ var\(--safe-left\)\)/.test(filePreview) &&
    /\.next-btn\s*\{[^}]*right:\s*calc\(8px \+ var\(--safe-right\)\)/.test(filePreview),
  "翻页按钮用了固定 left/right，横屏刘海侧会被挡住",
);
check(
  "Office/PDF 预览在小屏可滚动",
  /\.document-preview,\s*\n\s*\.pdf-preview\s*\{\s*\n\s*overflow:\s*auto/.test(filePreview),
  "未给文档预览加滚动兜底，内容会被 preview-content 的 overflow: hidden 裁掉",
);
check(
  "文本预览长串可断行",
  /overflow-wrap:\s*anywhere/.test(filePreview),
  "缺少 overflow-wrap: anywhere，URL/日志这类无断点长串仍会横向顶破容器",
);

// 文件名在小屏的处理：工具栏放不下时拆成独立一行（用户实测"宽度总是不够"）
check(
  "小屏隐藏工具栏内的文件名",
  /\.toolbar-left\s*\{[^}]*display:\s*none/.test(filePreview),
  "小屏仍把文件名塞在工具栏里，7 个按钮占完后只剩几十像素",
);
check(
  "独立文件名行存在且默认隐藏",
  /\.file-name-row\s*\{\s*\n\s*display:\s*none/.test(filePreview),
  "缺少 .file-name-row 的默认隐藏规则（宽屏不该多占一行）",
);
check(
  "独立文件名行在小屏显示并单行省略",
  /@include rp\.compact\(768px\)[\s\S]{0,2500}\.file-name-row\s*\{[^}]*display:\s*block[\s\S]{0,400}text-overflow:\s*ellipsis/.test(filePreview),
  "小屏下独立文件名行未启用（或缺少单行省略）",
);
check(
  "文件名是块级元素（inline 元素上 ellipsis 不生效）",
  /\.file-name\s*\{[^}]*display:\s*block/.test(filePreview),
  "缺少 display: block，text-overflow: ellipsis 对 inline 的 el-text 无效",
);
check(
  "文件名不再用 el-text 的 line-clamp",
  !/:line-clamp="1"[^>]*currentFile/.test(filePreview),
  "EP 的 :line-clamp 用 -webkit-inline-box，会让 CSS 省略号失效",
);

// ── 16. 文件消息卡片宽度：最多 300 / 窄则收缩 / 最小 100 ──────────────────
// 原本 .audio-message / .document-message 写死 width: 300px，
// 窄容器里会横向顶出气泡（.file-message 的 max-width 管不到子元素）。
const fileMessage = readSrc("../../web/src/features/chat/components/FileMessage.vue");
const cardMixin = fileMessage.slice(
  fileMessage.indexOf("@mixin file-card-width"),
  fileMessage.indexOf("@mixin file-card-width") + 400,
);
check(
  "文件卡片宽度 mixin 存在",
  cardMixin.length > 20,
  "缺少 file-card-width mixin",
);
check(
  "卡片宽度上限 300px", /width:\s*300px/.test(cardMixin),
  "缺少 width: 300px（期望宽度）",
);
check(
  "卡片可随容器收缩", /max-width:\s*100%/.test(cardMixin),
  "缺少 max-width: 100%，窄气泡里会横向顶破容器",
);
check(
  "卡片宽度下限 100px", /min-width:\s*100px/.test(cardMixin),
  "缺少 min-width: 100px（需求下限）",
);
check(
  "两种卡片都用了该 mixin",
  (fileMessage.match(/@include file-card-width/g) ?? []).length >= 2,
  "audio / document 两种卡片没有都应用宽度策略",
);
check(
  "卡片内部按卡片宽度自适应",
  /@container filecard \(max-width: 180px\)/.test(fileMessage),
  "缺少容器查询：100px 卡片里 48px 图标 + 12px 内边距会把文件名挤没",
);

// 四种消息类型（文档/音频/图片/视频）统一宽度策略
const mediaMixin = fileMessage.slice(
  fileMessage.indexOf("@mixin file-media-width"),
  fileMessage.indexOf("@mixin file-media-width") + 300,
);
check(
  "媒体型宽度 mixin 存在（图片/视频统一）",
  mediaMixin.length > 20,
  "缺少 file-media-width mixin",
);
check(
  "媒体上限 300px", /max-width:\s*min\(300px,\s*100%\)/.test(mediaMixin),
  "媒体型上限不是 min(300px, 100%)",
);
check(
  "媒体下限 100px（且不撑破更窄的容器）",
  /min-width:\s*min\(100px,\s*100%\)/.test(mediaMixin),
  "媒体型缺少 min(100px, 100%) 下限",
);
check(
  "图片/视频/占位框都应用了媒体宽度策略",
  (fileMessage.match(/@include file-media-width/g) ?? []).length >= 3,
  "image / video / placeholder 没有全部应用统一宽度",
);
check(
  "图片不再返回写死的 height（否则收缩时被拉扁）",
  /height:\s*'auto'/.test(fileMessage) && /aspectRatio/.test(fileMessage),
  "图片样式仍写死 height，宽度收缩后会被拉扁",
);

console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
