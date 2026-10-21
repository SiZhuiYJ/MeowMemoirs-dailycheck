/**
 * 全局埋点钩子：把「平时看不到但出问题时最想知道」的事情记下来。
 *
 * 覆盖三类排查场景：
 *  1) 页面为什么突然刷新（导航类型 / Vite 整页重载 / bfcache 恢复 / 前后台切换）
 *  2) 报的什么错、为什么报（未捕获异常、Promise 拒绝、console.error、Vue 渲染异常）
 *  3) 刷新时正在做什么（卸载时快照「进行中的操作」，例如文件上传）
 */
import { getPending, getIdentity } from "./store";
import { classifyViewport, readViewportInput } from "@/utils/device-layout";
import type { TelemetryCategory, TelemetryEvent, TelemetryLevel } from "./types";

export interface TelemetryApi {
  track(
    category: TelemetryCategory,
    name: string,
    data?: Record<string, unknown>,
    level?: TelemetryLevel,
  ): TelemetryEvent;
  captureError(source: string, error: unknown, extra?: Record<string, unknown>): TelemetryEvent;
  flush(sync?: boolean): void;
}

/** 本次页面加载是怎么来的：navigate / reload / back_forward / prerender。 */
function getNavigationType(): string {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return entry?.type ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * 设备布局分类快照。
 *
 * 刻意直接调用纯函数，而不是读 use-device-layout 的 ref：
 * 埋点在 initTelemetry() 时就会用到环境快照，那时设备布局可能还没安装，
 * 直接算一遍才能保证「真机上看到的就是当时的真实判定」。
 *
 * 用途：手机上打开 /debug/telemetry，能看到这台设备被判成了 mobile 还是 desktop、
 * 是横屏还是竖屏、有没有被识别成手机 —— 排查适配问题不用再靠猜。
 */
function deviceSnapshot() {
  try {
    const layout = classifyViewport(readViewportInput());
    return {
      layout: layout.layout,
      orientation: layout.orientation,
      isPhone: layout.isPhone,
      isPhonePortrait: layout.isPhonePortrait,
      isPhoneLandscape: layout.isPhoneLandscape,
      isShortViewport: layout.isShortViewport,
      isSmallWindow: layout.isSmallWindow,
      isTouch: layout.isTouch,
      aspectRatio: Number(layout.aspectRatio.toFixed(3)),
      shortSide: layout.shortSide,
      longSide: layout.longSide,
      visualHeight: layout.visualHeight,
      keyboardOpen: layout.isKeyboardOpen,
    };
  } catch {
    return undefined;
  }
}

function envSnapshot() {
  return {
    url: (() => { try { return window.location.href; } catch { return ""; } })(),
    referrer: (() => { try { return document.referrer; } catch { return ""; } })(),
    visibility: (() => { try { return document.visibilityState; } catch { return "unknown"; } })(),
    online: (() => { try { return navigator.onLine; } catch { return true; } })(),
    viewport: (() => { try { return `${window.innerWidth}x${window.innerHeight}`; } catch { return ""; } })(),
    // 视口尺寸之外，一并记录「按宽度 + 宽高比判定成了什么」
    device: deviceSnapshot(),
    dpr: (() => { try { return window.devicePixelRatio; } catch { return 0; } })(),
    ua: (() => { try { return navigator.userAgent; } catch { return ""; } })(),
  };
}

/** 卸载前把「正在进行的操作」一起记下来，用于解释「回来之后东西没了」。 */
function pendingSnapshot() {
  const pending = getPending();
  if (pending.length === 0) return undefined;
  return {
    pendingCount: pending.length,
    pending: pending.map((op) => ({
      label: op.label,
      runningMs: Date.now() - op.startedAt,
      ...op.meta,
    })),
  };
}

export function installInstrumentation(api: TelemetryApi) {
  const { track, captureError, flush } = api;
  const identity = getIdentity();

  // —— 1. 页面加载（loadCount > 1 说明本标签页发生过刷新）——
  track("app", "page-load", {
    navigationType: getNavigationType(),
    loadCount: identity.loadCount,
    ...envSnapshot(),
  }, identity.loadCount > 1 ? "warn" : "info");

  // —— 2. 未捕获脚本错误（含资源加载失败）——
  window.addEventListener("error", (event: ErrorEvent) => {
    const target = event.target as HTMLElement | null;
    // 资源加载失败（img/script/link）不会冒泡成 ErrorEvent.message
    if (!event.message && target && target !== (window as unknown as EventTarget)) {
      track("error", "resource-load-failed", {
        tag: target.tagName,
        url: (target as HTMLImageElement).src || (target as HTMLAnchorElement).href || "",
      }, "warn");
      return;
    }
    captureError("window.error", event.error ?? event.message, {
      file: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  }, true);

  // —— 3. 未处理的 Promise 拒绝 ——
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    captureError("unhandledrejection", event.reason);
  });

  // —— 4. console.error / console.warn（很多库只打日志不抛异常）——
  const rawError = console.error.bind(console);
  const rawWarn = console.warn.bind(console);
  let consoleHooked = false;
  if (!consoleHooked) {
    consoleHooked = true;
    console.error = (...args: unknown[]) => {
      try {
        const first = args[0];
        const message = first instanceof Error ? first.message : String(first ?? "");
        // 避免把埋点自身、通知组件、以及 main.ts 里已经单独采集过的全局兜底 handler 再记一遍
        if (!/telemetry|NotificationSystem instance|^Vue 渲染异常|^未处理 Promise 异常|^全局脚本错误/.test(message)) {
          captureError("console.error", first instanceof Error ? first : message, {
            args: args.slice(1).length ? args.slice(1) : undefined,
          });
        }
      } catch { /* 埋点自身绝不能再抛错 */ }
      rawError(...args);
    };
    console.warn = (...args: unknown[]) => {
      try {
        const first = args[0];
        const message = first instanceof Error ? first.message : String(first ?? "");
        if (!/telemetry|NotificationSystem instance|^路由错误/.test(message)) {
          track("console", "console.warn", {
            message,
            args: args.slice(1).length ? args.slice(1) : undefined,
          }, "warn");
        }
      } catch { /* ignore */ }
      rawWarn(...args);
    };
  }

  // —— 5. 卸载/隐藏：记录当时在做什么，并同步上报 ——
  window.addEventListener("pagehide", (event: PageTransitionEvent) => {
    track("app", "page-hide", {
      persisted: event.persisted,
      ...pendingSnapshot(),
    }, "info");
    flush(true);
  });

  window.addEventListener("beforeunload", () => {
    track("app", "before-unload", pendingSnapshot(), "debug");
    flush(true);
  });

  // —— 6. bfcache 恢复：看起来像「页面自己刷新了」，实际是浏览器恢复 ——
  window.addEventListener("pageshow", (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    track("app", "page-show-bfcache", { ...pendingSnapshot() }, "warn");
  });

  // —— 7. 前后台切换（手机上选文件会把页面切到后台）——
  document.addEventListener("visibilitychange", () => {
    track("app", "visibility", {
      visibility: document.visibilityState,
      ...pendingSnapshot(),
    }, "debug");
  });

  window.addEventListener("online", () => track("app", "network-online", {}, "info"));
  window.addEventListener("offline", () => track("app", "network-offline", {}, "warn"));

  // —— 8. Vite 开发服务器整页重载：开发期「页面突然刷新」的头号原因 ——
  const hot = (import.meta as unknown as { hot?: { on?: (e: string, cb: (p: unknown) => void) => void } }).hot;
  if (hot?.on) {
    hot.on("vite:beforeFullReload", (payload) => {
      track("app", "vite-full-reload", {
        reason: "开发服务器触发了整页重载（通常是文件改动）",
        payload,
        ...pendingSnapshot(),
      }, "warn");
      flush(true);
    });
    hot.on("vite:error", (payload) => {
      captureError("vite:error", payload);
    });
  }
}
