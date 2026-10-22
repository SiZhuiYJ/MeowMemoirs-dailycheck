/**
 * 验证布局判定规则的自洽性。
 *
 * 这个套件不需要后端 / 数据库 / Redis，纯几何计算：
 *   node tools/dev-verify/verify-device-layout.mjs
 *
 * 规则 A（布局结构，两档）：**横屏一律桌面布局；竖屏按宽度（<=768 走手机布局）**。
 * 规则 B（设备档位，三档）：**只看宽度** —— <=600 手机 / 600~1200 平板 / >1200 大屏电脑。
 *
 * 覆盖四件事：
 *   1. 典型机型与窗口尺寸的判定表（含横屏手机必须走桌面、三档档位归属）；
 *   2. SCSS mixin 与 TS 规则的一致性 —— 用 JS 复刻 responsive-mixins.scss 的媒体查询条件，
 *      在密集矩阵上与 classifyViewport() 逐一比对，任何一边改了都会红；
 *      两套规则都验：phone/desktop（两档）与 device-phone/tablet/desktop（三档）；
 *   3. 断点常量漂移 —— 直接解析 SCSS 里的 $bp-* 数值，与 TS 常量比对；
 *   4. 聊天页三档样式（单栏 / 双栏 / 24px 控件 + 6px 间距）的关键声明仍在。
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

// ── 1b. 设备档位（三档，只看宽度）─────────────────────────────────────────
// [名称, 宽, 高, 期望 tier]
// 与上面的 layout 是两个概念：layout 管「结构塌不塌」（两档），
// tier 管「聊天页按哪一档排」（三档：手机单栏 / 平板双栏 / 大屏常规密度）。
const TIER_CASES = [
  ["iPhone SE 竖屏",            375,  667, "phone"],
  ["iPhone 15 竖屏",            393,  852, "phone"],
  ["Android 常见竖屏",          360,  800, "phone"],
  ["折叠屏展开竖屏(480)",       480, 1024, "phone"],
  ["iPhone 15 横屏(852)",       852,  393, "tablet"],
  ["iPhone 15 PM 横屏(932)",    932,  430, "tablet"],
  ["iPad mini 竖屏(768)",       768, 1024, "tablet"],
  ["iPad 竖屏(820x1180)",       820, 1180, "tablet"],
  ["iPad 横屏(1180x820)",      1180,  820, "tablet"],
  ["被拖窄的桌面窗口(700)",     700, 1200, "tablet"],
  ["小笔记本(1024x600)",       1024,  600, "tablet"],
  ["竖屏平板边界(1200)",       1200,  800, "tablet"],
  ["大屏笔记本(1280x800)",     1280,  800, "desktop"],
  ["笔记本(1366x768)",         1366,  768, "desktop"],
  ["常见桌面(1920x1080)",      1920, 1080, "desktop"],
  ["4K 桌面",                  3840, 2160, "desktop"],
];

for (const [name, w, h, wantTier] of TIER_CASES) {
  const r = at(w, h);
  check(
    `档位 ${name.padEnd(26)} ${String(w).padStart(4)}x${String(h).padEnd(4)} -> ${r.tier}`,
    r.tier === wantTier,
    `期望 tier=${wantTier}，实际 ${r.tier}`,
  );
}

// 三档互斥且完备：任意尺寸必须恰好命中一档
check("档位三档互斥完备(393)", at(393, 852).isPhoneTier && !at(393, 852).isTabletTier && !at(393, 852).isDesktopTier);
check("档位三档互斥完备(820)", !at(820, 1180).isPhoneTier && at(820, 1180).isTabletTier && !at(820, 1180).isDesktopTier);
check("档位三档互斥完备(1920)", !at(1920, 1080).isPhoneTier && !at(1920, 1080).isTabletTier && at(1920, 1080).isDesktopTier);

// 边界值：600 属于手机档、601 转平板；1200 仍平板、1201 转大屏电脑
check("档位边界: 宽 600 仍是手机", at(600, 900).tier === "phone", `实际 ${at(600, 900).tier}`);
check("档位边界: 宽 601 转平板", at(601, 900).tier === "tablet", `实际 ${at(601, 900).tier}`);
check("档位边界: 宽 1200 仍是平板", at(1200, 800).tier === "tablet", `实际 ${at(1200, 800).tier}`);
check("档位边界: 宽 1201 转大屏电脑", at(1201, 800).tier === "desktop", `实际 ${at(1201, 800).tier}`);

// 头号需求：竖屏平板必须落在「双栏」这一档（平板两个界面一起展示）
check("竖屏平板 768x1024 不是手机档（平板要双栏）", at(768, 1024).isPhoneTier === false);
check("竖屏平板 820x1180 是平板档", at(820, 1180).tier === "tablet");

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

// ── 7b. 三档 mixin 与 tier 的全矩阵一致性 ─────────────────────────────────
// 复刻 responsive-mixins.scss：
//   @mixin device-phone   -> @media (max-width: 600px) and (max-aspect-ratio: 1.499)
//   @mixin device-tablet  -> @media (min-width: 600.02px) and (max-width: 1200px)
//                            / @media (max-width: 600px) and (min-aspect-ratio: 1.5)
//   @mixin device-desktop -> @media (min-width: 1200.02px)
//   @mixin device-mobile  -> @media (max-width: 1200px)   （手机 + 平板）
//
// 宽高比分支（「窄但够扁 → 双栏」）两侧必须严丝合缝：
//   SCSS 单栏 = 宽/高 <= 1.499，SCSS 双栏分支 = 宽/高 >= 1.5，
//   TS   tier  = 宽/高 > 1.499（见 classifyViewport 的 isSmallLandscape）。
const splitMin = BP.splitAspectRatio + 0.001; // 1.5：双栏分支的下界
const devicePhoneByScss = (w, h) => w <= BP.phoneMaxWidth && w / h <= BP.splitAspectRatio;
const deviceSplitByScss = (w, h) => w <= BP.phoneMaxWidth && w / h >= splitMin;
const deviceTabletByScss = (w, h) =>
  (w >= BP.phoneMaxWidth + 0.02 && w <= BP.pcWidth) || deviceSplitByScss(w, h);
const deviceDesktopByScss = (w) => w >= BP.pcWidth + 0.02;
const deviceMobileByScss = (w) => w <= BP.pcWidth;

let tierMismatch = null;
let tierOverlap = null;
let mobileMismatch = null;
// 宽度扫全量；高度选一批能跨过宽高比阈值（1.5）的取值，
// 既能覆盖竖屏手机（393x852），也能覆盖各种横屏/宽扁小屏（480x320、568x320）
const HEIGHTS = [240, 300, 320, 360, 393, 400, 430, 500, 568, 600, 667, 700, 768, 800, 900, 1024, 1180];
for (let w = 240; w <= 2600; w += 1) {
  for (const h of HEIGHTS) {
    const r = at(w, h);
    const scssPhone = devicePhoneByScss(w, h);
    const scssTablet = deviceTabletByScss(w, h);
    const scssDesktop = deviceDesktopByScss(w);

    if (r.isPhoneTier !== scssPhone) {
      tierMismatch ??= `${w}x${h} js=${r.tier} scss-phone=${scssPhone}`;
    }
    if (r.isTabletTier !== scssTablet) {
      tierMismatch ??= `${w}x${h} js=${r.tier} scss-tablet=${scssTablet}`;
    }
    if (r.isDesktopTier !== scssDesktop) {
      tierMismatch ??= `${w}x${h} js=${r.tier} scss-desktop=${scssDesktop}`;
    }

    // 三档必须恰好命中一个：既不能重叠，也不能有没命中的空档
    const hits = [scssPhone, scssTablet, scssDesktop].filter(Boolean).length;
    if (hits !== 1) tierOverlap ??= `${w}x${h} 命中 ${hits} 档`;

    // device-mobile = 手机 + 平板（聊天页的 24px/6px 密度块）
    if ((r.isPhoneTier || r.isTabletTier) !== deviceMobileByScss(w)) {
      mobileMismatch ??= `宽 ${w} js=${r.tier} scss-mobile=${deviceMobileByScss(w)}`;
    }
  }
}
check("JS tier == SCSS device-* mixin（全矩阵，含宽高比分支）", tierMismatch === null, tierMismatch ?? "");
check("device-* 三档互斥且无空档（全矩阵）", tierOverlap === null, tierOverlap ?? "");
check("device-mobile == 手机档 + 平板档（全矩阵）", mobileMismatch === null, mobileMismatch ?? "");

// 宽扁小屏：宽度在手机档但够扁时必须走双栏（这就是需求里的那条例外）
for (const [w, h, wantTier] of [
  [480, 320, "tablet"],  // 3:2 —— 正好卡在阈值上
  [568, 320, "tablet"],  // iPhone SE 横屏
  [480, 400, "phone"],   // 1.2，还是单栏
  [500, 360, "phone"],   // 1.39，4:3 附近的窗口
  [600, 400, "tablet"],  // 1.5，宽度上限 + 正好 3:2
  [320, 200, "tablet"],  // 极小的宽扁窗口
  [393, 852, "phone"],   // 竖屏手机
]) {
  const r = at(w, h);
  check(
    `宽扁小屏 ${w}x${h}（宽/高 ${(w / h).toFixed(2)}）-> ${wantTier}`,
    r.tier === wantTier,
    `实际 ${r.tier}（isSmallLandscape=${r.isSmallLandscape}）`,
  );
}
check(
  "宽扁小屏标记 isSmallLandscape 只在宽 <= 600 时成立",
  at(480, 320).isSmallLandscape === true &&
    at(568, 320).isSmallLandscape === true &&
    at(480, 400).isSmallLandscape === false &&
    at(820, 400).isSmallLandscape === false,
);

// ── 8. 断点常量漂移：直接解析 SCSS ────────────────────────────────────────
const scssPath = fileURLToPath(new URL("../../web/src/styles/responsive-mixins.scss", import.meta.url));
const scss = readFileSync(scssPath, "utf8");
const readScssPx = (varName) => {
  const found = scss.match(new RegExp(`\\$${varName}\\s*:\\s*([0-9.]+)px`));
  return found ? Number(found[1]) : null;
};
/** 读无单位数值（例如宽高比 $bp-split-aspect: 1.499）。 */
const readScssNumber = (varName) => {
  const found = scss.match(new RegExp(`\\$${varName}\\s*:\\s*([0-9.]+)`));
  return found ? Number(found[1]) : null;
};
const DRIFT = [
  ["bp-phone-portrait-width", "phonePortraitWidth"],
  ["bp-phone-short-side", "phoneShortSide"],
  ["bp-phone-long-side", "phoneLongSide"],
  ["bp-narrow", "narrowViewportWidth"],
  ["bp-compact-height", "compactHeight"],
  ["bp-small-window", "smallWindowWidth"],
  ["bp-phone-max", "phoneMaxWidth"],
  ["bp-pc", "pcWidth"],
];
for (const [scssName, tsName] of DRIFT) {
  const scssValue = readScssPx(scssName);
  check(
    `断点一致: $${scssName} == ${tsName}`,
    scssValue === BP[tsName],
    `scss=${scssValue} ts=${BP[tsName]}`,
  );
}

// 宽高比阈值同样不能漂移（宽扁小屏判双栏的那个 1.499）
check(
  "断点一致: $bp-split-aspect == splitAspectRatio",
  readScssNumber("bp-split-aspect") === BP.splitAspectRatio,
  `scss=${readScssNumber("bp-split-aspect")} ts=${BP.splitAspectRatio}`,
);
// device-phone 必须带 max-aspect-ratio 守卫，否则宽扁小屏会被判成单栏
check(
  "@mixin device-phone 带 max-aspect-ratio 守卫",
  /@mixin device-phone\s*\{[^}]*max-aspect-ratio:\s*\$bp-split-aspect/s.test(scss),
  "device-phone 缺少宽高比守卫：手机横屏（480x320 之类）会被压成单栏",
);
// 双栏分支（device-small-landscape / device-tablet）必须用同一阈值取反
check(
  "@mixin device-small-landscape 用 min-aspect-ratio 取反",
  /@mixin device-small-landscape\s*\{[^}]*min-aspect-ratio:\s*#\{\$bp-split-aspect \+ 0\.001\}/s.test(scss),
  "device-small-landscape 的宽高比条件与 device-phone 不是严格互补",
);

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

// ── 11. 聊天页三档样式（单栏 / 双栏 / 24px 控件 + 6px 间距）────────────────
// 需求：正常情况只分三档 —— 大屏电脑端（常规布局）、平板端（两个界面一起展示）、
// 手机端（只展示一个界面）；平板与手机统一 24px 控件高度 + 6px 间距。
// 这几条都是「需求本身」，很容易被后来的改动顺手抹平，所以在源码层面钉死。

/// 抠出 `@include rp.xxx { ... }` 的完整块（按大括号配对）
function mixinBlock(source, includeName) {
  const start = source.indexOf(`@include rp.${includeName}`);
  if (start === -1) return "";
  const open = source.indexOf("{", start);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
}

/// 抠出 `选择器 { ... }` 的完整块（同样按大括号配对）
function ruleBlock(source, selector) {
  const start = source.indexOf(selector);
  if (start === -1) return "";
  const open = source.indexOf("{", start);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
}

const chatTierBlocks = {
  phone: mixinBlock(chatStyle, "device-phone"),
  tablet: mixinBlock(chatStyle, "device-tablet"),
  mobile: mixinBlock(chatStyle, "device-mobile"),
  smallLandscape: mixinBlock(chatStyle, "device-small-landscape"),
};

check(
  "聊天页用三档 mixin（device-phone / device-tablet / device-mobile）",
  Boolean(chatTierBlocks.phone) && Boolean(chatTierBlocks.tablet) && Boolean(chatTierBlocks.mobile),
  "缺档位块：手机单栏 / 平板双栏 / 移动端密度 有一档没写",
);
// 宽扁小屏（手机横屏）仍走双栏，但侧栏明显收窄 —— 否则 480 宽的屏幕里
// 180px 的会话列表会吃掉三分之一以上
check(
  "宽扁小屏（手机横屏）保持双栏并收窄侧栏",
  Boolean(chatTierBlocks.smallLandscape) &&
    /grid-template-columns:\s*clamp\(110px,[^)]*\)\s*minmax\(0,\s*1fr\)/.test(chatTierBlocks.smallLandscape),
  "device-small-landscape 块缺失，或没有把侧栏收窄（宽扁小屏会挤成单栏 / 侧栏过宽）",
);
check(
  "聊天页不再用旧的 rp.phone（免得分档判定与 JS 的 tier 打架）",
  !/@include rp\.phone\b/.test(chatStyle),
  "chat 样式里还有 @include rp.phone，它会与 tier（600/1200）边界不一致",
);
check(
  "大屏电脑端仍是常规密度（32px 控件 / 12px 间距）",
  /--chat-control-h:\s*32px/.test(chatStyle) && /--chat-gap:\s*12px/.test(chatStyle),
  "大屏默认档的 32px 控件 / 12px 间距丢了，电脑端会变挤",
);
check(
  "移动端（手机 + 平板）用 24px 控件 + 6px 间距",
  /--chat-control-h:\s*24px/.test(chatTierBlocks.mobile) && /--chat-gap:\s*6px/.test(chatTierBlocks.mobile),
  "device-mobile 块没把控件高度压到 24px / 间距压到 6px",
);
for (const name of ["phone", "tablet"]) {
  check(
    `${name} 档不另写密度变量（统一由 device-mobile 提供）`,
    !/--chat-control-h:/.test(chatTierBlocks[name]) && !/--chat-gap:/.test(chatTierBlocks[name]),
    `${name} 档自己又写了一遍密度变量：三档会变成各写各的，容易漏改`,
  );
}
check(
  "手机档是单栏（会话列表与聊天界面二选一）",
  /grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(chatTierBlocks.phone),
  "手机档没切成单栏：要么还是双栏，要么根本没写 grid-template-columns",
);
check(
  "平板档仍是双栏（两个界面一起展示）",
  !/grid-template-columns/.test(chatTierBlocks.tablet),
  "平板档里出现 grid-template-columns：平板必须保持双栏，不能塌成单栏",
);
check(
  "控件高度由 --chat-control-h 单点驱动（不是各处写死 px）",
  /--chat-control-h:/.test(chatStyle) && /height:\s*var\(--chat-control-h\)/.test(chatStyle),
  "靠散落的写死高度做不到「三档只改一处」",
);

// 会话列表项过去会溢出 li —— 根因是 EP 的 .el-badge 是 width: fit-content，
// 而标题 nowrap 让 min-content 等于整条标题宽，撑破容器。
// 修法必须让 .item 以 flex 子项身份参与收缩，不能靠调 padding。

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
// 历史：最早 .audio-message / .document-message 写死 width: 300px，窄容器里横向顶出气泡；
// 后来改成 `width: 300px; max-width: 100%`，看似收缩，实际仍缩不动 —— 卡片的父级
// 一路都是 fit-content，`max-width: 100%` 相对「自己撑出来的宽度」求百分比，只能退化成 auto。
// 现在收缩能力来自 `width: 100%`（父级 .msg-item.has-file / .bubble-wrap 提供确定宽度），
// 上限由 max-width: 300px 兜，下限仍是 min-width: 100px。
// 真实浏览器里的量测见 verify-chat-layout.mjs / 本轮手工 CDP 验证（393 → 277、320 → 213、170 → 100）。
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
  "卡片宽度上限 300px", /max-width:\s*300px/.test(cardMixin),
  "缺少 max-width: 300px（期望宽度上限）",
);
check(
  "卡片可随容器收缩", /width:\s*100%/.test(cardMixin),
  "缺少 width: 100%（依赖父级确定宽度收缩；max-width: 100% 在 fit-content 父级里会自循环）",
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
// 宽度链上「确定宽度」的那一环：没有它，卡片里的 width: 100% 依旧无处可依。
// chatStyle 已在上面（布局骨架那节）读过同一份文件，这里直接复用。
check(
  "文件气泡宽度链提供确定宽度",
  // 注意窗口要给够：.msg-item 里 .has-file 之前挂着一大段解释性注释。
  /&?\.has-file\s*\{[\s\S]{0,400}width:\s*100%/.test(chatStyle),
  "缺少 .msg-item.has-file { width: 100% }，卡片就没有可参照的可用宽度",
);
// 卡片与媒体是**两条**宽度链：卡片要撑开（音频/文档），媒体要贴合（图片/视频）。
// 混成一条的话必然二选一地坏掉 —— 要么图片被塞进 300px 透明盒子贴左边，
// 要么文档卡片塌到 100px 下限。真实宽度量测见 verify-chat-image-upload.mjs。
const hasFileBlock = ruleBlock(chatStyle, "&.has-file {");
const hasMediaBlock = ruleBlock(chatStyle, "&.has-media {");
check(
  "卡片消息把确定宽度继续传给气泡（.has-file .bubble-wrap { width: 100% }）",
  hasFileBlock.includes("bubble-wrap") && /(?:^|[;{\n])\s*width:\s*100%/m.test(hasFileBlock.slice(hasFileBlock.indexOf("bubble-wrap"))),
  "缺少 .msg-item.has-file .bubble-wrap { width: 100% }，文档/音频卡片会塌到 100px 下限",
);
check(
  "媒体消息不让气泡撑满（.has-media .bubble-wrap 没有 width: 100%）",
  hasMediaBlock.length > 0
    && !/(?:^|[;{\n])\s*width:\s*100%/m.test(hasMediaBlock.slice(hasMediaBlock.indexOf("bubble-wrap"))),
  "媒体分支又把 width: 100% 写回去了，图片会被放进撑满的盒子、贴到左边",
);
check(
  "媒体消息的气泡按内容收缩（.has-media 仍给出确定宽度上限）",
  /width:\s*100%/.test(hasMediaBlock) && /bubble-wrap[^{]*\{[^}]*max-width:\s*100%/.test(hasMediaBlock),
  "缺少 .msg-item.has-media 的 width: 100%（.content 没有可参照的宽度）或 .bubble-wrap 的 max-width",
);
check(
  "消息列表单列不被内容撑开",
  /\.message-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(chatStyle),
  "缺少 grid-template-columns: minmax(0, 1fr)，300px 宽的卡片会把整列撑开",
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

// 媒体气泡贴合自身尺寸：.file-message.media 不撑满，还要能把 min-width 清掉，
// 否则 flex 子项的 min-width: auto（= 图片自身宽度）会让它在窄屏里不肯缩。
const mediaMessageBlock = ruleBlock(fileMessage, "&.media {");
check(
  "图片/视频消息带 media 修饰类并贴合内容（.file-message.media { width: fit-content }）",
  /width:\s*fit-content/.test(mediaMessageBlock),
  "缺少 width: fit-content：图片会退回到 width: 100%，又被撑进 300px 的盒子",
);
check(
  "媒体气泡可收缩（.file-message.media 有 min-width: 0 与 max-width: min(300px, 100%)）",
  /min-width:\s*0/.test(mediaMessageBlock) && /max-width:\s*min\(300px,\s*100%\)/.test(mediaMessageBlock),
  "缺 min-width: 0（窄屏不缩）或 max-width（不夹 300px）",
);

console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
