/**
 * @file 课程模块 HTTP 配置
 * @description 配置课程模块专用的 HTTP 实例，包含特定的 API 基础路径和请求策略
 */

import createHttp from '@/libs/http';

/** 课程模块 API 基础路径 */
const CLASS_API_BASE_URL = 'https://www.meowmemoirs.cn/MeowMemoirs';

/**
 * 课程模块专用的 HTTP 请求实例
 */
export const http = createHttp(CLASS_API_BASE_URL, {
    concurrencyLimit: 5,            // 课程模块较低并发限制
    retryCount: 3,                  // 增加重试次数以提高稳定性
    retryDelay: 1000,               // 重试延迟 (ms)
    preventDuplicateInterval: 1000,  // 合并并发请求的时间窗口 (ms)
});

export default http;