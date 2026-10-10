// 全局默认配置项

// 接口地址
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

//网页名称
export const APP_TITLE = import.meta.env.VITE_APP_TITLE;


// 首页地址[默认]
export const HOME_URL: string = "/home";

// 登录页地址[默认]
export const LOGIN_URL: string = "/login";

// pinia仓库前缀
export const CACHE_PREFIX: string = "MM-";

// Svg本地图片使用 - 开头才会生效
export const SVG_PREFIX: string = "mm-";

// 默认主题颜色
export const DEFAULT_THEME: string = "#e3c0df";

// 路由白名单地址[本地存在的路由 staticRouter.ts 中]
export const ROUTER_WHITE_LIST: string[] = [
  "/500",
  "/404",
  "/403",
  "/login",
  "/home/index",
  "/main/blogPost",
  "/main/blogPost/article",
  "/main/animation/timeStyle",
  "/main/animation/starrySky",
  "/main/animation/banner",
  "/main/animation/love",
  "/main/confession/love",
  "/main/confession/certificate",
  "/main/confession/settings",
  "/main/memo/notes",
  "/main/memo/todo",
  "/main/classSchedule",
  "/main/effect/ipLocation",
  "/main/effect/musicPlayer",
  "/main/effect/newMusicPlayer",
  "/html/index.html",
  "/html/script.js",
  "/html/style.css",
  "/html/gsap.min.js",
  "/main/effect/shooting",
];
