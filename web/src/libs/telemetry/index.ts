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
import type { TelemetryCategory, TelemetryEvent, TelemetryLevel } from "./types";

export type { TelemetryEvent, TelemetryLevel, TelemetryCategory } from "./types";
export { getEvents, clearEvents, getIdentity, getPending, markPending, clearPending };

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
): TelemetryEvent {
  const event = buildEvent({ level, category, name, data });
  if (!ENABLED) return event;
  if (!withinRateLimit()) return event;

  appendEvent(event);
  notify(event);

  if (level === "error" && REPORT_ENABLED) scheduleErrorFlush();
  return event;
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

  // 本地缓冲的落盘和「是否上报」无关：切后台 / 关页面时都立即写一次，
  // 平时则由 store 里的 2s 节流合并写入。
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistOnHide();
  });
  window.addEventListener("pagehide", () => persistOnHide());

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
  getEvents,
  clearEvents: () => {
    clearEvents();
    resetReported();
  },
  getIdentity,
  getPending,
  markPending,
  clearPending,
  isDebugEnabled: () => DEBUG_ENABLED,
  isReportingActive: () => flushIntervalActive,
  stop: stopTelemetry,
};

export default telemetry;
