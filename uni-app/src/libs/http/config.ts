/**
 * @file 通用 HTTP 配置
 * @description 配置项目通用的 HTTP 实例，包含基础路径、并发限制、重试机制等
 */

import createHttp from '@/libs/http';
import { API_BASE_URL } from '@/config';

/**
 * 通用 HTTP 请求实例
 */
export const http = createHttp(API_BASE_URL, {
    concurrencyLimit: 10,           // 最大并发请求数
    retryCount: 2,                  // 请求失败重试次数
    retryDelay: 1000,               // 重试延迟时间 (ms)
    preventDuplicateInterval: 1000,  // 合并并发请求的时间窗口 (ms)
});

export default http;
