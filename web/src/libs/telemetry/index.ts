/**
 * 埋点对外 API。
 *
 * 用法：
 *   import { telemetry } from "@/libs/telemetry";
 *   telemetry.track("file", "file-select", { count: 2 });
 *   telemetry.captureError("upload", error, { fileName });
 *
 * 采集策略：
 *  - 始终写入本地环形缓冲（localStorage，最多 600 条，刷新后可回溯）
 *  - 默认每 15 秒或出现错误时批量上报到后端（可用 VITE_TELEMETRY_REPORT=false 关闭）
 *  - 页面卸载时用 sendBeacon 同步上报，尽量不丢「崩溃前最后几条」
 */
import { API_BASE_URL } from "@/config";
import { installInstrumentation, type TelemetryApi } from "./instrument";
import {
  abortFlowRecord,
  clearFlows,
  completeFlow,
  createFlow,
  getFlow,
  getFlows,
  getRunningFlows,
  initFlowStore,
  listInterruptedFlows,
  peekFlowStep,
  persistFlows,
  recordFlowStep,
} from "./flow";
import {
  appendEvent,
  buildEvent,
  clearEvents,
  clearPending,
  getEvents,
  getIdentity,
  getPending,
  initIdentity,
  markPending,
  persistNow,
  persistOnHide,
  sanitizeData,
  truncateText,
} from "./store";
import type {
  TelemetryCategory,
  TelemetryEvent,
  TelemetryFlowRef,
  TelemetryLevel,
} from "./types";

export type {
  TelemetryEvent,
  TelemetryLevel,
  TelemetryCategory,
  TelemetryFlowRecord,
  TelemetryFlowRef,
  TelemetryFlowStatus,
  TelemetryFlowStep,
} from "./types";
export { getEvents, clearEvents, getIdentity, getPending, markPending, clearPending };
export { getFlows, getRunningFlows, clearFlows };

const ENABLED = import.meta.env.VITE_TELEMETRY_ENABLED !== "false";
const REPORT_ENABLED = import.meta.env.VITE_TELEMETRY_REPORT !== "false";
const DEBUG_ENABLED = import.meta.env.VITE_TELEMETRY_DEBUG !== "false";
const REPORT_URL = `${API_BASE_URL}/mm/Telemetry/events`;
const FLUSH_INTERVAL_MS = 15000;
const ERROR_FLUSH_DELAY_MS = 2000;
const MAX_BATCH = 120;
/** 限流：10 秒内最多记这么多条，防止异常风暴写爆存储。 */
const MAX_EVENTS_PER_WINDOW = 240;
const RATE_WINDOW_MS = 10000;

let initialized = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushIntervalActive = false;
let errorFlushTimer: ReturnType<typeof setTimeout> | null = null;
let rateWindowStart = 0;
let rateCount = 0;
let rateLimited = false;
const listeners = new Set<(event: TelemetryEvent) => void>();
/** 已上报过的事件（用 WeakSet 标记，缓冲被裁剪也不会重复上报）。 */
const reported = new WeakSet<TelemetryEvent>();

/**
 * 已上报事件 id（持久化到 localStorage）。
 * 刷新后 initIdentity 会把本会话的事件从本地读回缓冲，
 * 若只靠内存里的 WeakSet 判断，整批旧事件会被重新上报一次
 * ——实测会把日志灌成 3 倍冗余（2376 条里只有 791 条唯一），
 * 因此已上报 id 必须跨刷新保留。
 */
const REPORTED_KEY = "MM-telemetry-reported";
const MAX_REPORTED_IDS = 1200;
let reportedIds = new Set<string>();
let reportedOrder: string[] = [];

function rememberReported(events: TelemetryEvent[]) {
  for (const event of events) {
    reportedIds.add(event.id);
    reportedOrder.push(event.id);
  }
  if (reportedOrder.length > MAX_REPORTED_IDS) {
    reportedOrder = reportedOrder.slice(-MAX_REPORTED_IDS);
    reportedIds = new Set(reportedOrder);
  }
  try {
    localStorage.setItem(REPORTED_KEY, JSON.stringify(reportedOrder));
  } catch {
    // 存储不可用时退化为「本次会话内不重复上报」
  }
}

function resetReported() {
  reportedIds = new Set();
  reportedOrder = [];
  try {
    localStorage.removeItem(REPORTED_KEY);
  } catch {
    // ignore
  }
}

export function isTelemetryDebugEnabled() {
  return DEBUG_ENABLED;
}

/** 业务代码用它判断「埋点整体是否启用」，关闭时不做任何额外采集。 */
export function isTelemetryEnabled() {
  return ENABLED;
}

function notify(event: TelemetryEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // 查看页面的异常不能影响业务
    }
  }
}

function withinRateLimit(): boolean {
  const now = Date.now();
  if (now - rateWindowStart > RATE_WINDOW_MS) {
    rateWindowStart = now;
    rateCount = 0;
    if (rateLimited) {
      rateLimited = false;
      appendEvent(buildEvent({
        level: "info",
        category: "app",
        name: "telemetry-resumed",
        data: { note: "事件限流已恢复" },
      }));
    }
  }
  rateCount += 1;
  if (rateCount > MAX_EVENTS_PER_WINDOW) {
    rateLimited = true;
    return false;
  }
  return true;
}

export function track(
  category: TelemetryCategory,
  name: string,
  data?: Record<string, unknown>,
  level: TelemetryLevel = "info",
  flow?: TelemetryFlowRef,
): TelemetryEvent {
  const event = buildEvent({ level, category, name, data, flow });
  if (!ENABLED) return event;
  if (!withinRateLimit()) return event;

  appendEvent(event);
  notify(event);

  if (level === "error" && REPORT_ENABLED) scheduleErrorFlush();
  return event;
}

/** 把一步同时写进事件流与流程记录；流程已结束时返回 null。 */
function emitFlowStep(
  flowId: string,
  step: string,
  level: TelemetryLevel,
  data: Record<string, unknown> | undefined,
  category: TelemetryCategory,
): TelemetryEvent | null {
  const flow = getFlow(flowId);
  if (!flow || flow.status !== "running") return null;

  const context = peekFlowStep(flowId);
  if (!context) return null;

  const ref: TelemetryFlowRef = {
    id: flow.id,
    name: flow.name,
    step,
    index: context.index,
    elapsedMs: context.elapsedMs,
  };
  const event = track(category, step, data, level, ref);
  // 即使事件被限流丢弃，流程记录也要保留这一步 —— 事后看「断在哪」比看单条事件更重要。
  recordFlowStep(flowId, step, level, data, event.id, context);
  return event;
}

export interface TelemetryFlowHandle {
  readonly id: string;
  readonly name: string;
  readonly category: TelemetryCategory;
  /** 记录一步并产生同名事件；流程已结束则返回 null。 */
  step(
    step: string,
    data?: Record<string, unknown>,
    level?: TelemetryLevel,
    category?: TelemetryCategory,
  ): TelemetryEvent | null;
  /** 正常结束（可选自定义结束步骤名）。 */
  finish(
    step?: string,
    data?: Record<string, unknown>,
    level?: TelemetryLevel,
    category?: TelemetryCategory,
  ): TelemetryEvent | null;
  /** 异常 / 取消 / 被拦截结束。 */
  abort(
    reason: string,
    data?: Record<string, unknown>,
    level?: TelemetryLevel,
    category?: TelemetryCategory,
  ): TelemetryEvent | null;
  isActive(): boolean;
  lastStep(): string | null;
}

function createNoopFlowHandle(name: string, category: TelemetryCategory): TelemetryFlowHandle {
  return {
    id: "",
    name,
    category,
    step: () => null,
    finish: () => null,
    abort: () => null,
    isActive: () => false,
    lastStep: () => null,
  };
}

/**
 * 开始一次业务流程，返回可继续追加步骤的句柄。
 *
 * 同名流程若还在 running（上一次点击没等到 change / 取消，卡住了），
 * 会先被标记为 superseded 收尾，避免流程永久挂着。
 */
export function startFlow(
  name: string,
  meta?: Record<string, unknown>,
  category: TelemetryCategory = "app",
): TelemetryFlowHandle {
  if (!ENABLED) return createNoopFlowHandle(name, category);

  for (const previous of getRunningFlows(name)) {
    emitFlowStep(
      previous.id,
      "flow-aborted",
      "warn",
      { reason: "superseded", note: "新的同名流程开始，旧流程没有正常收尾" },
      category,
    );
    abortFlowRecord(previous.id, "superseded");
  }

  const flow = createFlow(name, meta);
  emitFlowStep(flow.id, "flow-start", "info", meta, category);

  let active = true;
  const stillRunning = () => active && getFlow(flow.id)?.status === "running";
  const close = () => {
    active = false;
  };

  return {
    id: flow.id,
    name,
    category,
    step(stepName, data, level = "info", stepCategory = category) {
      if (!stillRunning()) return null;
      return emitFlowStep(flow.id, stepName, level, data, stepCategory);
    },
    finish(stepName = "flow-complete", data, level = "info", stepCategory = category) {
      if (!stillRunning()) return null;
      const event = emitFlowStep(flow.id, stepName, level, data, stepCategory);
      completeFlow(flow.id, stepName);
      close();
      return event;
    },
    abort(reason, data, level = "warn", stepCategory = category) {
      if (!stillRunning()) return null;
      const event = emitFlowStep(
        flow.id,
        "flow-aborted",
        level,
        { reason, ...(data ?? {}) },
        stepCategory,
      );
      abortFlowRecord(flow.id, reason);
      close();
      return event;
    },
    isActive: stillRunning,
    lastStep() {
      const record = getFlow(flow.id);
      const last = record && record.steps.length > 0 ? record.steps[record.steps.length - 1] : null;
      return last?.step ?? null;
    },
  };
}

/**
 * 上次页面加载遗留下来、没来得及收尾的流程。
 *
 * 移动端最常见的一种「上传没反应」其实是选择器打开时页面被系统回收 / 用户下拉刷新，
 * 事件还来不及上报。启动时把这类流程标成 interrupted，并补一条 error 事件。
 */
function recoverInterruptedFlows() {
  const identity = getIdentity();
  for (const flow of listInterruptedFlows(identity.pageLoadId, identity.sessionId)) {
    const last = flow.steps.length > 0 ? flow.steps[flow.steps.length - 1] : null;
    emitFlowStep(
      flow.id,
      "flow-interrupted",
      "error",
      {
        flowName: flow.name,
        lastStep: last?.step ?? null,
        steps: flow.steps.length,
        startedAgoMs: Date.now() - flow.startedAt,
        note: "上一次页面加载期间的流程没有正常结束（刷新 / 关闭 / 被系统回收）",
      },
      "app",
    );
    abortFlowRecord(flow.id, "page-reload-or-close");
  }
}

/** 统一记录错误：自动提取 message/stack，并附带上下文。 */
export function captureError(
  source: string,
  error: unknown,
  extra?: Record<string, unknown>,
): TelemetryEvent {
  const normalized = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: typeof error === "string" ? error : JSON.stringify(sanitizeData(error)) };

  const event = buildEvent({
    level: "error",
    category: "error",
    name: source,
    data: {
      errorName: normalized.name,
      message: truncateText(normalized.message, 600),
      ...(extra ?? {}),
    },
    stack: normalized.stack,
  });

  if (!ENABLED) return event;
  if (!withinRateLimit()) return event;

  appendEvent(event);
  notify(event);
  if (REPORT_ENABLED) scheduleErrorFlush();
  return event;
}

/** 未上报的事件批量提交。sync=true 用 sendBeacon（页面卸载时用）。 */
export function flush(sync = false) {
  if (!ENABLED || !REPORT_ENABLED) return;

  const batch = getEvents()
    .filter((event) => !reported.has(event) && !reportedIds.has(event.id))
    .slice(-MAX_BATCH);
  if (batch.length === 0) return;

  const payload = JSON.stringify({
    client: { ...getIdentity(), ts: new Date().toISOString() },
    events: batch,
  });

  for (const event of batch) reported.add(event);
  rememberReported(batch);

  if (sync) {
    try {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon?.(REPORT_URL, blob)) return;
    } catch {
      // 落到下面的 fetch 兜底
    }
  }

  try {
    void fetch(REPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // 上报失败无所谓：本地已经留了一份
    });
  } catch {
    // ignore
  }
}

function scheduleErrorFlush() {
  if (errorFlushTimer) return;
  errorFlushTimer = setTimeout(() => {
    errorFlushTimer = null;
    persistNow();
    flush();
  }, ERROR_FLUSH_DELAY_MS);
}

/** 订阅新事件（查看页面用）。 */
export function subscribe(listener: (event: TelemetryEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 导出为可读 JSON 文本。 */
export function exportJson(): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      identity: getIdentity(),
      pending: getPending(),
      flows: getFlows(),
      events: getEvents(),
    },
    null,
    2,
  );
}

const api: TelemetryApi = { track, captureError, flush };

/** 在 main.ts 中调用一次。 */
export function initTelemetry() {
  if (initialized) return;
  initialized = true;

  initIdentity();
  initFlowStore();

  // 载入「已上报 id」，避免刷新后重复上报历史事件
  try {
    const raw = localStorage.getItem(REPORTED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      reportedOrder = parsed.filter((item): item is string => typeof item === "string");
      reportedIds = new Set(reportedOrder);
    }
  } catch {
    resetReported();
  }

  installInstrumentation(api);
  // 必须在 installInstrumentation 之后：补发的 interrupted 事件要走正常的采集管道
  recoverInterruptedFlows();

  // 本地缓冲的落盘和「是否上报」无关：切后台 / 关页面时都立即写一次，
  // 平时则由 store 里的 2s 节流合并写入。
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persistOnHide();
      persistFlows();
    }
  });
  window.addEventListener("pagehide", () => {
    persistOnHide();
    persistFlows();
  });

  if (!ENABLED || !REPORT_ENABLED) return;
  flushTimer = setInterval(() => flush(), FLUSH_INTERVAL_MS);
  flushIntervalActive = true;
  // 移动端切后台可能不触发 pagehide，visibilitychange 时也补一次同步上报
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
}

/** 停止定时上报（一般不需要调用，留作测试/热更新时清理）。 */
export function stopTelemetry() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushIntervalActive = false;
}

/** 供业务代码使用的聚合对象。 */
export const telemetry = {
  track,
  captureError,
  flush,
  subscribe,
  exportJson,
  startFlow,
  getFlows,
  getRunningFlows,
  clearFlows,
  getEvents,
  clearEvents: () => {
    clearEvents();
    resetReported();
  },
  getIdentity,
  getPending,
  markPending,
  clearPending,
  isEnabled: () => ENABLED,
  isDebugEnabled: () => DEBUG_ENABLED,
  isReportingActive: () => flushIntervalActive,
  stop: stopTelemetry,
};

export default telemetry;
