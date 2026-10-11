/**
 * 埋点事件模型。
 *
 * 设计目标：出问题时能回答「谁、在什么状态、因为什么、报了什么」。
 * 每条事件都带 会话/页面加载 标识，便于把一次「意外刷新」和它前后的操作串起来。
 */

export type TelemetryLevel = "debug" | "info" | "warn" | "error";

/** 事件分类，与查看页面的筛选维度一一对应。 */
export type TelemetryCategory =
  | "app"      // 应用生命周期：页面加载/卸载/可见性/前后台
  | "error"    // 未捕获异常、Promise 拒绝、Vue 渲染异常
  | "console"  // 被捕获的 console.error / console.warn
  | "http"     // HTTP 请求与失败
  | "auth"     // 401、刷新令牌、强制登出
  | "route"    // 路由跳转与导航异常
  | "signalr"  // 实时连接生命周期
  | "chat"     // 聊天业务动作
  | "file"     // 文件选择/处理/上传
  | "ui";      // 用户可见提示（toast）

export interface TelemetryEvent {
  id: string;
  /** 发生时间（ISO 字符串，便于直接阅读）。 */
  ts: string;
  /** 发生时间（epoch 毫秒，便于排序/差值计算）。 */
  t: number;
  level: TelemetryLevel;
  category: TelemetryCategory;
  /** 简短事件名，例如 page-load / http-401 / file-select。 */
  name: string;
  /** 同一标签页会话 id（sessionStorage，刷新后不变）。 */
  sessionId: string;
  /** 本次页面加载 id（每次加载都不同）。 */
  pageLoadId: string;
  /** 同一标签页会话内的第几次页面加载（>1 说明发生过刷新）。 */
  loadCount: number;
  route?: string;
  data?: Record<string, unknown>;
  stack?: string;
}

export interface TelemetryPendingOp {
  key: string;
  label: string;
  startedAt: number;
  meta?: Record<string, unknown>;
}
