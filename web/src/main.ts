import { createApp } from 'vue';
import App from "./App.vue";
import { setupMikuCursor } from "./libs/mikuCursor";
import { initTelemetry, telemetry } from "./libs/telemetry";

// 埋点初始化必须最早执行：这样连「应用启动阶段」的报错都能被记下来
initTelemetry();

// 导入style样式
import "./styles/index.scss";

// svg图标
import "virtual:svg-icons-register";

// element-plus 暗色主题变量，组件样式由 Vite resolver 按需引入
import "element-plus/theme-chalk/dark/css-vars.css";

const app = createApp(App);

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

app.mount("#app");
