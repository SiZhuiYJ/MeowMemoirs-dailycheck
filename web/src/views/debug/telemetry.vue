<!--
  埋点诊断页（免登录可访问：/debug/telemetry）
  目标：不用开 DevTools 也能回答「报了什么错、为什么、刷新前在干什么」。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  telemetry,
  type TelemetryEvent,
  type TelemetryFlowRecord,
  type TelemetryFlowStatus,
  type TelemetryFlowStep,
} from '@/libs/telemetry';
import { CHAT_FILE_FLOW_NAME } from '@/libs/telemetry/chatFileFlow';

type Preset = 'all' | 'trouble' | 'reload' | 'auth' | 'file' | 'flow' | 'error';

const events = ref<TelemetryEvent[]>([]);
const flows = ref<TelemetryFlowRecord[]>([]);
const keyword = ref('');
const preset = ref<Preset>('trouble');
const liveRefresh = ref(true);
const expandedId = ref<string | null>(null);
const now = ref(Date.now());
let unsubscribe: (() => void) | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

function loadFlows() {
  flows.value = telemetry.getFlows().slice().sort((a, b) => b.startedAt - a.startedAt);
}

function loadEvents() {
  // 最新在最上面，便于手机上看
  events.value = telemetry.getEvents().slice().reverse();
  loadFlows();
}

const identity = telemetry.getIdentity();

/** 上传流程只展示最近 3 次：手机上一屏能看全，老流程仍可从导出 JSON 里查。 */
const uploadFlows = computed(() => flows.value
  .filter((flow) => flow.name === CHAT_FILE_FLOW_NAME)
  .slice(0, 3));

const flowEventCount = computed(
  () => events.value.filter((event) => event.flowName === CHAT_FILE_FLOW_NAME).length,
);

/** 页面重载相关事件名。 */
const RELOAD_EVENTS = new Set([
  'page-load',
  'page-hide',
  'page-show-bfcache',
  'before-unload',
  'vite-full-reload',
  'visibility',
  'network-offline',
  'network-online',
]);

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return events.value.filter((event) => {
    if (preset.value === 'error' && event.level !== 'error') return false;
    if (preset.value === 'reload' && !(event.category === 'app' && RELOAD_EVENTS.has(event.name))) return false;
    if (preset.value === 'auth' && event.category !== 'auth' && !event.name.startsWith('http-401')) return false;
    if (preset.value === 'file' && event.category !== 'file') return false;
    if (preset.value === 'flow' && event.flowName !== CHAT_FILE_FLOW_NAME) return false;
    if (preset.value === 'trouble' && event.level !== 'error' && event.level !== 'warn') return false;
    if (!kw) return true;
    return `${event.category} ${event.name} ${event.route ?? ''} ${JSON.stringify(event.data ?? {})}`
      .toLowerCase()
      .includes(kw);
  });
});

/** 自动诊断：把「为什么」直接结论化，避免对着原始事件猜。 */
const diagnosis = computed(() => {
  const all = events.value;
  const pageLoads = all.filter((e) => e.name === 'page-load');
  const reloads = all.filter((e) => e.name === 'page-load' && e.data?.navigationType === 'reload');
  const viteReloads = all.filter((e) => e.name === 'vite-full-reload');
  const bfcache = all.filter((e) => e.name === 'page-show-bfcache');
  const forceLogout = all.filter((e) => e.name === 'auth-force-logout');
  const unauthorized = all.filter((e) => e.name === 'auth-401');
  const refreshFailed = all.filter((e) => e.name === 'auth-refresh-failed');
  const refreshSuccess = all.filter((e) => e.name === 'auth-refresh-success');
  const fileSelects = all.filter((e) => e.name === 'file-select');
  const uploadFailed = all.filter((e) => e.name === 'file-upload-failed');
  const interrupted = all.filter((e) => e.name === 'page-hide' || e.name === 'before-unload')
    .filter((e) => Number(e.data?.pendingCount ?? 0) > 0);
  const errors = all.filter((e) => e.level === 'error');

  const lines: { level: 'error' | 'warn' | 'info'; text: string }[] = [];

  if (pageLoads.length > 1) {
    lines.push({
      level: reloads.length > 1 ? 'warn' : 'info',
      text: `本会话页面被加载了 ${pageLoads.length} 次，其中 ${reloads.length} 次属于「刷新」(navigationType=reload)。`,
    });
  }
  if (viteReloads.length > 0) {
    lines.push({
      level: 'warn',
      text: `其中 ${viteReloads.length} 次是 Vite 开发服务器触发的整页重载（改动了源文件）——开发期「页面突然刷新」通常是这个原因，会让正在选/传的文件丢失。`,
    });
  }
  if (bfcache.length > 0) {
    lines.push({ level: 'info', text: `有 ${bfcache.length} 次是浏览器 bfcache 恢复页面（看起来像刷新，实际不是）。` });
  }
  if (interrupted.length > 0) {
    const detail = interrupted[0]?.data?.pending;
    lines.push({
      level: 'warn',
      text: `页面离开时有 ${interrupted.length} 次存在「未完成的操作」，例如：${JSON.stringify(detail ?? {})}。`,
    });
  }
  if (unauthorized.length > 0 || forceLogout.length > 0 || refreshFailed.length > 0) {
    lines.push({
      level: forceLogout.length > 0 ? 'error' : 'warn',
      text: `鉴权异常：401 共 ${unauthorized.length} 次，刷新成功 ${refreshSuccess.length} 次、失败 ${refreshFailed.length} 次，强制登出 ${forceLogout.length} 次。`
        + (refreshFailed.length > 0 ? ` 最近一次刷新失败原因：${refreshFailed[0]?.data?.message ?? '未知'}` : ''),
    });
  }
  if (fileSelects.length > 0) {
    lines.push({
      level: uploadFailed.length > 0 ? 'warn' : 'info',
      text: `文件流程：选择文件 ${fileSelects.length} 次，上传失败 ${uploadFailed.length} 次。`,
    });
  }
  // ——— 上传流程：把「点上传没反应」直接结论化 ———
  const latestUploadFlow = uploadFlows.value[0];
  if (latestUploadFlow) {
    const steps = latestUploadFlow.steps;
    const lastOf = (name: string) => {
      for (let i = steps.length - 1; i >= 0; i -= 1) {
        if (steps[i]?.step === name) return steps[i];
      }
      return undefined;
    };
    const pointer = lastOf('trigger-pointerdown') ?? lastOf('trigger-touchstart');
    const blocked = lastOf('trigger-blocked');
    const clickMissing = lastOf('input-click-missing');
    const inputClick = lastOf('input-click');
    const change = lastOf('file-change');
    const signal = lastOf('picker-open-signal');
    const notOpened = lastOf('picker-not-opened');
    const cancelled = lastOf('picker-cancelled');
    const done = lastOf('file-upload-done');
    const lastStep = steps[steps.length - 1];
    const settled = latestUploadFlow.status !== 'running' || now.value - latestUploadFlow.updatedAt > 1500;
    const targetData = asRecord(pointer?.data?.target);
    const blockedBy = asRecord(targetData?.blockedBy);
    const hit = asRecord(targetData?.hit);
    const hint = blockedBy
      ? `拦截元素：${elementLabel(blockedBy)}`
      : (hit ? `命中：${elementLabel(hit)}` : '');
    // 先记「没打开」，之后才收到 change：说明只是信号来得晚，不能误报成失败
    const recoveredAfterMissing = Boolean(change && notOpened && change.at > notOpened.at);

    const pointerOnInput = pointer?.data?.pointerDownOnInput;

    if (blocked) {
      lines.push({
        level: 'error',
        text: `上传按钮点击被忽略：当时按钮处于禁用 / 处理中（${String(blocked.data?.reason ?? 'unknown')}），浏览器不会唤起选择器。`,
      });
    } else if (pointerOnInput === false && blockedBy) {
      lines.push({
        level: 'error',
        text: `点击落在上传按钮的命中区内，但最上层是 ${elementLabel(blockedBy)}，file input 没接到事件 —— 上传入口被这个元素盖住了。`,
      });
    } else if (clickMissing) {
      lines.push({
        level: 'error',
        text: `点击到了上传按钮区域，但没有到达 file input —— 点击被上层元素拦截。${hint}`,
      });
    } else if (notOpened && !recoveredAfterMissing) {
      lines.push({
        level: 'error',
        text: `input 的 click 已触发，但浏览器没有唤起文件选择器：5s 内没有 blur / visibilitychange / pagehide 信号，也没有 change。${hint}`,
      });
    } else if (inputClick && !signal && !change && settled) {
      lines.push({
        level: 'error',
        text: `input click 已触发，但既没有选择器打开信号也没有 change —— 很可能没有唤起文件管理器。${hint}`,
      });
    } else if (signal && !change && (cancelled || latestUploadFlow.status === 'aborted')) {
      lines.push({ level: 'info', text: '文件选择器已打开，但没有选到文件（用户取消）。' });
    } else if (change) {
      const count = typeof change.data?.count === 'number' ? change.data.count : 0;
      lines.push({
        level: latestUploadFlow.endReason === 'batch-error' ? 'warn' : 'info',
        text: `上传流程：拿到 ${count} 个文件；${done
          ? `消息已发出（总耗时 ${formatMs(latestUploadFlow.durationMs ?? 0)}）`
          : `最后一步：${lastStep ? flowStepLabel(lastStep) : '未知'}`}。`,
      });
    } else if (latestUploadFlow.status === 'running') {
      lines.push({
        level: 'info',
        text: `上传流程进行中，最后一步：${lastStep ? flowStepLabel(lastStep) : '未知'}（${flowDuration(latestUploadFlow)}）。`,
      });
    }

    if (lastOf('component-unmounted')) {
      lines.push({
        level: 'warn',
        text: '上传流程在组件卸载时还没结束（例如点击落到了别的按钮触发跳转、或切换了会话），本次流程按「中断」处理。',
      });
    }
    if (latestUploadFlow.status === 'aborted' && latestUploadFlow.endReason) {
      lines.push({ level: 'warn', text: `最近一次上传流程中断，原因：${flowEndReasonText(latestUploadFlow.endReason)}（${latestUploadFlow.endReason}）。` });
    }
    if (latestUploadFlow.status === 'running' && now.value - latestUploadFlow.updatedAt > 30000) {
      lines.push({
        level: 'warn',
        text: `上传流程已经 ${formatMs(now.value - latestUploadFlow.updatedAt)} 没有新步骤，可能卡在等待选择器 / 上传，或被系统挂起。`,
      });
    }
  }

  const interruptedUploadFlow = flows.value.find(
    (flow) => flow.name === CHAT_FILE_FLOW_NAME && flow.endReason === 'page-reload-or-close',
  );
  if (interruptedUploadFlow) {
    const last = interruptedUploadFlow.steps[interruptedUploadFlow.steps.length - 1];
    lines.push({
      level: 'error',
      text: `有上传流程被页面重载 / 关闭打断（最后一步：${last ? flowStepLabel(last) : '未知'}，${flowDuration(interruptedUploadFlow)}）。选择器打开时页面被系统回收也会表现成这样。`,
    });
  }

  if (errors.length > 0) {
    lines.push({ level: 'error', text: `共捕获 ${errors.length} 条错误，最近一条：${errors[0]?.name} — ${errors[0]?.data?.message ?? ''}` });
  }
  if (lines.length === 0) {
    lines.push({ level: 'info', text: '暂未发现异常。复现问题后回到本页刷新即可看到新事件。' });
  }
  return lines;
});

function timeText(t: number) {
  const d = new Date(t);
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function summary(event: TelemetryEvent) {
  const data = event.data ?? {};
  const parts: string[] = [];
  if (data.message) parts.push(String(data.message));
  if (data.url) parts.push(String(data.url));
  if (data.status) parts.push(`HTTP ${data.status}`);
  if (data.reason) parts.push(String(data.reason));
  if (data.fileName) parts.push(String(data.fileName));
  if (data.navigationType) parts.push(`nav=${data.navigationType}`);
  if (data.pendingCount) parts.push(`未完成操作:${data.pendingCount}`);
  return parts.join(' · ') || JSON.stringify(data).slice(0, 120);
}


/** 流程步骤的中文说明：诊断页是给人看的，原始 step 名只作为兜底。 */
const FLOW_STEP_LABELS: Record<string, string> = {
  'flow-start': '流程开始',
  'trigger-pointerdown': 'pointerdown 到达按钮',
  'trigger-touchstart': 'touchstart 到达按钮',
  'trigger-click': 'click 到达按钮',
  'trigger-click-blocked': 'click 被其他元素接住',
  'pointerdown-prevented': 'pointerdown 被 preventDefault',
  'touchstart-prevented': 'touchstart 被 preventDefault',
  'trigger-blocked': '按钮禁用，点击被忽略',
  'input-click-missing': 'click 没有到达 input',
  'input-focus': 'input 获得焦点',
  'input-click': 'input click 已触发',
  'file-picker-open': '等待选择器',
  'picker-open-signal': '选择器已打开（失焦信号）',
  'picker-open-unconfirmed': '未捕获信号，但页面已失焦',
  'picker-signal-missing': '未收到打开信号',
  'picker-not-opened': '判定：选择器未打开',
  'picker-return': '选择器返回页面',
  'picker-cancelled': '用户取消选择',
  'picker-timeout': '选择器超时未返回',
  'file-change': 'change：拿到文件',
  'file-select': '开始处理文件',
  'file-prepare-start': '预处理开始',
  'file-prepare-done': '预处理完成',
  'file-prepare-failed': '预处理失败',
  'file-busy-queued': '按钮忙，文件先暂存',
  'files-delivered': '文件交给发送逻辑',
  'file-batch-accepted': '上传批次开始',
  'file-upload-start': '上传开始',
  'file-upload-progress': '上传进度里程碑',
  'file-thumbnail-ready': '缩略图就绪',
  'file-upload-response': '上传完成（拿到 fileKey）',
  'file-message-sending': '发送消息',
  'file-upload-done': '消息已发出',
  'file-upload-failed': '上传 / 发送失败',
  'file-upload-batch-done': '批次结束',
  'file-upload-batch-failed': '批次异常',
  'file-pending-resend': '暂存文件补发',
  'file-pending-dropped': '暂存文件作废',
  'component-unmounted': '组件卸载',
  'page-hidden': '页面切到后台',
  'page-hide': '页面卸载',
  'flow-complete': '流程结束',
  'flow-aborted': '流程中断',
  'flow-interrupted': '上次流程被打断',
};

function formatMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${Math.round(seconds % 60)}s`;
}

function flowStatusText(status: TelemetryFlowStatus): string {
  if (status === 'running') return '进行中';
  if (status === 'done') return '已完成';
  return '已中断';
}

function flowDuration(flow: TelemetryFlowRecord): string {
  const ms = flow.status === 'running'
    ? Math.max(0, now.value - flow.startedAt)
    : (flow.durationMs ?? 0);
  return formatMs(ms);
}

function flowMetaLine(flow: TelemetryFlowRecord): string {
  const meta = flow.meta ?? {};
  const parts: string[] = [];
  if (meta.source) parts.push(`来源 ${String(meta.source)}`);
  if (meta.browser) parts.push(String(meta.browser));
  if (typeof meta.isAndroidChrome === 'boolean') parts.push(`AndroidChrome=${meta.isAndroidChrome}`);
  if (typeof meta.isMobileChrome === 'boolean') parts.push(`MobileChrome=${meta.isMobileChrome}`);
  if (meta.mobile === true) parts.push('UA=mobile');
  if (flow.route) parts.push(flow.route);
  return parts.join(' · ');
}


/** 结束原因的中文说明（原始值在导出 JSON 里仍保留）。 */
function flowEndReasonText(reason: string | null | undefined): string {
  if (!reason) return '';
  const labels: Record<string, string> = {
    'flow-complete': '完成',
    'picker-cancelled': '用户取消',
    'picker-not-opened': '选择器未打开',
    'input-click-missing': '点击被拦截',
    'input-disabled': '按钮禁用',
    'component-unmounted': '组件卸载',
    'page-reload-or-close': '页面重载 / 关闭',
    'superseded': '被新的点击取代',
    'no-valid-files': '没有可上传文件',
    'deliver-failed': '交付失败',
    'prepare-failed': '预处理失败',
    'batch-error': '批次异常',
    'conversation-changed': '会话已切换',
    'no-conversation': '未选择会话',
    'no-send-handler': '发送处理器缺失',
    'stale': '超时未收尾',
  };
  return labels[reason] ?? reason;
}

function flowStepLabel(step: TelemetryFlowStep): string {
  return FLOW_STEP_LABELS[step.step] ?? step.step;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function elementLabel(value: Record<string, unknown>): string {
  const tag = typeof value.tag === 'string' ? value.tag : 'node';
  const id = typeof value.id === 'string' && value.id ? `#${value.id}` : '';
  const cls = typeof value.cls === 'string' && value.cls
    ? `.${value.cls.trim().split(/\s+/).slice(0, 2).join('.')}`
    : '';
  const text = typeof value.text === 'string' && value.text ? `“${value.text}”` : '';
  return `${tag}${id}${cls}${text}`;
}

/** 一步的「人事话」摘要：优先把能解释问题的字段放前面。 */
function flowStepSummary(step: TelemetryFlowStep): string {
  const data = step.data ?? {};
  const parts: string[] = [];

  if (typeof data.signal === 'string') parts.push(`signal=${data.signal}`);
  if (typeof data.sinceClickMs === 'number') parts.push(`距 click ${formatMs(data.sinceClickMs)}`);
  if (typeof data.pickerWasSignaled === 'boolean') parts.push(`pickerSignal=${data.pickerWasSignaled}`);
  if (typeof data.count === 'number') parts.push(`${data.count} 个文件`);
  if (typeof data.fileName === 'string') parts.push(data.fileName);
  if (typeof data.progress === 'number') parts.push(`${data.progress}%`);
  if (typeof data.uploadMs === 'number') parts.push(`上传 ${formatMs(data.uploadMs)}`);
  if (typeof data.sendMs === 'number') parts.push(`发送 ${formatMs(data.sendMs)}`);
  if (typeof data.durationMs === 'number') parts.push(`耗时 ${formatMs(data.durationMs)}`);
  if (typeof data.reason === 'string') parts.push(`原因 ${data.reason}`);
  if (typeof data.message === 'string') parts.push(data.message.slice(0, 80));

  const target = asRecord(data.target);
  if (target) {
    const hit = asRecord(target.hit);
    if (hit) parts.push(`命中 ${elementLabel(hit)}`);
    const blockedBy = asRecord(target.blockedBy);
    if (blockedBy) parts.push(`被 ${elementLabel(blockedBy)} 挡住`);
    const input = asRecord(target.input);
    if (input?.disabled === true) parts.push('input.disabled=true');
    const blockers = target.blockers;
    if (Array.isArray(blockers) && blockers.length > 0) {
      parts.push(`祖先阻断 ${blockers.slice(0, 2).map(String).join(', ')}`);
    }
  }

  if (typeof data.note === 'string') parts.push(data.note.slice(0, 90));

  return parts.slice(0, 5).join(' · ') || '—';
}

const counts = computed(() => {
  const all = events.value;
  return {
    total: all.length,
    error: all.filter((e) => e.level === 'error').length,
    warn: all.filter((e) => e.level === 'warn').length,
    auth: all.filter((e) => e.category === 'auth' || e.name.startsWith('http-401')).length,
    file: all.filter((e) => e.category === 'file').length,
  };
});

const agoText = computed(() => {
  const diff = Math.max(0, now.value - (events.value[0]?.t ?? now.value));
  if (diff < 1000) return '刚刚';
  if (diff < 60000) return `${Math.round(diff / 1000)} 秒前`;
  return `${Math.round(diff / 60000)} 分钟前`;
});

async function copyAll() {
  const text = telemetry.exportJson();
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制全部埋点数据');
  } catch {
    // 手机浏览器/非 https 下 clipboard 可能不可用，退化为下载
    download();
    ElMessage.warning('剪贴板不可用，已改为下载文件');
  }
}

function downloadText(text: string, fileName: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function download() {
  downloadText(
    telemetry.exportJson(),
    `telemetry-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
}

/** 复制最近几次上传流程：手机上没有 DevTools 时直接发给别人看。 */
async function copyFlows() {
  const text = JSON.stringify(uploadFlows.value, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制上传流程');
  } catch {
    downloadText(text, `chat-upload-flows-${Date.now()}.json`);
    ElMessage.warning('剪贴板不可用，已改为下载文件');
  }
}

function reportNow() {
  telemetry.flush();
  ElMessage.success('已提交到服务端（errorLog/client/）');
}

function clearAll() {
  telemetry.clearEvents();
  telemetry.clearFlows();
  loadEvents();
  ElMessage.success('已清空本地埋点与上传流程');
}

function goBack() {
  window.history.length > 1 ? window.history.back() : (window.location.href = '/home');
}

onMounted(() => {
  loadEvents();
  unsubscribe = telemetry.subscribe(() => {
    if (liveRefresh.value) loadEvents();
  });
  tickTimer = setInterval(() => {
    now.value = Date.now();
    // 流程状态在 finish/abort 时才落定，定时补一次，避免界面停留在「进行中」
    loadFlows();
  }, 1000);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  if (tickTimer) clearInterval(tickTimer);
});
</script>

<template>
  <div class="telemetry-page">
    <header class="bar">
      <button class="btn" type="button" @click="goBack">← 返回</button>
      <strong class="title">埋点诊断</strong>
      <button class="btn" type="button" @click="loadEvents">刷新</button>
    </header>

    <section class="meta">
      <span>会话 {{ identity.sessionId.slice(0, 6) }}</span>
      <span>第 {{ identity.loadCount }} 次页面加载</span>
      <span>共 {{ counts.total }} 条</span>
      <span class="muted">{{ agoText }}</span>
    </section>

    <section class="diagnosis">
      <div class="section-title">自动诊断</div>
      <div v-for="(line, index) in diagnosis" :key="index" class="diag-line" :class="line.level">
        {{ line.text }}
      </div>
    </section>

    <section class="flows">
      <div class="flows-head">
        <div class="section-title">上传流程（点击 → 消息发出）</div>
        <button class="btn tiny" type="button" @click="copyFlows">复制流程</button>
      </div>
      <div v-if="uploadFlows.length === 0" class="empty">
        还没有上传流程记录。在聊天页点一下上传按钮，再回到这里。
      </div>
      <article v-for="flow in uploadFlows" :key="flow.id" class="flow" :class="flow.status">
        <div class="flow-head">
          <span class="flow-status" :class="flow.status">{{ flowStatusText(flow.status) }}</span>
          <span class="flow-duration">{{ flowDuration(flow) }}</span>
          <span class="flow-id">#{{ flow.id.slice(-4) }}</span>
          <span class="flow-time">{{ timeText(flow.startedAt) }}</span>
        </div>
        <div class="flow-meta">
          <span>{{ flowMetaLine(flow) }}</span>
          <span>{{ flow.steps.length }} 步</span>
          <span v-if="flow.endReason">结束：{{ flowEndReasonText(flow.endReason) }}</span>
        </div>
        <ol class="flow-steps">
          <li v-for="step in flow.steps" :key="step.index" :class="step.level">
            <span class="step-delta">+{{ formatMs(step.elapsedMs) }}</span>
            <span class="step-name">{{ flowStepLabel(step) }}</span>
            <span class="step-detail">{{ flowStepSummary(step) }}</span>
          </li>
        </ol>
      </article>
    </section>

    <section class="filters">
      <button v-for="item in ([
        { key: 'trouble', label: `异常(${counts.error + counts.warn})` },
        { key: 'reload', label: '页面重载' },
        { key: 'auth', label: `鉴权(${counts.auth})` },
        { key: 'file', label: `文件(${counts.file})` },
        { key: 'flow', label: `流程(${flowEventCount})` },
        { key: 'error', label: `错误(${counts.error})` },
        { key: 'all', label: '全部' },
      ] as const)" :key="item.key" class="chip" :class="{ active: preset === item.key }" type="button"
        @click="preset = item.key">
        {{ item.label }}
      </button>
    </section>

    <section class="tools">
      <input v-model="keyword" class="search" type="search" placeholder="搜索：接口地址 / 错误内容 / 事件名" />
      <label class="live">
        <input v-model="liveRefresh" type="checkbox" /> 实时
      </label>
    </section>

    <section class="actions">
      <button class="btn" type="button" @click="copyAll">复制</button>
      <button class="btn" type="button" @click="download">下载</button>
      <button class="btn" type="button" @click="reportNow">上报</button>
      <button class="btn danger" type="button" @click="clearAll">清空</button>
    </section>

    <section class="list">
      <div v-if="filtered.length === 0" class="empty">没有符合条件的事件</div>
      <article v-for="event in filtered" :key="event.id" class="event" :class="event.level"
        @click="expandedId = expandedId === event.id ? null : event.id">
        <div class="event-head">
          <span class="dot" :class="event.level"></span>
          <span class="event-time">{{ timeText(event.t) }}</span>
          <span class="event-name">{{ event.category }} · {{ event.name }}</span>
          <span v-if="event.flowStep" class="flow-badge">
            流程 {{ event.flowIndex !== undefined ? event.flowIndex + 1 : '?' }}
          </span>
        </div>
        <div class="event-summary">{{ summary(event) }}</div>
        <pre v-if="expandedId === event.id" class="event-json">{{ JSON.stringify({ route: event.route, flow: event.flowStep ? { id: event.flowId, name: event.flowName, step: event.flowStep, index: event.flowIndex, elapsedMs: event.flowElapsedMs } : undefined, data: event.data, stack: event.stack }, null, 2) }}</pre>
      </article>
    </section>
  </div>
</template>

<style scoped lang="scss">
.telemetry-page {
  // 诊断页是独立页面，没有套 app-shell：日 / 夜两套皮肤都收敛在这里，
  // 页内规则只引用 --tp-*，不再写死 #fff / #111827 / #f6f7f9。
  --tp-bg: #f6f7f9;
  --tp-surface: #ffffff;
  --tp-surface-soft: #f9fafb;
  --tp-border: rgba(17, 24, 39, 0.12);
  --tp-border-strong: #d1d5db;
  --tp-text: #111827;
  --tp-text-secondary: #4b5563;
  --tp-muted: #6b7280;
  --tp-faint: #9ca3af;
  --tp-danger: #dc2626;
  --tp-danger-soft: #fef2f2;
  --tp-danger-text: #b91c1c;
  --tp-warn: #f59e0b;
  --tp-warn-soft: #fffbeb;
  --tp-info: #3b82f6;
  --tp-ok: #15803d;
  --tp-chip-active-bg: #111827;
  --tp-chip-active-text: #ffffff;
  --tp-code-bg: #0f172a;
  --tp-code-text: #e2e8f0;

  // 诊断页经常在手机上打开，用 --app-h 让内容随地址栏收缩。
  min-height: var(--app-h);
  // 底部让开手势条，避免最后几条日志被系统手势区压住。
  padding: 10px 10px calc(40px + var(--safe-bottom));
  color: var(--tp-text);
  font-size: 12px;
  background: var(--tp-bg);
}

// 夜间：与全局 --bg-color / --surface-soft 同一套冷灰蓝；
// 语义色提亮，保证深底上的红 / 黄 / 蓝仍然可读。
html[data-theme="dark"] .telemetry-page {
  --tp-bg: #020617;
  --tp-surface: #0f172a;
  --tp-surface-soft: #0b1220;
  --tp-border: rgba(148, 163, 184, 0.18);
  --tp-border-strong: #334155;
  --tp-text: #e5e7eb;
  --tp-text-secondary: #cbd5e1;
  --tp-muted: #9ca3af;
  --tp-faint: #94a3b8;
  --tp-danger: #f87171;
  --tp-danger-soft: #3a1518;
  --tp-danger-text: #fca5a5;
  --tp-warn: #fbbf24;
  --tp-warn-soft: #3a2a12;
  --tp-info: #60a5fa;
  --tp-ok: #4ade80;
  --tp-chip-active-bg: #e5e7eb;
  --tp-chip-active-text: #111827;
  --tp-code-bg: #020617;
  --tp-code-text: #e2e8f0;
}

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  position: sticky;
  top: 0;
  background: var(--tp-bg);
  z-index: 2;
}

.title {
  flex: 1;
  font-size: 15px;
}

.btn {
  padding: 6px 12px;
  border: 1px solid var(--tp-border);
  border-radius: 8px;
  color: var(--tp-text);
  background: var(--tp-surface);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;

  &:hover {
    border-color: var(--theme-color-muted);
    background: var(--tp-surface-soft);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-color-strong);
    outline-offset: 2px;
  }

  &.danger {
    color: var(--tp-danger-text);

    &:hover {
      border-color: var(--tp-danger);
      background: var(--tp-danger-soft);
    }
  }
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 6px 10px;
  border-radius: 8px;
  color: var(--tp-text-secondary);
  background: var(--tp-surface);
}

.muted {
  color: var(--tp-faint);
}

.section-title {
  margin-bottom: 6px;
  color: var(--tp-muted);
  font-size: 11px;
  font-weight: 600;
}

.diagnosis {
  margin-top: 10px;
  padding: 10px;
  border-radius: 8px;
  background: var(--tp-surface);
}

.diag-line {
  padding: 6px 8px;
  margin-bottom: 6px;
  border-left: 3px solid var(--tp-border-strong);
  border-radius: 4px;
  line-height: 19px;
  background: var(--tp-surface-soft);

  &.error {
    border-left-color: var(--tp-danger);
    background: var(--tp-danger-soft);
  }

  &.warn {
    border-left-color: var(--tp-warn);
    background: var(--tp-warn-soft);
  }
}


.btn.tiny {
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
}

.flows {
  margin-top: 10px;
  padding: 10px;
  border-radius: 8px;
  background: var(--tp-surface);
}

.flows-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  .section-title {
    margin-bottom: 0;
  }
}

.flow {
  margin-top: 8px;
  padding: 8px 9px;
  border: 1px solid var(--tp-border);
  border-left: 3px solid var(--tp-border-strong);
  border-radius: 8px;
  background: var(--tp-surface-soft);

  &.done {
    border-left-color: var(--tp-ok);
  }

  &.aborted {
    border-left-color: var(--tp-warn);
  }
}

.flow-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.flow-status {
  padding: 1px 6px;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 10px;
  line-height: 15px;

  &.running {
    color: var(--tp-info);
  }

  &.done {
    color: var(--tp-ok);
  }

  &.aborted {
    color: var(--tp-warn);
  }
}

.flow-duration {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.flow-id,
.flow-time {
  color: var(--tp-faint);
  font-size: 10px;
}

.flow-time {
  margin-left: auto;
}

.flow-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  margin-top: 4px;
  color: var(--tp-muted);
  font-size: 10px;
  line-height: 15px;
  word-break: break-all;
}

.flow-steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 6px;
    padding: 3px 0;
    border-top: 1px dashed var(--tp-border);
    font-size: 10.5px;
    line-height: 16px;

    &.warn .step-name {
      color: var(--tp-warn);
    }

    &.error .step-name,
    &.error .step-detail {
      color: var(--tp-danger-text);
    }

    &.debug {
      opacity: 0.82;
    }
  }
}

.step-delta {
  flex: none;
  width: 52px;
  color: var(--tp-faint);
  font-variant-numeric: tabular-nums;
}

.step-name {
  font-weight: 600;
}

.step-detail {
  flex: 1 1 100%;
  padding-left: 58px;
  color: var(--tp-text-secondary);
  word-break: break-all;
}

.flow-badge {
  margin-left: auto;
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--tp-muted);
  background: var(--tp-surface-soft);
  font-size: 9px;
  white-space: nowrap;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.chip {
  padding: 5px 10px;
  border: 1px solid var(--tp-border);
  border-radius: 999px;
  color: var(--tp-text);
  background: var(--tp-surface);
  font-size: 11px;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;

  &:hover {
    border-color: var(--theme-color-muted);
    background: var(--tp-surface-soft);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-color-strong);
    outline-offset: 2px;
  }

  &.active {
    color: var(--tp-chip-active-text);
    border-color: var(--tp-chip-active-bg);
    background: var(--tp-chip-active-bg);

    &:hover {
      border-color: var(--tp-chip-active-bg);
      background: var(--tp-chip-active-bg);
    }
  }
}

.tools {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}

.search {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid var(--tp-border);
  border-radius: 8px;
  color: var(--tp-text);
  font-size: 12px;
  background: var(--tp-surface);

  &::placeholder {
    color: var(--tp-faint);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-color-strong);
    outline-offset: 1px;
  }
}

.live {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--tp-text-secondary);
  white-space: nowrap;

  input {
    accent-color: var(--theme-color-strong);
  }
}

.actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.list {
  margin-top: 10px;
}

.empty {
  padding: 20px;
  color: var(--tp-faint);
  text-align: center;
}

.event {
  padding: 8px 10px;
  margin-bottom: 6px;
  border-left: 3px solid var(--tp-border-strong);
  border-radius: 6px;
  background: var(--tp-surface);
  cursor: pointer;

  &.warn {
    border-left-color: var(--tp-warn);
  }

  &.error {
    border-left-color: var(--tp-danger);
  }
}

.event-head {
  display: flex;
  gap: 6px;
  align-items: center;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tp-faint);

  &.warn {
    background: var(--tp-warn);
  }

  &.error {
    background: var(--tp-danger);
  }

  &.info {
    background: var(--tp-info);
  }
}

.event-time {
  color: var(--tp-muted);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}

.event-name {
  font-weight: 600;
  font-size: 11px;
}

.event-summary {
  margin-top: 3px;
  color: var(--tp-text-secondary);
  font-size: 11px;
  line-height: 17px;
  word-break: break-all;
}

.event-json {
  margin: 6px 0 0;
  padding: 8px;
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--tp-border);
  border-radius: 6px;
  background: var(--tp-code-bg);
  color: var(--tp-code-text);
  font-size: 10px;
  line-height: 16px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
