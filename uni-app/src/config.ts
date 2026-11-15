/**
 * 接口基址
 *
 * · H5 开发（npm run dev:h5）：置空，改走 Vite 同源代理（vite.config.ts 里的
 *   /mm → VITE_API_PROXY_TARGET），这样手机 / 局域网访问都不会撞后端 CORS 白名单；
 * · 微信小程序 / App / H5 生产：必须绝对地址，取 .env 里的 VITE_API_BASE_URL
 *   （小程序端没有同源概念，相对路径无法请求）。
 */
const ENV_API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').trim();
let apiBase = ENV_API_BASE;
// #ifdef H5
// H5 开发模式下强制走同源代理；生产构建仍用 .env.production 的绝对地址
if (import.meta.env.DEV) apiBase = '';
// #endif
export const API_BASE_URL = apiBase || 'https://paw.meowmemoirs.cn';
export const APP_TITLE = import.meta.env.VITE_APP_TITLE ?? '喵咪记事簿';

