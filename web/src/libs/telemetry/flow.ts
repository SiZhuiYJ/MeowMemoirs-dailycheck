/**
 * 业务流程（flow）本地存储。
 *
 * 为什么单独存一份、而不是只靠事件列表：
 *  - 事件缓冲最多 600 条、按时间滚动，出问题时最关键的「第 1 步」可能已经被挤掉；
 *  - 流程记录按「一次操作」聚合，刷新后仍能回答「上一次上传断在哪一步」；
 *  - 页面被系统杀掉时通常来不及写事件，这里每一步都会节流落盘。
 *
 * 只做状态与持久化，不发事件（避免和 telemetry/index.ts 形成循环依赖）。
 * 事件由 index.ts 的 track() 产生，并把事件 id 回填到对应步骤上。
 */
import { createId, getIdentity, sanitizeData } from "./store";
import type {
  TelemetryFlowRecord,
  TelemetryFlowStep,
  TelemetryLevel,
} from "./types";

const FLOWS_KEY = "MM-telemetry-flows";
/** 本地最多保留多少次流程（够回看最近几次上传即可）。 */
const MAX_FLOWS = 10;
/** 单条流程最多保留多少步（超长流程丢掉最早的中间步骤，首尾仍在）。 */
const MAX_STEPS = 36;
/** 单步骤 data 的字符上限，避免把 DOM 快照写爆 localStorage。 */
const MAX_STEP_DATA_CHARS = 2400;
const MAX_FLOW_META_CHARS = 2200;
/** 落盘节流：一次上传会连续写十几个步骤，不必每一步都同步写。 */
const PERSIST_MIN_INTERVAL_MS = 400;
/** 超过这个时间还在 running 的流程视为「上次没来得及收尾」。 */
const STALE_AFTER_MS = 30 * 60 * 1000;

let flows: TelemetryFlowRecord[] = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lastPersistAt = 0;

function currentRoute(): string {
  try {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  } catch {
    return "";
  }
}

/** 截断对象：先按通用规则清洗，再保证总字符数不超标。 */
function limitData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  try {
    const sanitized = sanitizeData(data) as Record<string, unknown>;
    if (JSON.stringify(sanitized).length <= MAX_STEP_DATA_CHARS) return sanitized;
    return {
      truncated: true,
      keys: Object.keys(sanitized).slice(0, 24),
    };
  } catch {
    return { truncated: true, note: "data 无法序列化" };
  }
}

function limitMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  const limited = limitData(meta);
  if (!limited) return undefined;
  try {
    if (JSON.stringify(limited).length <= MAX_FLOW_META_CHARS) return limited;
  } catch {
    // 落到下面的兜底
  }
  return { truncated: true, keys: Object.keys(limited).slice(0, 24) };
}

function isFlowRecord(value: unknown): value is TelemetryFlowRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<TelemetryFlowRecord>;
  return typeof record.id === "string"
    && typeof record.name === "string"
    && typeof record.startedAt === "number"
    && (record.status === "running" || record.status === "done" || record.status === "aborted")
    && Array.isArray(record.steps);
}

/** 只保留最近的 MAX_FLOWS 条；running 的排后面，避免刚开始就被裁掉。 */
function prune() {
  if (flows.length <= MAX_FLOWS) return;
  flows = flows
    .slice()
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-MAX_FLOWS)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function schedulePersistFlows() {
  if (persistTimer) return;
  const wait = Math.max(0, PERSIST_MIN_INTERVAL_MS - (Date.now() - lastPersistAt));
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistFlows();
  }, wait);
}

/** 立即落盘（切后台 / 关页面时调用）。 */
export function persistFlows() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  lastPersistAt = Date.now();
  try {
    // localStorage 是多标签页共享的：先读回别的标签页写的流程，
    // 按 id 合并后再写，避免本标签页一落盘就把另一个标签页的记录覆盖掉。
    const raw = localStorage.getItem(FLOWS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const stored = Array.isArray(parsed) ? parsed.filter(isFlowRecord) : [];
    const byId = new Map<string, TelemetryFlowRecord>();
    for (const flow of stored) byId.set(flow.id, flow);
    for (const flow of flows) byId.set(flow.id, flow);
    const merged = [...byId.values()]
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(-MAX_FLOWS)
      .sort((a, b) => a.startedAt - b.startedAt);
    localStorage.setItem(FLOWS_KEY, JSON.stringify(merged));
  } catch {
    // 存储不可用 / 写满：流程只保留在内存里，不影响业务
  }
}

/** 页面启动时载入上次的流程记录，并把放了很久的 running 标记为 stale。 */
export function initFlowStore() {
  try {
    const raw = localStorage.getItem(FLOWS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    flows = Array.isArray(parsed) ? parsed.filter(isFlowRecord).slice(-MAX_FLOWS) : [];
  } catch {
    flows = [];
  }

  const now = Date.now();
  for (const flow of flows) {
    if (flow.status !== "running") continue;
    if (now - flow.updatedAt <= STALE_AFTER_MS) continue;
    flow.status = "aborted";
    flow.endReason = "stale";
    flow.durationMs = Math.max(0, flow.updatedAt - flow.startedAt);
  }

  schedulePersistFlows();
}

export function createFlow(name: string, meta?: Record<string, unknown>): TelemetryFlowRecord {
  const identity = getIdentity();
  const now = Date.now();
  const flow: TelemetryFlowRecord = {
    id: createId(),
    name,
    status: "running",
    startedAt: now,
    updatedAt: now,
    sessionId: identity.sessionId,
    pageLoadId: identity.pageLoadId,
    route: currentRoute(),
    meta: limitMeta(meta),
    steps: [],
  };
  flows.push(flow);
  prune();
  schedulePersistFlows();
  return flow;
}

export interface FlowStepContext {
  index: number;
  elapsedMs: number;
  at: number;
}

/** 在真正 track 之前先拿到「下一步的序号 / 耗时」，用于给事件挂 flow 字段。 */
export function peekFlowStep(flowId: string): FlowStepContext | null {
  const flow = getFlow(flowId);
  if (!flow || flow.status !== "running") return null;
  const lastIndex = flow.steps.length > 0 ? flow.steps[flow.steps.length - 1]!.index : -1;
  const at = Date.now();
  return {
    index: lastIndex + 1,
    elapsedMs: Math.max(0, at - flow.startedAt),
    at,
  };
}

/** 把一步写进流程记录（事件已产生时把 eventId 也带上，方便互相对照）。 */
export function recordFlowStep(
  flowId: string,
  step: string,
  level: TelemetryLevel,
  data?: Record<string, unknown>,
  eventId?: string,
  context?: FlowStepContext,
): TelemetryFlowStep | null {
  const flow = getFlow(flowId);
  if (!flow) return null;

  const at = context?.at ?? Date.now();
  const lastIndex = flow.steps.length > 0 ? flow.steps[flow.steps.length - 1]!.index : -1;
  const entry: TelemetryFlowStep = {
    step,
    index: context?.index ?? lastIndex + 1,
    at,
    elapsedMs: context?.elapsedMs ?? Math.max(0, at - flow.startedAt),
    level,
    eventId,
    data: limitData(data),
  };

  flow.steps.push(entry);
  if (flow.steps.length > MAX_STEPS) {
    flow.steps = flow.steps.slice(-MAX_STEPS);
  }
  flow.updatedAt = at;
  schedulePersistFlows();
  return entry;
}

/** 正常结束：保留耗时与结束原因。 */
export function completeFlow(flowId: string, endReason?: string): TelemetryFlowRecord | null {
  const flow = getFlow(flowId);
  if (!flow || flow.status !== "running") return flow ?? null;
  const now = Date.now();
  flow.status = "done";
  flow.updatedAt = now;
  flow.durationMs = Math.max(0, now - flow.startedAt);
  flow.endReason = endReason;
  persistFlows();
  return flow;
}

/** 中断结束：用户取消、页面被卸载、点击被拦截等。 */
export function abortFlowRecord(flowId: string, endReason: string): TelemetryFlowRecord | null {
  const flow = getFlow(flowId);
  if (!flow || flow.status !== "running") return flow ?? null;
  const now = Date.now();
  flow.status = "aborted";
  flow.updatedAt = now;
  flow.durationMs = Math.max(0, now - flow.startedAt);
  flow.endReason = endReason;
  persistFlows();
  return flow;
}

export function getFlow(flowId: string): TelemetryFlowRecord | undefined {
  return flows.find((flow) => flow.id === flowId);
}

export function getFlows(): TelemetryFlowRecord[] {
  return flows.slice();
}

/**
 * 当前标签页里仍在进行的流程。
 *
 * 只返回同一个 sessionId 的：localStorage 里可能还躺着另一个标签页正在跑的流程，
 * 本标签页既不该把它算进「未完成操作」，也不该在开始同名流程时把它收尾。
 */
export function getRunningFlows(name?: string): TelemetryFlowRecord[] {
  const sessionId = getIdentity().sessionId;
  return flows.filter((flow) => flow.status === "running"
    && flow.sessionId === sessionId
    && (!name || flow.name === name));
}

/**
 * 找出「上一次页面加载遗留下来、仍然 running」的流程。
 * 只认同一标签页会话（sessionId）：别的标签页正在跑的流程不能被这边误判为中断。
 */
export function listInterruptedFlows(
  currentPageLoadId: string,
  currentSessionId: string,
): TelemetryFlowRecord[] {
  return flows.filter((flow) => flow.status === "running"
    && flow.pageLoadId !== currentPageLoadId
    && flow.sessionId === currentSessionId);
}

export function clearFlows() {
  flows = [];
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    localStorage.removeItem(FLOWS_KEY);
  } catch {
    // ignore
  }
}
