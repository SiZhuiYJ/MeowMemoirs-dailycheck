<!--
  埋点诊断页（免登录可访问：/debug/telemetry）
  目标：不用开 DevTools 也能回答「报了什么错、为什么、刷新前在干什么」。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { telemetry, type TelemetryEvent } from '@/libs/telemetry';

type Preset = 'all' | 'trouble' | 'reload' | 'auth' | 'file' | 'error';

const events = ref<TelemetryEvent[]>([]);
const keyword = ref('');
const preset = ref<Preset>('trouble');
const liveRefresh = ref(true);
const expandedId = ref<string | null>(null);
const now = ref(Date.now());
let unsubscribe: (() => void) | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

function loadEvents() {
  // 最新在最上面，便于手机上看
  events.value = telemetry.getEvents().slice().reverse();
}

const identity = telemetry.getIdentity();

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

function download() {
  const blob = new Blob([telemetry.exportJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `telemetry-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function reportNow() {
  telemetry.flush();
  ElMessage.success('已提交到服务端（errorLog/client/）');
}

function clearAll() {
  telemetry.clearEvents();
  loadEvents();
  ElMessage.success('已清空本地埋点');
}

function goBack() {
  window.history.length > 1 ? window.history.back() : (window.location.href = '/home');
}

onMounted(() => {
  loadEvents();
  unsubscribe = telemetry.subscribe(() => {
    if (liveRefresh.value) loadEvents();
  });
  tickTimer = setInterval(() => { now.value = Date.now(); }, 1000);
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

    <section class="filters">
      <button v-for="item in ([
        { key: 'trouble', label: `异常(${counts.error + counts.warn})` },
        { key: 'reload', label: '页面重载' },
        { key: 'auth', label: `鉴权(${counts.auth})` },
        { key: 'file', label: `文件(${counts.file})` },
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
        </div>
        <div class="event-summary">{{ summary(event) }}</div>
        <pre v-if="expandedId === event.id" class="event-json">{{ JSON.stringify({ route: event.route, data: event.data, stack: event.stack }, null, 2) }}</pre>
      </article>
    </section>
  </div>
</template>

<style scoped lang="scss">
.telemetry-page {
  min-height: 100vh;
  padding: 10px 10px 40px;
  color: #111827;
  font-size: 13px;
  background: #f6f7f9;
}

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  position: sticky;
  top: 0;
  background: #f6f7f9;
  z-index: 2;
}

.title {
  flex: 1;
  font-size: 16px;
}

.btn {
  padding: 6px 12px;
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  cursor: pointer;

  &.danger {
    color: #b91c1c;
  }
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 6px 10px;
  border-radius: 8px;
  color: #4b5563;
  background: #fff;
}

.muted {
  color: #9ca3af;
}

.section-title {
  margin-bottom: 6px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
}

.diagnosis {
  margin-top: 10px;
  padding: 10px;
  border-radius: 8px;
  background: #fff;
}

.diag-line {
  padding: 6px 8px;
  margin-bottom: 6px;
  border-left: 3px solid #9ca3af;
  border-radius: 4px;
  line-height: 19px;
  background: #f9fafb;

  &.error {
    border-left-color: #dc2626;
    background: #fef2f2;
  }

  &.warn {
    border-left-color: #f59e0b;
    background: #fffbeb;
  }
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.chip {
  padding: 5px 10px;
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 999px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;

  &.active {
    color: #fff;
    border-color: #111827;
    background: #111827;
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
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 8px;
  font-size: 13px;
  background: #fff;
}

.live {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: #4b5563;
  white-space: nowrap;
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
  color: #9ca3af;
  text-align: center;
}

.event {
  padding: 8px 10px;
  margin-bottom: 6px;
  border-left: 3px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;

  &.warn {
    border-left-color: #f59e0b;
  }

  &.error {
    border-left-color: #dc2626;
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
  background: #9ca3af;

  &.warn {
    background: #f59e0b;
  }

  &.error {
    background: #dc2626;
  }

  &.info {
    background: #3b82f6;
  }
}

.event-time {
  color: #6b7280;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.event-name {
  font-weight: 600;
  font-size: 12px;
}

.event-summary {
  margin-top: 3px;
  color: #4b5563;
  font-size: 12px;
  line-height: 17px;
  word-break: break-all;
}

.event-json {
  margin: 6px 0 0;
  padding: 8px;
  max-height: 320px;
  overflow: auto;
  border-radius: 6px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 11px;
  line-height: 16px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
