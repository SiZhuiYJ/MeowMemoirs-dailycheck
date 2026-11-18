<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app';
import { useThemeStore } from '@/stores/theme';
import MmNavBar from '@/components/MmNavBar.vue';
import http from '@/libs/http/config';

const themeStore = useThemeStore();

/** 登录记录状态：current 当前登录 / active 在线 / logged_out 已退出 */
type LoginStatus = 'current' | 'active' | 'logged_out';
/** 记录范围：domestic 仅国内 / all 全部 */
type LoginScope = 'domestic' | 'all';
/** 分页加载模式：initial 首屏（含切 tab）/ refresh 下拉刷新 / more 触底加载更多 */
type LoadMode = 'initial' | 'refresh' | 'more';

/** 单条登录记录（字段命名与后端 DTO 的 camelCase 一致） */
interface LoginRecordItem {
  id: number;
  device?: string | null;
  platform?: string | null;
  loginType?: string | null;
  location?: string | null;
  ipMasked?: string | null;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  isp?: string | null;
  isDomestic?: boolean;
  status?: LoginStatus | null;
  loginAt?: string | null;
  logoutAt?: string | null;
}

/** GET /mm/LoginRecords 响应体 */
interface LoginRecordsResponse {
  scope?: string;
  page?: number;
  pageSize?: number;
  total?: number;
  domesticTotal?: number;
  allTotal?: number;
  items?: LoginRecordItem[];
}

/** 每页条数（与后端默认值一致） */
const PAGE_SIZE = 20;

/** 分段筛选选项 */
const scopeOptions: ReadonlyArray<{ label: string; value: LoginScope }> = [
  { label: '国内', value: 'domestic' },
  { label: '全部', value: 'all' },
];

/** 状态文案 / 胶囊样式 */
const STATUS_LABELS: Record<LoginStatus, string> = {
  current: '当前登录',
  active: '在线',
  logged_out: '已退出',
};

const STATUS_CLASSES: Record<LoginStatus, string> = {
  current: 'is-current',
  active: 'is-active',
  logged_out: 'is-logged-out',
};

/** 登录方式中文文案 */
const LOGIN_TYPE_LABELS: Record<string, string> = {
  password: '密码登录',
  'email-code': '验证码登录',
  wechat: '微信登录',
  register: '注册登录',
  'email-change': '换绑登录',
};

// —— 页面数据 ——

/** 当前筛选范围：默认「国内」 */
const scope = ref<LoginScope>('domestic');
/** 已加载的登录记录（按登录时间倒序） */
const items = ref<LoginRecordItem[]>([]);
/** 当前已加载到的页码 */
const page = ref(1);
/** 当前 scope 下的总条数 */
const total = ref(0);
/** 国内记录总数（顶部摘要用） */
const domesticTotal = ref(0);
/** 全部记录总数（顶部摘要用） */
const allTotal = ref(0);
/** 首屏 / 切换 scope 的整页加载中 */
const loading = ref(false);
/** 触底加载下一页中 */
const loadingMore = ref(false);
/** 下拉刷新中（保留旧列表，不显示骨架） */
const refreshing = ref(false);
/** 首屏加载失败（列表为空时才展示失败态） */
const error = ref(false);
/** 加载更多失败（底部展示重试） */
const loadMoreError = ref(false);
/** 是否已经完成过一次整页请求（控制摘要显示） */
const loadedOnce = ref(false);

/**
 * 请求序号：切换 scope / 重新加载时自增。
 * 旧请求返回时序号对不上就丢弃，避免慢响应覆盖新数据。
 */
let requestSeq = 0;
/** 在途请求指纹：同一 scope + 页码 + 模式只允许一个请求，防止重复触底/连点 */
const inFlightKeys = new Set<string>();
/** 首次 onShow 才拉数据，之后回到页面不重复拉（下拉刷新可手动更新） */
let firstShown = false;

/** 顶部摘要文案 */
const summaryText = computed(() => {
  if (scope.value === 'domestic') {
    return `国内登录 ${domesticTotal.value} 次`;
  }
  return `全部登录 ${allTotal.value} 次（其中国内 ${domesticTotal.value} 次）`;
});

/** 已全部加载完（用于「没有更多了」） */
const finished = computed(() => items.value.length > 0 && items.value.length >= total.value);

/** 还有下一页可加载 */
const hasMore = computed(() => items.value.length > 0 && items.value.length < total.value);

// —— 格式化小函数（不引新依赖）——

/** 补零 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * 解析后端返回的时间：约定为 UTC ISO（可能带 Z、可能不带时区）。
 * 缺时区时按 UTC 处理，避免被当成设备本地时间而偏移。
 */
function parseUtcDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  let text = String(value).trim();
  if (!text) return null;
  // MySQL 风格 "YYYY-MM-DD HH:mm:ss" → ISO 风格
  text = text.replace(' ', 'T');
  // 没有 Z / +08:00 之类时区后缀时补 Z（后端全部存 UTC）
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    text += 'Z';
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 登录时间格式化为本地 "YYYY-MM-DD HH:mm" */
function formatLoginTime(value: string | null | undefined): string {
  const date = parseUtcDate(value);
  if (!date) return '时间未知';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}

/** 归一化状态：后端异常值按「在线」兜底 */
function normalizeStatus(status: LoginStatus | null | undefined): LoginStatus {
  if (status === 'current' || status === 'logged_out') return status;
  return 'active';
}

function statusLabel(record: LoginRecordItem): string {
  return STATUS_LABELS[normalizeStatus(record.status)];
}

function statusClass(record: LoginRecordItem): string {
  return STATUS_CLASSES[normalizeStatus(record.status)];
}

/** 登录方式中文 */
function loginTypeLabel(loginType: string | null | undefined): string {
  if (!loginType) return '登录';
  return LOGIN_TYPE_LABELS[loginType] ?? '登录';
}

/** 第三行：登录方式 + 脱敏 IP */
function metaText(record: LoginRecordItem): string {
  const parts: string[] = [loginTypeLabel(record.loginType)];
  if (record.ipMasked) {
    parts.push(`IP ${record.ipMasked}`);
  }
  return parts.join(' · ');
}

// —— 数据加载 ——

/**
 * 加载指定页。
 * @param targetPage 目标页码
 * @param mode initial 首屏 / refresh 下拉刷新 / more 触底加载更多
 */
async function loadPage(targetPage: number, mode: LoadMode): Promise<void> {
  const activeScope = scope.value;
  const requestKey = `${activeScope}:${targetPage}:${mode}`;
  // 同一个请求已在途：直接忽略，避免重复翻页 / 连点重试
  if (inFlightKeys.has(requestKey)) return;
  inFlightKeys.add(requestKey);

  const seq = ++requestSeq;
  if (mode === 'more') {
    loadingMore.value = true;
    loadMoreError.value = false;
  } else if (mode === 'refresh') {
    refreshing.value = true;
    error.value = false;
  } else {
    loading.value = true;
    error.value = false;
    loadMoreError.value = false;
  }

  try {
    const res = await http.get<LoginRecordsResponse>('/mm/LoginRecords', {
      params: { page: targetPage, pageSize: PAGE_SIZE, scope: activeScope },
    });
    // 期间切换了 scope / 重新加载：丢弃过期响应
    if (seq !== requestSeq) return;

    const data: LoginRecordsResponse = res.data ?? {};
    const list = Array.isArray(data.items) ? data.items : [];
    items.value = mode === 'more' ? items.value.concat(list) : list;
    page.value = targetPage;
    total.value = Number(data.total) || 0;
    domesticTotal.value = Number(data.domesticTotal) || 0;
    allTotal.value = Number(data.allTotal) || 0;
    error.value = false;
    loadMoreError.value = false;
  } catch (err) {
    if (seq !== requestSeq) return;
    console.error('[login-records] 加载登录记录失败', err);
    if (mode === 'more') {
      loadMoreError.value = true;
    } else if (mode === 'refresh') {
      // 下拉刷新失败：保留旧列表，仅提示
      uni.showToast({ title: '刷新失败，请稍后重试', icon: 'none' });
    } else {
      error.value = true;
    }
  } finally {
    inFlightKeys.delete(requestKey);
    if (seq === requestSeq) {
      if (mode === 'more') {
        loadingMore.value = false;
      } else if (mode === 'refresh') {
        refreshing.value = false;
      } else {
        loading.value = false;
      }
      loadedOnce.value = true;
    }
  }
}

/** 切换「国内 / 全部」：重置到第 1 页重新拉取 */
function switchScope(next: LoginScope): void {
  if (next === scope.value) return;
  scope.value = next;
  // 让所有在途请求失效，并清空列表回到骨架屏
  requestSeq += 1;
  items.value = [];
  page.value = 1;
  total.value = 0;
  error.value = false;
  loadMoreError.value = false;
  loading.value = false;
  loadingMore.value = false;
  refreshing.value = false;
  void loadPage(1, 'initial');
}

/** 失败态「重试」：重新拉第 1 页 */
function retryInitial(): void {
  if (loading.value) return;
  void loadPage(1, 'initial');
}

/** 加载更多失败：重试下一页 */
function retryLoadMore(): void {
  if (loading.value || loadingMore.value || refreshing.value) return;
  if (!hasMore.value) return;
  void loadPage(page.value + 1, 'more');
}

onShow(() => {
  themeStore.updateNavBarColor();
  if (firstShown) return;
  firstShown = true;
  void loadPage(1, 'initial');
});

// 下拉刷新：重新拉第 1 页（保留旧列表，完成后收起刷新动画）
onPullDownRefresh(() => {
  if (loading.value || refreshing.value) {
    uni.stopPullDownRefresh();
    return;
  }
  void loadPage(1, 'refresh').finally(() => {
    uni.stopPullDownRefresh();
  });
});

// 触底加载下一页：加载中 / 已刷完 / 失败态都不再触发，避免无限请求
onReachBottom(() => {
  if (loading.value || loadingMore.value || refreshing.value) return;
  // 加载更多失败后不再自动重试，避免触底反复请求；由底部「点击重试」触发
  if (loadMoreError.value) return;
  if (!hasMore.value) return;
  void loadPage(page.value + 1, 'more');
});
</script>

<template>
  <view class="page-container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：page-container 顶部 padding 16px，作为内容与顶栏之间的间距 -->
    <MmNavBar title="登录记录" />

    <!-- 分组标题 + 国内 / 全部 分段筛选 -->
    <view class="list-header">
      <text class="group-title">登录记录</text>
      <view class="scope-switch">
        <view
          v-for="option in scopeOptions"
          :key="option.value"
          class="scope-option"
          :class="{ active: scope === option.value }"
          hover-class="mm-hover"
          @click="switchScope(option.value)"
        >
          <text class="scope-text">{{ option.label }}</text>
        </view>
      </view>
    </view>

    <!-- 顶部摘要计数：国内 →「国内登录 N 次」；全部 →「全部登录 N 次（其中国内 N 次）」 -->
    <text v-if="loadedOnce && !loading" class="summary">{{ summaryText }}</text>

    <!-- 加载中：2~3 行骨架 -->
    <view v-if="loading" class="page-card skeleton-list">
      <view v-for="i in 3" :key="i" class="skeleton-row">
        <view class="skeleton-line skeleton-main"></view>
        <view class="skeleton-line skeleton-sub"></view>
      </view>
    </view>

    <!-- 列表：每行 ≥44px，行间分割线 token -->
    <view v-else-if="items.length > 0" class="page-card record-list">
      <view v-for="record in items" :key="record.id" class="record-item">
        <view class="record-main">
          <text class="device">{{ record.device || '未知设备' }}</text>
          <text class="status" :class="statusClass(record)">{{ statusLabel(record) }}</text>
        </view>
        <view class="record-sub">
          <text v-if="record.isDomestic && scope === 'all'" class="domestic-badge">国内</text>
          <text class="info">{{ record.location || '未知位置' }} · {{ formatLoginTime(record.loginAt) }}</text>
        </view>
        <text class="record-meta">{{ metaText(record) }}</text>
      </view>
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="page-card state-card">
      <text class="state-title">登录记录加载失败</text>
      <text class="state-desc">请检查网络后重试</text>
      <view class="retry-btn" hover-class="mm-hover" @click="retryInitial">
        <text class="retry-text">重试</text>
      </view>
    </view>

    <!-- 空态 -->
    <view v-else class="page-card state-card">
      <text class="state-title">{{ scope === 'domestic' ? '暂无国内登录记录' : '暂无登录记录' }}</text>
      <text class="state-desc">{{
        scope === 'domestic' ? '在常用设备登录后会自动记录' : '登录成功后会自动生成记录'
      }}</text>
    </view>

    <!-- 底部加载状态：加载中 / 失败重试 / 没有更多了 -->
    <view v-if="items.length > 0" class="list-footer">
      <text v-if="loadingMore" class="footer-text">加载中…</text>
      <view v-else-if="loadMoreError" class="footer-retry" hover-class="mm-hover" @click="retryLoadMore">
        <text class="footer-text">加载失败，点击重试</text>
      </view>
      <text v-else-if="finished" class="footer-text">没有更多了</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
@use "@/styles/page-layouts.scss";

/* 分组标题行：左侧标题 + 右侧分段筛选 */
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 2px 8px;
}

/* 分组小标题：13px / 600 灰字 */
.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

/* 分段筛选：浅底胶囊，选中项用主题浅底 + 强调色（只走 token） */
.scope-switch {
  display: flex;
  align-items: center;
  padding: 2px;
  border-radius: 999px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  box-sizing: border-box;
}

.scope-option {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  box-sizing: border-box;
}

.scope-text {
  font-size: 12px;
  color: var(--text-muted);
}

.scope-option.active {
  background-color: var(--theme-color-soft);
}

.scope-option.active .scope-text {
  font-weight: 600;
  color: var(--theme-color-strong);
}

/* 摘要计数：12px 弱化 */
.summary {
  display: block;
  margin: 0 2px 8px;
  font-size: 12px;
  color: var(--text-faint);
}

/* 卡片内列表：收窄上下内边距，行高由条目撑开 */
.record-list {
  padding: 4px 16px;
}

.record-item {
  min-height: 44px;
  padding: 12px 0;
  /* 行间分割线统一走 --divider-color */
  border-bottom: 1px solid var(--divider-color);
}

.record-item:last-child {
  border-bottom: none;
  padding-bottom: 4px;
}

.record-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.device {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 状态胶囊：普通项次级底；当前登录用主题浅底强调色；在线用成功色 */
.status {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 999px;
  background-color: var(--surface-soft);
  color: var(--text-muted);
}

.status.is-current {
  color: var(--theme-color-strong);
  background-color: var(--theme-color-soft);
}

.status.is-active {
  color: var(--color-success-text);
  background-color: var(--color-success-soft);
}

.status.is-logged-out {
  color: var(--text-faint);
  background-color: var(--surface-soft);
}

.record-sub {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}

/* 「国内」小徽标：仅在「全部」范围下显示，颜色全部走 token */
.domestic-badge {
  font-size: 10px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 6px;
  color: var(--theme-color-strong);
  background-color: var(--theme-color-softer);
}

.info {
  font-size: 12px;
  color: var(--text-muted);
}

/* 第三行：登录方式 + 脱敏 IP，弱化 */
.record-meta {
  display: block;
  font-size: 12px;
  color: var(--text-faint);
}

/* 骨架屏：三条记录行占位，渐变扫光 */
.skeleton-list {
  padding: 8px 16px;
}

.skeleton-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--divider-color);
}

.skeleton-row:last-child {
  border-bottom: none;
}

.skeleton-line {
  position: relative;
  overflow: hidden;
  background-color: var(--surface-soft);
  border-radius: 6px;
}

.skeleton-line::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, var(--divider-color), transparent);
  animation: login-records-skeleton 1.5s infinite;
}

.skeleton-main {
  width: 52%;
  height: 16px;
  margin-bottom: 10px;
}

.skeleton-sub {
  width: 72%;
  height: 12px;
}

@keyframes login-records-skeleton {
  0% {
    transform: translateX(-100%);
  }

  100% {
    transform: translateX(100%);
  }
}

/* 空态 / 失败态卡片 */
.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
}

.state-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 6px;
}

.state-desc {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.retry-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 96px;
  height: 34px;
  padding: 0 20px;
  margin-top: 16px;
  border-radius: 999px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  box-sizing: border-box;
}

.retry-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-color-strong);
}

/* 底部加载状态 */
.list-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px 0 6px;
}

.footer-text {
  font-size: 12px;
  color: var(--text-faint);
}

.footer-retry {
  padding: 4px 8px;
}
</style>
