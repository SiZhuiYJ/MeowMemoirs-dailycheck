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

/**
 * 业务流程上下文。
 *
 * 一条普通事件只说明「此刻发生了什么」；带 flow 的事件还能说明
 * 「它属于哪一次操作、是第几步、离开始过了多久」。
 * 例如「点击上传 → 选择器打开 → 选文件 → 上传 → 消息发出」会被同一个 flow.id 串起来，
 * 中途刷新/切后台也能从本地流程记录里看出断在哪一步。
 */
export interface TelemetryFlowRef {
  id: string;
  /** 流程类型，例如 chat-file-upload。 */
  name: string;
  /** 当前步骤名，例如 input-click。 */
  step: string;
  /** 从 0 开始的步骤序号。 */
  index: number;
  /** 从流程开始到本步骤的耗时（毫秒）。 */
  elapsedMs: number;
}

export type TelemetryFlowStatus = "running" | "done" | "aborted";

export interface TelemetryFlowStep {
  step: string;
  /** 从 0 开始的步骤序号；流程步骤被裁剪后仍然连续。 */
  index: number;
  at: number;
  elapsedMs: number;
  level: TelemetryLevel;
  /** 对应事件 id，方便和事件列表对上。 */
  eventId?: string;
  data?: Record<string, unknown>;
}

/** 一次完整业务流程的本地记录（会持久化，刷新后仍可回溯）。 */
export interface TelemetryFlowRecord {
  id: string;
  name: string;
  status: TelemetryFlowStatus;
  startedAt: number;
  updatedAt: number;
  /** 结束耗时；running 状态下为空。 */
  durationMs?: number;
  sessionId: string;
  pageLoadId: string;
  route?: string;
  /** 流程开始时的环境快照（来源、设备、输入方式等）。 */
  meta?: Record<string, unknown>;
  /** 结束/中断原因，例如 picker-not-opened / page-reload-or-close。 */
  endReason?: string;
  steps: TelemetryFlowStep[];
}

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
  /** 所属业务流程 id（没有流程的事件为空）。 */
  flowId?: string;
  flowName?: string;
  /** 当前流程步骤名与序号。 */
  flowStep?: string;
  flowIndex?: number;
  /** 从流程开始到本事件的耗时（毫秒）。 */
  flowElapsedMs?: number;
}

export interface TelemetryPendingOp {
  key: string;
  label: string;
  startedAt: number;
  meta?: Record<string, unknown>;
}
