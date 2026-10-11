/**
 * 埋点本地存储：会话/页面加载标识、环形缓冲、进行中的操作。
 * 只用 localStorage/sessionStorage，不引入任何依赖，页面刷新后仍可回溯。
 */
import type {
  TelemetryCategory,
  TelemetryEvent,
  TelemetryLevel,
  TelemetryPendingOp,
} from "./types";

const EVENTS_KEY = "MM-telemetry-events";
const SESSION_KEY = "MM-telemetry-session";
const LOAD_KEY = "MM-telemetry-load";
/** 本地最多保留多少条（避免把 localStorage 写满）。 */
const MAX_EVENTS = 600;
const MAX_STRING = 800;
const MAX_DATA_CHARS = 3000;

let sessionId = "";
let pageLoadId = "";
let loadCount = 0;
let buffer: TelemetryEvent[] = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const pendingOps = new Map<string, TelemetryPendingOp>();

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 截断过长的字符串，防止把响应体/堆栈整个塞进存储。 */
export function truncateText(value: unknown, max = MAX_STRING): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…[已截断 ${text.length - max} 字]` : text;
}

/** 深度截断对象，保证可 JSON 序列化且体积可控。 */
export function sanitizeData(input: unknown, depth = 0): any {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return truncateText(input);
  if (typeof input === "number" || typeof input === "boolean") return input;
  if (typeof input === "function") return "[Function]";
  if (input instanceof Error) {
    return { name: input.name, message: truncateText(input.message), stack: truncateText(input.stack, 1200) };
  }
  if (depth >= 3) return truncateText(JSON.stringify(input) ?? "", 300);
  if (Array.isArray(input)) return input.slice(0, 20).map((item) => sanitizeData(item, depth + 1));
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (count >= 30) break;
      out[key] = sanitizeData(value, depth + 1);
      count += 1;
    }
    return out;
  }
  return truncateText(input);
}

/** 初始化标识与历史缓冲（每次页面加载调用一次）。 */
export function initIdentity(): { sessionId: string; pageLoadId: string; loadCount: number } {
  try {
    sessionId = sessionStorage.getItem(SESSION_KEY) || "";
    if (!sessionId) {
      sessionId = randomId();
      sessionStorage.setItem(SESSION_KEY, sessionId);
    }
  } catch {
    sessionId = randomId();
  }

  try {
    const previous = Number(localStorage.getItem(LOAD_KEY) || "0");
    loadCount = Number.isFinite(previous) ? previous + 1 : 1;
    localStorage.setItem(LOAD_KEY, String(loadCount));
  } catch {
    loadCount = 1;
  }

  pageLoadId = randomId();

  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    buffer = Array.isArray(parsed) ? (parsed as TelemetryEvent[]) : [];
  } catch {
    buffer = [];
  }
  if (buffer.length > MAX_EVENTS) buffer = buffer.slice(-MAX_EVENTS);

  return { sessionId, pageLoadId, loadCount };
}

export function getIdentity() {
  return { sessionId, pageLoadId, loadCount };
}

/** 当前路由（不依赖 router 实例，避免循环依赖）。 */
function currentRoute(): string {
  try {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  } catch {
    return "";
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 300);
}

export function persistNow() {
  try {
    // 只持久化本会话事件：多标签页共用 localStorage，避免互相覆盖对方的历史
    const ownEvents = buffer.filter((event) => event.sessionId === sessionId).slice(-MAX_EVENTS);
    localStorage.setItem(EVENTS_KEY, JSON.stringify(ownEvents));
  } catch {
    // 存储写满等情况直接放弃持久化，不影响业务
  }
}

export function buildEvent(input: {
  level: TelemetryLevel;
  category: TelemetryCategory;
  name: string;
  data?: Record<string, unknown>;
  stack?: string;
}): TelemetryEvent {
  const now = Date.now();
  const event: TelemetryEvent = {
    id: randomId(),
    ts: new Date(now).toISOString(),
    t: now,
    level: input.level,
    category: input.category,
    name: input.name,
    sessionId,
    pageLoadId,
    loadCount,
    route: currentRoute(),
    data: input.data ? sanitizeData(input.data) : undefined,
    stack: input.stack ? truncateText(input.stack, 1200) : undefined,
  };
  return event;
}

export function appendEvent(event: TelemetryEvent): TelemetryEvent {
  buffer.push(event);
  if (buffer.length > MAX_EVENTS) buffer = buffer.slice(-MAX_EVENTS);
  schedulePersist();
  return event;
}

export function getEvents(): TelemetryEvent[] {
  return buffer;
}

export function clearEvents() {
  buffer = [];
  try {
    localStorage.removeItem(EVENTS_KEY);
  } catch {
    // ignore
  }
}

/** 事件总体积保护（字符数上限）。 */
export function isDataTooLarge(data?: Record<string, unknown>): boolean {
  if (!data) return false;
  try {
    return JSON.stringify(data).length > MAX_DATA_CHARS;
  } catch {
    return true;
  }
}

// —— 进行中的操作（用于回答「刷新时正在干什么」）——

export function markPending(key: string, label: string, meta?: Record<string, unknown>) {
  pendingOps.set(key, { key, label, startedAt: Date.now(), meta: sanitizeData(meta) });
}

export function clearPending(key: string) {
  pendingOps.delete(key);
}

export function getPending(): TelemetryPendingOp[] {
  return Array.from(pendingOps.values());
}
