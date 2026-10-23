import { createApp } from 'vue';
import App from "./App.vue";
import { setupMikuCursor } from "./libs/mikuCursor";
import { installDeviceLayout } from "./composables/use-device-layout";
import { initTelemetry, telemetry } from "./libs/telemetry";
import { initTheme } from "./composables/use-theme";

// 埋点初始化必须最早执行：这样连「应用启动阶段」的报错都能被记下来
initTelemetry();

// 导入style样式
import "./styles/index.scss";

// svg图标
import "virtual:svg-icons-register";

// element-plus 暗色主题变量，组件样式由 Vite resolver 按需引入
import "element-plus/theme-chalk/dark/css-vars.css";

const app = createApp(App);

// 主题必须早于挂载初始化：先写 data-theme / .dark，页面才不会先闪一帧默认主题。
// 实际切换动画由 Topbar 里的 toggleTheme() 触发。
initTheme();

// 路由管理 - Vue Router
import router from "./routers";

// 状态管理 - Pinia
import pinia from "./stores";
import 'pinia-plugin-persistedstate'
import { notifyError, notifyWarning } from "./utils/notification";

// 自定义指令集合
import directives from "./directives";

// 注册Vue Router路由系统
app.use(router);

// 注册Pinia状态管理
app.use(pinia);

// 注册全局自定义指令
app.use(directives);

app.config.errorHandler = (error: unknown, instance: unknown, info: string) => {
  // 记录到埋点（含组件栈与生命周期钩子名），便于定位「页面渲染异常」
  telemetry.captureError("vue-error-handler", error, {
    info,
    component: (instance as { $options?: { name?: string } } | null)?.$options?.name ?? null,
  });
  console.error("Vue 渲染异常:", error, info, instance);
  notifyError("页面渲染异常，请刷新后重试");
};

window.addEventListener("unhandledrejection", (event) => {
  telemetry.captureError("global-unhandledrejection", event.reason);
  console.error("未处理 Promise 异常:", event.reason);
  notifyWarning("请求处理异常，请稍后重试");
});

window.addEventListener("error", (event) => {
  telemetry.captureError("global-script-error", event.error ?? event.message, {
    file: event.filename,
    line: event.lineno,
  });
  console.error("全局脚本错误:", event.error || event.message);
});

setupMikuCursor();

// 设备布局必须在挂载前写入 <html>：
// CSS 的 .desktop-only / .mobile-only 以及各断点选择器直接读 data-layout 等属性，
// 晚一步就会先闪一帧错误结构。判定规则见 utils/device-layout.ts。
installDeviceLayout();

app.mount("#app");
