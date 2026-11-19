<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { useThemeStore } from '@/stores/theme';
import MmNavBar from '@/components/MmNavBar.vue';
import http from '@/libs/http/config';

const themeStore = useThemeStore();

/** 一个更新分组（如「新增」「修复」），items 为纯文本条目 */
interface ChangelogSection {
  title: string;
  items: string[];
}

/** 单个版本（字段命名与后端 DTO 的 camelCase 一致，date 已是 YYYY-MM-DD 字符串） */
interface ChangelogItem {
  version: string;
  date: string;
  /** 可能为空数组（该版本没有分组内容） */
  sections: ChangelogSection[];
}

/** GET /mm/Changelog 响应体：items 按日期倒序，latest 是最新一条（文件缺失时为 null） */
interface ChangelogResponse {
  latestVersion?: string | null;
  latestDate?: string | null;
  total?: number;
  items?: ChangelogItem[];
}

/** 每次拉取的版本条数（与后端默认值一致） */
const LIMIT = 20;

// —— 页面数据 ——

/** 版本列表（按日期倒序，日期字符串直接展示，不转时区） */
const items = ref<ChangelogItem[]>([]);
/** 最新版本号（可能为 null） */
const latestVersion = ref<string | null>(null);
/** 最新版本日期（YYYY-MM-DD，可能为 null） */
const latestDate = ref<string | null>(null);
/** 版本总数（可能大于已拉取的条数） */
const total = ref(0);
/** 首屏 / 重试的整页加载中（展示骨架屏） */
const loading = ref(false);
/** 首屏加载失败（列表为空时才展示失败态） */
const error = ref(false);
/** 下拉刷新中（保留旧列表，不显示骨架） */
const refreshing = ref(false);
/** 是否已经完成过一次请求（控制摘要显示） */
const loadedOnce = ref(false);

/**
 * 请求序号：重新加载时自增。
 * 旧请求返回时序号对不上就丢弃，避免慢响应覆盖新数据。
 */
let requestSeq = 0;
/** 首次 onShow 才拉数据，之后回到页面不重复拉（下拉刷新可手动更新） */
let firstShown = false;

// —— 内容折叠（每个版本最多 3 行，最新版本默认展开）——

/**
 * 折叠高度（px）：正文条目 13px / 行高 1.65，3 行约 65px。
 * 必须与样式里 `.log-body.is-collapsed` 的 max-height 保持一致。
 */
const COLLAPSED_BODY_HEIGHT = 65;

/** 每个版本的内容是否超过 3 行（SelectorQuery 测量得到；未测量 / 不溢出为 false） */
const bodyOverflowing = ref<Record<number, boolean>>({});
/** 用户显式切换过的折叠状态；未记录时按「最新展开、其余折叠」的默认值 */
const bodyCollapsedState = ref<Record<number, boolean>>({});
/** 是否已完成过至少一次内容高度测量（测量前先按折叠态渲染，避免长内容整段闪出） */
const bodyMeasured = ref(false);

/** 内容是否超过 3 行（只有溢出的版本才显示「展开 / 收起」） */
function isBodyOverflowing(index: number): boolean {
  return bodyOverflowing.value[index] === true;
}

/**
 * 当前是否处于折叠态：
 * 默认「最新版本（下标 0）展开、其余版本折叠」，用户点击后以显式状态优先；
 * 首次测量完成前先按默认折叠态渲染，避免长内容先完整闪出再收起。
 */
function isBodyCollapsed(index: number): boolean {
  if (!isBodyOverflowing(index)) {
    return !bodyMeasured.value && index !== 0;
  }

  const explicit = bodyCollapsedState.value[index];
  return explicit ?? index !== 0;
}

/** 展开 / 收起某个版本的内容 */
function toggleBody(index: number): void {
  bodyCollapsedState.value = {
    ...bodyCollapsedState.value,
    [index]: !isBodyCollapsed(index),
  };
}

/** 测量定时器（等数据渲染完再量，避免量到骨架屏或旧内容） */
let measureTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 测量每个版本内容的真实高度，更新「是否溢出」状态。
 * 小程序读不到 scrollHeight，用 SelectorQuery 取内层 `.log-body-inner` 的
 * boundingClientRect 高度；外层折叠容器只限制视觉高度，内层仍按完整内容布局。
 */
function measureBodyOverflow(): void {
  if (measureTimer) clearTimeout(measureTimer);
  void nextTick(() => {
    measureTimer = setTimeout(() => {
      measureTimer = null;
      if (loading.value || items.value.length === 0) return;

      uni
        .createSelectorQuery()
        .selectAll('.log-body-inner')
        .boundingClientRect((rects) => {
          const list = (Array.isArray(rects) ? rects : rects ? [rects] : []) as Array<{
            id?: string;
            height?: number;
          }>;

          const nextOverflow: Record<number, boolean> = {};
          list.forEach((rect) => {
            // 下标从 id 反解，避免某个版本没有内容时 DOM 顺序与 items 下标错位
            const rawId = String(rect.id ?? '');
            const idPrefix = 'log-body-inner-';
            if (!rawId.startsWith(idPrefix)) return;

            const index = Number(rawId.slice(idPrefix.length));
            if (Number.isInteger(index) && index >= 0) {
              nextOverflow[index] = (rect.height ?? 0) > COLLAPSED_BODY_HEIGHT + 1;
            }
          });

          bodyOverflowing.value = nextOverflow;
          bodyMeasured.value = true;

          // 数据刷新后条目变少：清掉不再存在的版本的显式折叠状态
          const validIndexes = new Set(Object.keys(nextOverflow).map(Number));
          bodyCollapsedState.value = Object.fromEntries(
            Object.entries(bodyCollapsedState.value).filter(([key]) =>
              validIndexes.has(Number(key)),
            ),
          );
        })
        .exec();
    }, 60);
  });
}

onUnmounted(() => {
  if (measureTimer) {
    clearTimeout(measureTimer);
    measureTimer = null;
  }
});

/** 版本号展示：后端返回不带 v（如 1.2.0），统一补 v；已带 v 的保持不变 */
function versionLabel(version: string | null | undefined): string {
  const text = (version ?? '').trim();
  if (!text) return '';
  return /^v/i.test(text) ? text : `v${text}`;
}

/** 顶部摘要：共 N 个版本 · 最新 v1.2.0（拿不到版本号时退化为最新日期） */
const summaryText = computed(() => {
  const parts: string[] = [`共 ${total.value} 个版本`];
  if (latestVersion.value) {
    parts.push(`最新 ${versionLabel(latestVersion.value)}`);
  } else if (latestDate.value) {
    parts.push(`最新发布 ${latestDate.value}`);
  }
  return parts.join(' · ');
});

// —— 数据加载 ——

/**
 * 拉取更新日志。
 * @param mode initial 首屏 / 重试；refresh 下拉刷新（保留旧列表）
 */
async function loadChangelog(mode: 'initial' | 'refresh'): Promise<void> {
  const seq = ++requestSeq;
  if (mode === 'refresh') {
    refreshing.value = true;
  } else {
    loading.value = true;
  }
  error.value = false;

  try {
    const res = await http.get<ChangelogResponse>('/mm/Changelog', {
      params: { limit: LIMIT },
    });
    // 期间又发起了新请求：丢弃过期响应
    if (seq !== requestSeq) return;

    const data: ChangelogResponse = res.data ?? {};
    const list = Array.isArray(data.items) ? data.items : [];
    items.value = list;
    total.value = Number(data.total) || list.length;
    latestVersion.value =
      typeof data.latestVersion === 'string' && data.latestVersion ? data.latestVersion : null;
    latestDate.value = typeof data.latestDate === 'string' && data.latestDate ? data.latestDate : null;
    error.value = false;
    // 新数据：回到默认「最新展开、其余折叠」，并等待重新测量
    bodyCollapsedState.value = {};
    bodyOverflowing.value = {};
    bodyMeasured.value = false;
  } catch (err) {
    if (seq !== requestSeq) return;
    console.error('[changelog] 加载更新日志失败', err);
    if (mode === 'refresh') {
      // 下拉刷新失败：有旧列表就保留并只 toast；没有数据时回退到失败态
      if (items.value.length > 0) {
        uni.showToast({ title: '刷新失败，请稍后重试', icon: 'none' });
      } else {
        error.value = true;
      }
    } else {
      error.value = true;
    }
  } finally {
    if (seq === requestSeq) {
      if (mode === 'refresh') {
        refreshing.value = false;
      } else {
        loading.value = false;
      }
      loadedOnce.value = true;
    }
  }

  // 数据渲染完成后再按真实高度判断哪些版本需要折叠（失败时保留旧内容，不重测）
  if (seq === requestSeq && !error.value) {
    measureBodyOverflow();
  }
}

/** 失败态「重试」：重新整页拉取 */
function retryInitial(): void {
  if (loading.value) return;
  void loadChangelog('initial');
}

onShow(() => {
  themeStore.updateNavBarColor();
  if (firstShown) return;
  firstShown = true;
  void loadChangelog('initial');
});

// 下拉刷新：重新拉取（保留旧列表，完成后收起刷新动画）
onPullDownRefresh(() => {
  if (loading.value || refreshing.value) {
    uni.stopPullDownRefresh();
    return;
  }
  void loadChangelog('refresh').finally(() => {
    uni.stopPullDownRefresh();
  });
});
</script>

<template>
  <view class="page-container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：page-container 顶部 padding 16px，作为内容与顶栏之间的间距 -->
    <MmNavBar title="更新日志" />
    <!-- 分组小标题：13px 灰色，与全站设置页一致 -->
    <text class="group-title">更新日志</text>

    <!-- 顶部摘要：版本总数 + 最新版本（加载中 / 失败 / 空列表时不显示） -->
    <text
      v-if="loadedOnce && !loading && !error && items.length > 0"
      class="summary"
    >{{ summaryText }}</text>

    <!-- 加载中：三条版本骨架，用 --surface-soft 占位 -->
    <view v-if="loading" class="page-card skeleton-list">
      <view v-for="i in 3" :key="i" class="skeleton-row">
        <view class="skeleton-line skeleton-main"></view>
        <view class="skeleton-line skeleton-sub"></view>
        <view class="skeleton-line skeleton-sub short"></view>
      </view>
    </view>

    <!-- 版本列表：一个版本一张卡片（与 Web 端一致），不再把所有版本合并在同一张卡片里 -->
    <view v-else-if="items.length > 0" class="log-list">
      <view
        v-for="(log, index) in items"
        :key="`${log.version}-${log.date}`"
        class="page-card log-item"
      >
        <view class="log-header">
          <text class="version">{{ versionLabel(log.version) }}</text>
          <!-- 仅第一条（最新版本）显示「最新」小徽标 -->
          <text v-if="index === 0" class="latest-badge">最新</text>
          <!-- 日期是 YYYY-MM-DD 字符串，直接展示，不做时区转换 -->
          <text class="date">{{ log.date }}</text>
        </view>

        <!-- 分组内容：超过 3 行折叠；最新版本（第一条）默认展开 -->
        <view class="log-body" :class="{ 'is-collapsed': isBodyCollapsed(index) }">
          <!-- 内层按完整内容布局（不裁剪），供 SelectorQuery 测量真实高度 -->
          <view class="log-body-inner" :id="`log-body-inner-${index}`">
            <view v-for="(section, sectionIndex) in log.sections || []" :key="sectionIndex" class="log-section">
              <text class="section-title">{{ section.title }}</text>
              <view v-for="(entry, entryIndex) in section.items || []" :key="entryIndex" class="entry-row">
                <text class="entry-dot">·</text>
                <text class="entry-text">{{ entry }}</text>
              </view>
            </view>
          </view>

          <!-- 折叠时的底部渐隐遮罩 -->
          <view v-if="bodyMeasured && isBodyCollapsed(index)" class="log-body-mask"></view>
        </view>

        <!-- 只有内容真的超过 3 行才显示切换 -->
        <view
          v-if="isBodyOverflowing(index)"
          class="log-toggle"
          hover-class="mm-hover"
          @click="toggleBody(index)"
        >
          <text class="log-toggle-text">{{ isBodyCollapsed(index) ? '展开' : '收起' }}</text>
        </view>
      </view>
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="page-card state-card">
      <text class="state-title">更新日志加载失败</text>
      <text class="state-desc">请检查网络后重试</text>
      <view class="retry-btn" hover-class="mm-hover" @click="retryInitial">
        <text class="retry-text">重试</text>
      </view>
    </view>

    <!-- 空态：服务端日志文件缺失时 items 为空 -->
    <view v-else class="page-card state-card">
      <text class="state-title">暂无更新日志</text>
      <text class="state-desc">新版本发布后会在这里展示</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
@use "@/styles/page-layouts.scss";

/* 分组小标题：13px / 600 灰字 */
.group-title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  margin: 0 2px 8px;
}

/* 摘要：12px 弱化 */
.summary {
  display: block;
  margin: 0 2px 8px;
  font-size: 12px;
  color: var(--text-faint);
}

/* 一个版本一张卡片：和 Web 端一致，版本之间留 10px 间距，不再共用一个白色卡片 */
.log-list {
  display: block;
}

.log-item {
  /* .page-card 默认 padding 16px / margin-bottom 12px，这里按版本卡片收紧 */
  padding: 14px 16px;
  margin-bottom: 0;
}

.log-item + .log-item {
  margin-top: 10px;
}

/* 版本行：版本号 + 「最新」徽标 + 右侧日期 */
.log-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.version {
  flex-shrink: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

/* 「最新」小徽标：主题浅底 + 强调色（仅第一条显示） */
.latest-badge {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 999px;
  color: var(--theme-color-strong);
  background-color: var(--theme-color-soft);
}

/* 日期：12px faint，靠右 */
.date {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 12px;
  color: var(--text-faint);
}

/* 分组之间留一点间距 */
.log-section + .log-section {
  margin-top: 10px;
}

/* 内容折叠：超过 3 行（正文 13px × 1.65 ≈ 65px）隐藏，底部渐隐 + 展开按钮 */
.log-body {
  position: relative;
}

.log-body.is-collapsed {
  max-height: 65px;
  overflow: hidden;
}

/* 内层按完整内容布局（overflow: hidden 建立 BFC，让分组 margin 计入测量高度） */
.log-body-inner {
  overflow: hidden;
}

/* 折叠时的底部渐隐：底色与卡片一致，日夜主题通用 */
.log-body-mask {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 26px;
  background: linear-gradient(180deg, transparent, var(--bg-elevated));
  pointer-events: none;
}

/* 展开 / 收起：主题色小字，只在内容溢出时出现 */
.log-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  margin-top: 2px;
}

.log-toggle-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--theme-color-strong);
}

/* 分组标题：13px / 600 次要色 */
.section-title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 4px;
}

/* 条目行：左侧 · 圆点 + 正文，长文本自动换行 */
.entry-row {
  display: flex;
  align-items: flex-start;
}

.entry-dot {
  flex-shrink: 0;
  width: 12px;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-faint);
}

.entry-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-color);
  word-break: break-word;
}

/* 骨架屏：三条版本行占位，渐变扫光 */
.skeleton-list {
  padding: 8px 16px;
}

.skeleton-row {
  padding: 14px 0;
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
  animation: changelog-skeleton 1.5s infinite;
}

.skeleton-main {
  width: 40%;
  height: 16px;
  margin-bottom: 10px;
}

.skeleton-sub {
  width: 78%;
  height: 12px;
  margin-bottom: 8px;
}

.skeleton-sub.short {
  width: 56%;
  margin-bottom: 0;
}

@keyframes changelog-skeleton {
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
</style>
