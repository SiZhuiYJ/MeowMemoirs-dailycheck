// @/libs/http/type.ts

import type { AxiosRequestConfig } from "axios";

/**
 * 后端接口统一响应结构。
 */
export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
  success?: boolean;
}

/**
 * HTTP 请求扩展配置（在 AxiosRequestConfig 基础上追加能力）。
 */
export interface HttpRequestConfig extends AxiosRequestConfig {
  /**
   * 是否显示默认错误提示，默认 true。
   */
  showError?: boolean;

  /**
   * 是否返回原始 AxiosResponse（不进行 data 解包）。
   */
  originalResponse?: boolean;

  /**
   * 失败后重试次数，仅对 5xx 生效。
   */
  retryCount?: number;

  /**
   * 是否允许并发复用（关闭后会复用相同请求的 Promise 结果）。
   */
  allowDuplicate?: boolean;

  /**
   * 内部重试计数，不对外暴露。
   */
  _retryCount?: number;

  /**
   * 内部标记：是否已经做过 401 重试。
   */
  _retry?: boolean;

  /**
   * 跳过 accessToken 自动注入（如登录/刷新等接口）。
   */
  skipAuth?: boolean;

  /**
   * 跳过 401 自动刷新逻辑。
   */
  skipAuthRefresh?: boolean;

  /**
   * 交互优先级请求：并发槽位不足时插队到队列最前面。
   * 用于「用户主动触发」的请求（发送消息、标记已读等），
   * 避免被后台轮询/批量刷新请求堵住。
   */
  priority?: boolean;
}

declare module "axios" {
  interface AxiosRequestConfig {
    showError?: boolean;
    originalResponse?: boolean;
    retryCount?: number;
    allowDuplicate?: boolean;
    _retryCount?: number;
    _retry?: boolean;
    skipAuth?: boolean;
    skipAuthRefresh?: boolean;
    priority?: boolean;
  }
}
