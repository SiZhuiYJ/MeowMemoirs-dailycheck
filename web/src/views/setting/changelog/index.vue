<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import type { ChangelogEntry } from "@/features/setting/types";
import { SettingApi } from "@/features/setting/api";

/** 每次拉取的版本条数上限（后端默认 20，并夹到 1..50）。 */
const PAGE_SIZE = 20;

const items = ref<ChangelogEntry[]>([]);
/** 最新版本号 / 日期（服务端给的是 items[0]，没有日志时为 null） */
const latestVersion = ref<string | null>(null);
const latestDate = ref<string | null>(null);
/** 版本总数（可能大于实际返回的 items 条数） */
const total = ref(0);
/** 首屏加载中 */
const loading = ref(false);
/** 首屏加载失败 */
const error = ref(false);
/** 是否已完成过一次请求（控制摘要显示，避免骨架屏期间闪出「共 0 个版本」） */
const loadedOnce = ref(false);

/**
 * 请求序号：重试时自增。
 * 旧请求返回时序号对不上就丢弃，避免慢响应覆盖新数据。
 */
let requestSeq = 0;

// —— 内容折叠（每个版本最多 3 行，最新版本默认展开）——

/**
 * 折叠高度（px）：正文条目 12px / 19px 行高，3 行 = 57px。
 * 必须与样式里 `.log-body.is-collapsed` 的 max-height 保持一致。
 */
const COLLAPSED_BODY_HEIGHT = 57;

/** 版本内容内层节点（key = 版本下标），只用于测量真实内容高度。 */
const bodyInnerRefs = new Map<number, HTMLElement>();

/** 每个版本的内容是否超过 3 行（测量得到；未测量 / 不溢出为 false）。 */
const bodyOverflowing = ref<Record<number, boolean>>({});

/** 用户显式切换过的折叠状态；未记录时按「最新展开、其余折叠」的默认值。 */
const collapsedState = ref<Record<number, boolean>>({});

/** 是否已完成过至少一次内容高度测量（测量前先按折叠态渲染，避免长内容整段闪出）。 */
const bodyMeasured = ref(false);

/** 记录 / 清理内层内容节点的 ref。 */
function setBodyInnerRef(
  el: Element | ComponentPublicInstance | null,
  index: number,
): void {
  if (el instanceof HTMLElement) {
    bodyInnerRefs.set(index, el);
  } else {
    bodyInnerRefs.delete(index);
  }
}

/** 内容是否超过 3 行（只有溢出的版本才显示「展开 / 收起」）。 */
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

  const explicit = collapsedState.value[index];
  return explicit ?? index !== 0;
}

/** 展开 / 收起某个版本的内容。 */
function toggleBody(index: number): void {
  collapsedState.value = {
    ...collapsedState.value,
    [index]: !isBodyCollapsed(index),
  };
}

/**
 * 测量每个版本内容的真实高度，更新「是否溢出」状态。
 * 外层折叠容器只限制视觉高度，内层节点仍按完整内容布局，所以量到的是完整高度。
 */
async function measureBodyOverflow(): Promise<void> {
  await nextTick();

  const nextOverflow: Record<number, boolean> = {};
  bodyInnerRefs.forEach((el, index) => {
    nextOverflow[index] =
      el.getBoundingClientRect().height > COLLAPSED_BODY_HEIGHT + 1;
  });
  bodyOverflowing.value = nextOverflow;
  bodyMeasured.value = true;

  // 数据刷新后条目变少：清掉不再存在的版本的显式折叠状态
  const validIndexes = new Set(Object.keys(nextOverflow).map(Number));
  collapsedState.value = Object.fromEntries(
    Object.entries(collapsedState.value).filter(([key]) =>
      validIndexes.has(Number(key)),
    ),
  );
}

/** resize 防抖：窗口宽度变化会改变换行与内容高度，需要重新测量。 */
let measureTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleMeasure(): void {
  if (measureTimer) clearTimeout(measureTimer);
  measureTimer = setTimeout(() => {
    measureTimer = null;
    void measureBodyOverflow();
  }, 150);
}

/** 版本号展示：服务端返回 1.2.0，展示时统一补 v；已带 v 的不重复补（与小程序端一致）。 */
function versionLabel(version: string | null | undefined): string {
  const text = (version ?? "").trim();
  if (!text) return "未命名版本";
  return /^v/i.test(text) ? text : `v${text}`;
}

const summaryText = computed(() => {
  const count = total.value || items.value.length;
  if (!count) return "";
  if (latestVersion.value) {
    return `共 ${count} 个版本 · 最新 ${versionLabel(latestVersion.value)}`;
  }
  return `共 ${count} 个版本`;
});

/** 把接口返回的 sections 归一化，避免脏数据把渲染打断。 */
function normalizeSections(entry: ChangelogEntry) {
  if (!Array.isArray(entry.sections)) return [];
  return entry.sections
    .filter((section) => section && typeof section.title === "string")
    .map((section) => ({
      title: section.title,
      items: Array.isArray(section.items)
        ? section.items.filter((text) => typeof text === "string")
        : [],
    }));
}

/** 首个分组之前的空稿：版本存在但没有任何条目时给个占位文案。 */
function isEmptyEntry(entry: ChangelogEntry): boolean {
  return normalizeSections(entry).every((section) => section.items.length === 0);
}

// —— 数据加载 ——

async function load(): Promise<void> {
  if (loading.value) return;
  const seq = ++requestSeq;
  loading.value = true;
  error.value = false;

  try {
    const res = await SettingApi.GetChangelog({ limit: PAGE_SIZE });
    // 期间发起了新的请求（例如重试）：丢弃过期响应
    if (seq !== requestSeq) return;

    const data = res.data ?? {};
    const list = Array.isArray(data.items) ? data.items : [];
    items.value = list.map((entry) => ({
      version: entry.version ?? "",
      date: entry.date ?? null,
      sections: normalizeSections(entry),
    }));
    latestVersion.value = data.latestVersion ?? null;
    latestDate.value = data.latestDate ?? null;
    total.value = Number(data.total) || 0;
    loadedOnce.value = true;
    // 新数据：回到默认「最新展开、其余折叠」，并等待重新测量
    collapsedState.value = {};
    bodyOverflowing.value = {};
    bodyMeasured.value = false;
  } catch (err) {
    if (seq !== requestSeq) return;
    console.error("[setting/changelog] 加载更新日志失败", err);
    error.value = true;
  } finally {
    if (seq === requestSeq) {
      loading.value = false;
    }
  }

  // 数据渲染完成后再按真实高度判断哪些版本需要折叠（失败时保留旧内容，不重测）
  if (seq === requestSeq && !error.value) {
    void measureBodyOverflow();
  }
}

/** 失败重试 */
function retry(): void {
  if (loading.value) return;
  void load();
}

onMounted(() => {
  void load();
  window.addEventListener("resize", scheduleMeasure);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", scheduleMeasure);
  if (measureTimer) {
    clearTimeout(measureTimer);
    measureTimer = null;
  }
});
</script>

<template>
  <div class="setting-subpage">
    <div class="setting-card">
      <div class="setting-header">
        <h3 class="setting-title">更新日志</h3>
        <p class="setting-subtitle">记录喵咪记事簿每个版本的更新内容。</p>
      </div>

      <p v-if="loadedOnce && !loading && summaryText" class="log-summary">
        {{ summaryText }}
        <span v-if="latestDate" class="log-summary-date">（{{ latestDate }}）</span>
      </p>

      <!-- 首屏加载骨架 -->
      <div v-if="loading" class="log-skeleton">
        <el-skeleton :rows="6" animated />
      </div>

      <!-- 失败态 -->
      <div v-else-if="error" class="log-state">
        <span class="log-state-title">更新日志加载失败</span>
        <span class="setting-desc">请检查网络后重试。</span>
        <el-button type="primary" plain @click="retry">重试</el-button>
      </div>

      <!-- 空态：服务端文件缺失时也会走到这里 -->
      <el-empty
        v-else-if="items.length === 0"
        description="暂无更新日志"
        :image-size="72"
      >
        <p class="log-empty-desc">版本更新后这里会显示每次的更新内容</p>
      </el-empty>

      <!-- 版本列表：一条一个版本卡片，日期由服务端给 YYYY-MM-DD，原样展示 -->
      <ul v-else class="log-list">
        <li
          v-for="(entry, index) in items"
          :key="`${entry.version}-${index}`"
          class="log-item"
        >
          <div class="log-top">
            <span class="log-version">{{ versionLabel(entry.version) }}</span>
            <!-- 列表按日期倒序，第一条就是最新版本 -->
            <el-tag v-if="index === 0" size="small" type="primary" effect="light">
              最新
            </el-tag>
            <span v-if="entry.date" class="log-date">{{ entry.date }}</span>
          </div>

          <p v-if="isEmptyEntry(entry)" class="log-empty-entry">
            该版本暂无更新条目
          </p>

          <!-- 内容区：超过 3 行折叠，最新版本（第一条）默认展开 -->
          <template v-else>
            <div
              class="log-body"
              :class="{ 'is-collapsed': isBodyCollapsed(index) }"
            >
              <!-- 内层按完整内容布局，供 JS 测量真实高度 -->
              <div
                class="log-body-inner"
                :ref="(el) => setBodyInnerRef(el, index)"
              >
                <!-- 分组条目一律纯文本插值，不用 v-html -->
                <div class="log-sections">
                  <div
                    v-for="(section, sectionIndex) in entry.sections"
                    :key="`${entry.version}-${sectionIndex}-${section.title}`"
                    class="log-section"
                  >
                    <p class="log-section-title">{{ section.title }}</p>
                    <ul class="log-section-items">
                      <li
                        v-for="(text, textIndex) in section.items"
                        :key="`${entry.version}-${sectionIndex}-${textIndex}`"
                        class="log-section-item"
                      >
                        {{ text }}
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <!-- 折叠时的底部渐隐遮罩 -->
              <div
                v-if="bodyMeasured && isBodyCollapsed(index)"
                class="log-body-mask"
                aria-hidden="true"
              />
            </div>

            <!-- 只有内容真的超过 3 行才显示切换 -->
            <button
              v-if="isBodyOverflowing(index)"
              type="button"
              class="log-toggle"
              :aria-expanded="!isBodyCollapsed(index)"
              @click="toggleBody(index)"
            >
              {{ isBodyCollapsed(index) ? "展开" : "收起" }}
            </button>
          </template>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

// 页面骨架（.setting-subpage / .setting-card / 标题 / 副标题）见
// features/setting/style/index.scss，这里只写更新日志列表的布局。
.log-summary {
  margin: 0 0 10px;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
}

.log-summary-date {
  color: var(--chat-muted-light);
}

.log-skeleton {
  padding: 4px 0;
}

.log-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 0 12px;
  text-align: center;
}

.log-state-title {
  color: var(--chat-text);
  font-size: 13px;
  font-weight: 600;
}

.log-empty-desc {
  margin: 4px 0 0;
  color: var(--chat-muted);
  font-size: 11px;
  line-height: 17px;
}

.log-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

// 版本卡片：比外层 .setting-card 亮一档，用 --chat-* 描边分隔，日 / 夜主题自动适配
.log-item {
  padding: 12px 14px;
  border: 1px solid var(--chat-border);
  border-radius: 10px;
  background: var(--chat-surface-solid);
}

.log-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.log-version {
  color: var(--chat-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.log-date {
  margin-left: auto;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
}

.log-empty-entry {
  margin: 8px 0 0;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
}

// —— 内容折叠：超过 3 行（57px）隐藏，底部渐隐 + 展开按钮 ——
.log-body {
  position: relative;
  margin-top: 8px;
}

.log-body.is-collapsed {
  max-height: 57px;
  overflow: hidden;
}

// 内层按完整内容布局（display: flow-root 让子元素 margin 计入测量高度）
.log-body-inner {
  display: flow-root;
}

// 折叠时的底部渐隐：底色与版本卡片一致，日 / 夜主题自动适配
.log-body-mask {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 24px;
  pointer-events: none;
  background: linear-gradient(180deg, transparent, var(--chat-surface-solid));
}

// 展开 / 收起：主题色小字按钮，只在内容溢出时出现
.log-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  margin-top: 2px;
  padding: 0 2px;
  border: none;
  background: none;
  color: var(--theme-color-strong);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  cursor: pointer;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 0.75;
  }

  &:focus-visible {
    outline: 2px solid var(--theme-color-muted);
    outline-offset: 2px;
    border-radius: 4px;
  }
}

.log-section + .log-section {
  margin-top: 8px;
}

// 分组标题：「新增 / 修复 / 优化」，主题色小字，与条目的灰色形成层级
.log-section-title {
  margin: 0 0 4px;
  color: var(--theme-color-strong);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
}

.log-section-items {
  margin: 0;
  padding: 0;
  list-style: none;
}

// 条目：纯文本 + 主题色小圆点，长文本自动换行
.log-section-item {
  position: relative;
  padding-left: 12px;
  color: var(--chat-text-secondary);
  font-size: 12px;
  line-height: 19px;
  word-break: break-word;

  &::before {
    content: "";
    position: absolute;
    top: 8px;
    left: 2px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--theme-color-muted);
  }
}

@include rp.device-mobile {
  .log-item {
    padding: 10px 12px;
  }

  .log-list {
    gap: 8px;
  }

  .log-version {
    font-size: 13px;
    line-height: 19px;
  }

  .log-date {
    font-size: 11px;
    line-height: 17px;
  }

  .log-section-title {
    font-size: 11px;
    line-height: 17px;
  }

  .log-section-item {
    font-size: 12px;
    line-height: 18px;
  }
}
</style>
