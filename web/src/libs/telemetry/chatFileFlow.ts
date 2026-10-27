/**
 * 聊天文件上传全流程埋点（点击 → 文件选择器 → 选文件 → 预处理 → 上传 → 消息发出）。
 *
 * 为什么单独做一条「流程」：
 * 移动端 Chrome 上「点上传没反应」的现场往往拿不到 DevTools，而且页面本身没卡死，
 * 只能靠事后诊断。普通事件是一条条散点，看不出是「点击没到 input」「input 点了但
 * 浏览器没唤起选择器」还是「选择器开了但用户取消了」。这里用同一个 flowId 把整条
 * 链路串起来，并重点记录三个关键判定：
 *
 *   1. 点击有没有落在 file input 上（命中检测 + 上层元素栈，能直接看到被谁挡住了）；
 *   2. input 的 click 有没有真的触发（isTrusted / 用户激活状态）；
 *   3. click 之后 1.5s 内有没有「选择器真的打开了」的信号
 *      （window blur / visibilitychange hidden / pagehide）。
 *      三个信号一个都没有、也没有 change，基本就是「浏览器没唤起文件管理器」。
 *
 * 这里只负责「流程语义 + 环境/元素快照」，原生事件监听在 FileUploadButton 里。
 * 所有函数都保证不抛异常：埋点绝不能影响选文件本身。
 */
import {
  isTelemetryEnabled,
  startFlow,
  telemetry,
  type TelemetryFlowHandle,
} from "./index";
import type { TelemetryLevel } from "./types";

export const CHAT_FILE_FLOW_NAME = "chat-file-upload";

/** 流程来源：原生 input / 触屏兜底 / 拖拽 / 组件重建补发。 */
export type ChatFileFlowSource =
  | "input"
  | "touch"
  | "drop"
  | "pending-resend"
  | "message-panel"
  | "unknown";

/**
 * 同一个手势可能先触发 pointerdown、再触发 touchstart / click。
 * 在这个窗口内复用已存在的流程，避免把自己刚开的流程当成「上一次」收尾。
 */
const FLOW_REUSE_WINDOW_MS = 1500;

let activeFlow: TelemetryFlowHandle | null = null;
let activeStartedAt = 0;
let activeSource: ChatFileFlowSource = "unknown";
let lifecycleInstalled = false;

function safe<T>(task: () => T): T | undefined {
  try {
    return task();
  } catch {
    return undefined;
  }
}

function safeMatchMedia(query: string): boolean {
  return safe(() => typeof window.matchMedia === "function" && window.matchMedia(query).matches) ?? false;
}

type NavigatorWithUaData = Navigator & {
  userAgentData?: {
    mobile?: boolean;
    brands?: { brand: string; version: string }[];
  };
  userActivation?: {
    isActive: boolean;
    hasBeenActive: boolean;
  };
};

/** 当前浏览器 / 设备的关键特征，用于把「移动端 Chrome」和其他内核分开看。 */
export function describeChatUploadEnv(): Record<string, unknown> {
  return safe(() => {
    const ua = navigator.userAgent || "";
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua)
      || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
    const isWebView = /;\s*wv\)/i.test(ua) || (/Version\/[\d.]+/i.test(ua) && /Chrome\//i.test(ua) && !/Edg\//i.test(ua));
    const isEdge = /Edg\//i.test(ua);
    const isOpera = /OPR\//i.test(ua);
    const isSamsung = /SamsungBrowser/i.test(ua);
    const isFirefox = /Firefox\//i.test(ua);
    const isUC = /UCBrowser/i.test(ua);
    const isQQ = /MQQBrowser/i.test(ua);
    const isWeChat = /MicroMessenger/i.test(ua);
    const isChromeIOS = /CriOS\/\d+/i.test(ua);
    const isChrome = (/Chrome\/\d+/i.test(ua) || isChromeIOS)
      && !isEdge && !isOpera && !isSamsung && !isUC && !isQQ && !isWeChat;
    const chromeMajor = Number(
      /Chrome\/(\d+)/i.exec(ua)?.[1] ?? /CriOS\/(\d+)/i.exec(ua)?.[1] ?? 0,
    ) || null;
    const uaData = (navigator as NavigatorWithUaData).userAgentData;
    const brands = uaData?.brands?.map((item) => `${item.brand}/${item.version}`).join(", ") ?? null;
    const mobile = typeof uaData?.mobile === "boolean" ? uaData.mobile : null;
    const coarsePointer = safeMatchMedia("(pointer: coarse)");
    const hoverNone = safeMatchMedia("(hover: none)");
    const standalone = safeMatchMedia("(display-mode: standalone)") || safeMatchMedia("(display-mode: fullscreen)");

    const browser = isEdge ? "edge"
      : isOpera ? "opera"
        : isSamsung ? "samsung"
          : isUC ? "uc"
            : isQQ ? "qq"
              : isWeChat ? "wechat"
                : isFirefox ? "firefox"
                  : isChrome ? "chrome"
                    : "other";

    return {
      browser,
      isChrome,
      chromeMajor,
      isAndroid,
      isAndroidChrome: isChrome && isAndroid && !isWebView,
      isChromeIOS,
      isMobileChrome: isChrome && !isWebView && (isAndroid || isIOS || mobile === true || coarsePointer),
      isIOS,
      isWebView,
      brands,
      mobile,
      ua: ua.slice(0, 260),
      platform: navigator.platform || "",
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
      coarsePointer,
      hoverNone,
      standalone,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: Number((window.devicePixelRatio || 0).toFixed(2)),
      online: navigator.onLine !== false,
      visibility: document.visibilityState,
    };
  }) ?? {};
}

/** 用户激活状态：Chrome 在「非用户手势」里会拒绝打开文件选择器。 */
export function describeUserActivation(): Record<string, unknown> | undefined {
  const activation = safe(() => (navigator as NavigatorWithUaData).userActivation);
  if (!activation) return undefined;
  return {
    isActive: activation.isActive,
    hasBeenActive: activation.hasBeenActive,
  };
}

function describeElement(element: Element | null): Record<string, unknown> | null {
  if (!element) return null;
  return safe(() => {
    const html = element as HTMLElement;
    const tag = element.tagName ? element.tagName.toLowerCase() : "";
    const className = typeof html.className === "string" ? html.className : "";
    const textTags = new Set(["button", "span", "a", "label", "i", "p", "em", "strong"]);
    return {
      tag,
      id: html.id || undefined,
      cls: className.slice(0, 140) || undefined,
      text: textTags.has(tag) ? (html.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30) || undefined : undefined,
      role: html.getAttribute("role") ?? undefined,
    };
  }) ?? null;
}

function roundRect(rect: DOMRect | null): Record<string, number> | null {
  if (!rect) return null;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.width),
    h: Math.round(rect.height),
    top: Math.round(rect.top),
    left: Math.round(rect.left),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
  };
}

function collectAncestorBlockers(input: HTMLInputElement): string[] {
  return safe(() => {
    const blockers: string[] = [];
    let element: HTMLElement | null = input;
    for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
      const tag = element.tagName ? element.tagName.toLowerCase() : "node";
      const style = getComputedStyle(element);
      if (element !== input && style.pointerEvents === "none") blockers.push(`${tag}:pointer-events:none`);
      if (style.display === "none") blockers.push(`${tag}:display:none`);
      if (style.visibility !== "visible") blockers.push(`${tag}:visibility=${style.visibility}`);
      if ((element as HTMLElement & { inert?: boolean }).inert) blockers.push(`${tag}:inert`);
    }
    return blockers;
  }) ?? [];
}

/**
 * 点击时的元素快照。
 *
 * `hit` / `stack` 是 `document.elementsFromPoint()` 的结果：如果 file input 被
 * 悬浮按钮、遮罩、弹层盖住，这里能直接看到「最上层是谁」，不用再猜。
 */
export function describeUploadTarget(
  input: HTMLInputElement | null,
  point?: { x: number; y: number },
): Record<string, unknown> {
  return safe(() => {
    const rect = input ? input.getBoundingClientRect() : null;
    let hit: Element | null = null;
    let stack: (Record<string, unknown> | null)[] = [];

    if (point && typeof document.elementsFromPoint === "function") {
      const elements = document.elementsFromPoint(point.x, point.y);
      hit = elements[0] ?? null;
      stack = elements.slice(0, 6).map(describeElement);
    } else if (point) {
      hit = document.elementFromPoint(point.x, point.y);
      stack = [describeElement(hit)];
    }

    const hitInsideInput = Boolean(input && hit && (hit === input || input.contains(hit)));
    const pointInsideInputRect = Boolean(point && rect
      && point.x >= rect.left && point.x <= rect.right
      && point.y >= rect.top && point.y <= rect.bottom);

    const style = input ? getComputedStyle(input) : null;

    return {
      point: point ? { x: Math.round(point.x), y: Math.round(point.y) } : null,
      input: input
        ? {
          rect: roundRect(rect),
          disabled: input.disabled,
          multiple: input.multiple,
          acceptLength: input.accept.length,
          filesCount: input.files?.length ?? 0,
          connected: input.isConnected,
          clientRects: input.getClientRects().length,
          hasFocus: document.activeElement === input,
          display: style?.display,
          visibility: style?.visibility,
          opacity: style?.opacity,
          pointerEvents: style?.pointerEvents,
          zIndex: style?.zIndex,
          touchAction: style?.touchAction,
        }
        : null,
      hit: describeElement(hit),
      hitInsideInput,
      pointInsideInputRect,
      blockedBy: input && point && !hitInsideInput ? describeElement(hit) : null,
      stack,
      blockers: input ? collectAncestorBlockers(input) : [],
      hasFocus: safe(() => document.hasFocus()) ?? false,
      visibility: safe(() => document.visibilityState) ?? "unknown",
    };
  }) ?? {};
}

/**
 * 页面隐藏 / 卸载时补一步：选择器打开、上传中都有可能被系统挂起或回收，
 * 这一步是「流程为什么没走完」的直接证据。
 */
function installLifecycleListeners() {
  if (lifecycleInstalled || typeof window === "undefined") return;
  lifecycleInstalled = true;

  document.addEventListener("visibilitychange", () => {
    if (!activeFlow?.isActive() || document.visibilityState !== "hidden") return;
    safe(() => {
      const stage = activeFlow?.lastStep() ?? null;
      activeFlow?.step("page-hidden", {
        stage,
        pickerPending: stage === "file-picker-open" || stage === "input-click",
        visibility: "hidden",
      }, "debug", "file");
      // 页面可能不会再回来：立即把这一步同步发出去
      telemetry.flush(true);
    });
  });

  window.addEventListener("pagehide", () => {
    if (!activeFlow?.isActive()) return;
    safe(() => {
      activeFlow?.step("page-hide", {
        stage: activeFlow?.lastStep() ?? null,
        note: "页面被关闭 / 进入 bfcache，流程尚未结束",
      }, "warn", "file");
      telemetry.flush(true);
    });
  });
}

/**
 * 开始（或在同一手势内复用）一次上传流程。
 *
 * 返回流程 id；埋点关闭、或无法创建时返回 null。
 */
export function startChatFileUploadFlow(options: {
  source?: ChatFileFlowSource;
  meta?: Record<string, unknown>;
} = {}): string | null {
  const source = options.source ?? "unknown";
  if (!isTelemetryEnabled()) return null;

  // 同一个手势的 pointerdown / touchstart / click 共用一个流程
  if (activeFlow?.isActive() && Date.now() - activeStartedAt < FLOW_REUSE_WINDOW_MS) {
    return activeFlow.id;
  }

  activeFlow?.abort("superseded", {
    source,
    note: "新的上传流程开始，旧流程没有收尾",
  });
  activeFlow = null;

  installLifecycleListeners();

  const flow = startFlow(CHAT_FILE_FLOW_NAME, {
    source,
    ...describeChatUploadEnv(),
    ...(options.meta ?? {}),
  }, "file");
  if (!flow.isActive()) return null;

  activeFlow = flow;
  activeStartedAt = Date.now();
  activeSource = source;
  return flow.id;
}

export function hasActiveChatFileUploadFlow(): boolean {
  return Boolean(activeFlow?.isActive());
}

export function getChatFileUploadFlowId(): string | null {
  return activeFlow?.isActive() ? activeFlow.id : null;
}

/**
 * 追加一步。没有活动流程时退化成普通 file 事件（例如拖拽上传路径没走到 start），
 * 保证事件不会凭空消失。
 */
export function chatFileFlowStep(
  step: string,
  data?: Record<string, unknown>,
  level: TelemetryLevel = "info",
): void {
  safe(() => {
    if (activeFlow?.isActive()) {
      activeFlow.step(step, data, level, "file");
      return;
    }
    if (isTelemetryEnabled()) {
      telemetry.track("file", step, data, level);
    }
  });
}

/** 正常结束：例如所有文件都变成了真实消息。 */
export function finishChatFileUploadFlow(
  data?: Record<string, unknown>,
  level: TelemetryLevel = "info",
): void {
  safe(() => {
    if (!activeFlow?.isActive()) return;
    activeFlow.finish("flow-complete", {
      ...(data ?? {}),
      source: activeSource,
    }, level, "file");
    activeFlow = null;
  });
}

/** 中断结束：点击被拦截、选择器没打开、用户取消、上传失败等。 */
export function abortChatFileUploadFlow(
  reason: string,
  data?: Record<string, unknown>,
  level: TelemetryLevel = "warn",
): void {
  safe(() => {
    if (!activeFlow?.isActive()) return;
    activeFlow.abort(reason, {
      ...(data ?? {}),
      source: activeSource,
    }, level, "file");
    activeFlow = null;
  });
}
