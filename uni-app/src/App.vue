<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { useAuthStore } from './stores/auth';
import { useThemeStore } from './stores/theme';

onLaunch(() => {
  console.log("App Launch");

  // Init Theme
  const themeStore = useThemeStore();
  themeStore.initTheme();

  // Check auth
  const auth = useAuthStore();
  if (!auth.isAuthenticated) {
    uni.reLaunch({ url: '/pages/auth/index' });
  } else {
    // 已登录时由 pages.json 的首页直接进入主页，无需额外跳转
  }
});
onShow(() => {
  console.log("App Show");
  const themeStore = useThemeStore();
  themeStore.updateNavBarColor();
});
onHide(() => {
  console.log("App Hide");
});
</script>
<style>
/*
  全局兜底主题（与 web 端一致的单色风格）：
  · 中性色：浅灰页面 + 白色卡片 + 灰色文字；
  · 强调色：只保留一个种子色（默认 #e3c0df）推导出的色阶；
  · 页面根节点会再绑定 :style="themeStore.themeStyle"，覆盖成用户当前日/夜主题与自定义强调色。

  微信小程序不支持 :root 级变量级联，所以两端都写在 `page` 选择器上，
  同时保留 `:root` 供 H5 使用（H5 中 page 对应 uni-page-body）。
*/
:root,
page {
  /* —— 中性色（默认日间，与 stores/theme.ts 完全一致）—— */
  --bg-color: #f3f4f6;
  --bg-elevated: #ffffff;
  --surface-soft: #f9fafb;
  --border-color: #e5e7eb;
  --border-strong: #d1d5db;
  --divider-color: #f3f4f6;
  --text-color: #111827;
  --text-muted: #6b7280;
  --text-faint: #9ca3af;
  --mask-color: rgba(17, 24, 39, 0.32);
  --card-shadow: 0 6px 18px rgba(227, 192, 223, 0.14),
    0 3px 8px rgba(17, 24, 39, 0.06);
  /* 顶栏毛玻璃（与 web chat 顶部栏一致：半透明底 + 背景模糊） */
  --header-bg: rgba(243, 244, 246, 0.52);
  --header-bg-fallback: rgba(243, 244, 246, 0.78);
  --header-border: rgba(17, 24, 39, 0.08);
  /* 遮罩层毛玻璃（打卡列表卡片蒙层） */
  --overlay-bg: rgba(243, 244, 246, 0.4);
  --overlay-bg-fallback: rgba(243, 244, 246, 0.78);

  /* —— 单一强调色：种子色 #e3c0df 的日间色阶 —— */
  --theme-color: #e3c0df;
  --theme-color-rgb: 227, 192, 223;
  --theme-color-strong: #9b4f93;
  --theme-color-deep: #783a71;
  --theme-color-muted: #af79a9;
  --theme-color-soft: #f7e9f5;
  --theme-color-softer: #faf4fa;
  --theme-color-contrast: #2b1428;
  --theme-outer-glow: 0 24px 70px rgba(227, 192, 223, 0.24),
    0 12px 30px rgba(17, 24, 39, 0.14);
  --theme-outer-glow-soft: 0 12px 36px rgba(227, 192, 223, 0.18),
    0 6px 16px rgba(17, 24, 39, 0.1);
  --theme-outer-glow-lighter: 0 6px 18px rgba(227, 192, 223, 0.14),
    0 3px 8px rgba(17, 24, 39, 0.06);
  --theme-primary: var(--theme-color-strong);
  --theme-primary-bg: var(--theme-color);
  --theme-primary-hover: #d6a4d1;
  --theme-primary-active: #cd8fc6;
  --theme-action-bg: #9b4f93;
  --theme-action-hover: #783a71;
  --theme-action-active: #673261;
  --theme-action-contrast: #ffffff;
  --theme-gradient: linear-gradient(135deg, #9b4f93, #783a71);
  --accent-color: var(--theme-color-strong);
  --accent-alt: var(--theme-color);
  --accent-on: #ffffff;
  /* 兼容旧代码的别名 */
  --theme-primary-light: var(--theme-color-soft);
  --bg-soft: var(--theme-color-soft);
  --uni-color-primary: var(--theme-color-strong);
  --uni-bg-color: var(--bg-color);
  --uni-text-color: var(--text-color);

  /* —— 语义色（与 web 日历 / 提示一致）—— */
  --color-success: #22c55e;
  --color-success-soft: rgba(34, 197, 94, 0.12);
  --color-success-text: #15803d;
  --color-warning: #eab308;
  --color-warning-soft: rgba(234, 179, 8, 0.14);
  --color-warning-text: #a16207;
  --color-danger: #ef4444;
  --color-danger-soft: rgba(239, 68, 68, 0.1);
  --color-danger-text: #b91c1c;
  --color-info: #6b7280;

  /* —— 尺寸 / 布局（按移动端与小程序规范）—— */
  --page-pad: 16px;
  --card-radius: 12px;
  --control-h: 44px;
  --tabbar-h: 56px;
  /* 自定义导航栏标题行高度（与 MmNavBar.vue 的 BAR_HEIGHT 保持一致） */
  --navbar-h: 44px;
  /* --status-bar-height 由 uni-app 运行时注入（H5 为 0），这里不要重复声明 */
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);

  --uni-card-border-radius: 16px;
  --uni-card-padding: 16px;
  --uni-card-margin-bottom: 12px;
  --uni-header-border-radius: 16px;
  --uni-header-padding: 12px 16px;
  --uni-header-margin-bottom: 12px;
  --uni-container-padding: 12px;
  --uni-button-margin-top: 0px;

  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-color);
  background-color: var(--bg-color);
  -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
}

/* 夜间兜底（页面根节点的 themeStyle 会覆盖；小程序里可给 page 加 .dark-mode） */
:root.dark-mode,
page.dark-mode {
  --bg-color: #020617;
  --bg-elevated: #0f172a;
  --surface-soft: #111c2e;
  --border-color: rgba(148, 163, 184, 0.16);
  --border-strong: #263449;
  --divider-color: rgba(148, 163, 184, 0.12);
  --text-color: #e5e7eb;
  --text-muted: #9ca3af;
  --text-faint: #94a3b8;
  --mask-color: rgba(2, 6, 23, 0.62);
  --card-shadow: 0 10px 30px rgba(2, 6, 23, 0.45);
}

page {
  background-color: var(--bg-color);
  color: var(--text-color);
  min-height: 100%;
}

/* 统一盒模型，避免移动端 padding 撑破宽度 */
view,
text,
button,
input,
textarea,
scroll-view,
swiper,
swiper-item {
  box-sizing: border-box;
}

/* 小程序 button 自带边框/伪元素/默认尺寸，这里统一重置 */
button {
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
  text-align: inherit;
}

button::after {
  border: none;
}

input,
textarea {
  color: var(--text-color);
}

/* 触屏点按反馈：给可点击 view 加 hover-class="mm-hover" */
.mm-hover {
  opacity: 0.72;
}

/* ==============================================
   毛玻璃顶栏（对齐 web chat 界面顶部栏）
   ==============================================
   结构：固定/绝对定位在内容上方的标题栏，半透明底 + backdrop-filter 模糊。
   小程序 / 不支持 backdrop-filter 的环境回退到 --header-bg-fallback（0.78 透明度），
   保证标题文字可读；支持时用 --header-bg（0.52 透明度）呈现通透的磨砂玻璃，
   滚动内容从下方穿过时能明显看到被模糊，而不是被完全遮住。
   底部留 1px 半透明分割线，滚动内容从下方穿过。 */
.mm-frosted-header {
  background-color: var(--header-bg-fallback);
  border-bottom: 1px solid var(--header-border);
}

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .mm-frosted-header {
    background-color: var(--header-bg);
    -webkit-backdrop-filter: blur(18px) saturate(180%);
    backdrop-filter: blur(18px) saturate(180%);
  }
}

/* H5 隐藏滚动条，移动端观感更接近小程序 */
::-webkit-scrollbar {
  display: none;
  width: 0 !important;
  height: 0 !important;
  -webkit-appearance: none;
  background: transparent;
}

/* 解决 H5 下 uni-input 选中问题 */
uni-input input {
  user-select: text;
  -webkit-user-select: text;
}

/* ==============================================
   共享 UI 类（页面可按需引用，scoped 样式里也可覆盖）
   ============================================== */
.mm-page {
  min-height: 100vh;
  box-sizing: border-box;
  background-color: var(--bg-color);
  color: var(--text-color);
}

.mm-card {
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 16px;
  box-sizing: border-box;
}

.mm-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

.mm-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--control-h);
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  box-sizing: border-box;
  transition: opacity 0.2s ease;
}

.mm-btn-primary {
  background: var(--theme-gradient);
  color: var(--theme-action-contrast);
}

.mm-btn-ghost {
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
}

.mm-btn-danger {
  background-color: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  color: var(--color-danger-text);
}

.mm-btn:disabled,
.mm-btn[disabled] {
  opacity: 0.55;
}

.mm-input {
  width: 100%;
  height: var(--control-h);
  padding: 0 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  font-size: 14px;
  color: var(--text-color);
  box-sizing: border-box;
}
</style>
