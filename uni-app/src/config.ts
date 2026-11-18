/**
 * 接口基址
 *
 * 生产 / H5 生产：`VITE_API_BASE_URL` 是单个绝对地址（如 https://meowmemoirs.cn）。
 * H5 开发：强制空串，走 Vite 同源代理（/mm → VITE_API_PROXY_TARGET）。
 * 小程序开发：`VITE_API_BASE_URL` 可以是**逗号分隔的候选列表**（由
 *   scripts/dev-env.mjs 自动扫描本机网卡生成），运行时由 libs/http/apiBase.ts
 *   并行探测、选第一个可达的地址，换网段/Wi-Fi 不用改配置。
 */
const ENV_API_BASE: string = String(import.meta.env.VITE_API_BASE_URL ?? '').trim();

let apiBaseList: string[] = ENV_API_BASE
  .split(',')
  .map((item: string) => item.trim())
  .filter(Boolean);

// #ifdef H5
// H5 开发模式强制走同源代理；生产构建仍用 .env.production 的绝对地址
if (import.meta.env.DEV) apiBaseList = [''];
// #endif

// 没配置时：先默认本机开发后端（开发环境），生产打包通常会带 .env.production
if (apiBaseList.length === 0) {
  apiBaseList = ['https://meowmemoirs.cn'];
}

/** 候选接口基址（生产只有 1 个；小程序开发可能有多个，按顺序探测） */
export const API_BASE_CANDIDATES: readonly string[] = apiBaseList;

/** 兼容旧代码：默认取第一个候选（页面里的文件 URL 请改用 libs/http/apiBase.ts 的响应式 apiBase） */
export const API_BASE_URL = apiBaseList[0]!;

export const APP_TITLE = import.meta.env.VITE_APP_TITLE ?? '喵咪记事簿';
