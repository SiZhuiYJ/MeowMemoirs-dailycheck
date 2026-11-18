<script setup lang="ts">
import type {
  LoginRecordItem,
  LoginScope,
  LoginStatus,
} from "@/features/setting/types";
import { SettingApi } from "@/features/setting/api";

/** 每页条数（与后端默认值一致）。 */
const PAGE_SIZE = 20;

/** 状态文案 */
const STATUS_LABELS: Record<LoginStatus, string> = {
  current: "当前登录",
  active: "在线",
  logged_out: "已退出",
};

/** 登录方式中文文案（后端新增取值时兜底为「登录」） */
const LOGIN_TYPE_LABELS: Record<string, string> = {
  password: "密码登录",
  "email-code": "验证码登录",
  wechat: "微信登录",
  register: "注册登录",
  "email-change": "换绑登录",
};

const scope = ref<LoginScope>("domestic");
const items = ref<LoginRecordItem[]>([]);
const page = ref(1);
/** 当前 scope 下的总条数 */
const total = ref(0);
const domesticTotal = ref(0);
const allTotal = ref(0);
/** 首屏 / 切换筛选的整页加载中 */
const loading = ref(false);
/** 加载下一页中 */
const loadingMore = ref(false);
/** 首屏失败 */
const error = ref(false);
/** 加载更多失败 */
const loadMoreError = ref(false);
/** 是否已完成过一次整页请求（控制摘要显示） */
const loadedOnce = ref(false);

/**
 * 请求序号：切换筛选 / 重新加载时自增。
 * 旧请求返回时序号对不上就丢弃，避免慢响应覆盖新数据。
 */
let requestSeq = 0;

const summaryText = computed(() => {
  if (scope.value === "domestic") {
    return `国内登录 ${domesticTotal.value} 次`;
  }
  return `全部登录 ${allTotal.value} 次（其中国内 ${domesticTotal.value} 次）`;
});

const emptyText = computed(() =>
  scope.value === "domestic" ? "暂无国内登录记录" : "暂无登录记录",
);

const hasMore = computed(
  () => items.value.length > 0 && items.value.length < total.value,
);

const finished = computed(
  () => items.value.length > 0 && items.value.length >= total.value,
);

// —— 格式化小函数（不引新依赖）——

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * 解析后端时间：约定为 UTC ISO（可能带 Z，也可能不带时区）。
 * 缺时区时按 UTC 处理，避免被当成设备本地时间而偏移。
 */
function parseUtcDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  let text = String(value).trim();
  if (!text) return null;
  text = text.replace(" ", "T");
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    text += "Z";
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 登录时间格式化为本地 "YYYY-MM-DD HH:mm" */
function formatLoginTime(value: string | null | undefined): string {
  const date = parseUtcDate(value);
  if (!date) return "时间未知";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 归一化状态：异常值按「在线」兜底。 */
function normalizeStatus(status: LoginStatus | null | undefined): LoginStatus {
  if (status === "current" || status === "logged_out") return status;
  return "active";
}

function statusLabel(item: LoginRecordItem): string {
  return STATUS_LABELS[normalizeStatus(item.status)];
}

function statusTagType(
  item: LoginRecordItem,
): "primary" | "success" | "info" {
  const status = normalizeStatus(item.status);
  if (status === "current") return "primary";
  if (status === "logged_out") return "info";
  return "success";
}

function loginTypeLabel(loginType: string | null | undefined): string {
  if (!loginType) return "登录";
  return LOGIN_TYPE_LABELS[loginType] ?? "登录";
}

/** 第三行：登录方式 + 脱敏 IP（有 IP 才追加）。 */
function metaText(item: LoginRecordItem): string {
  const parts: string[] = [loginTypeLabel(item.loginType)];
  if (item.ipMasked) {
    parts.push(`IP ${item.ipMasked}`);
  }
  return parts.join(" · ");
}

// —— 数据加载 ——

/**
 * 加载指定页。
 * @param targetPage 目标页码
 * @param mode initial 首屏（含切换筛选）/ more 加载更多
 */
async function loadPage(
  targetPage: number,
  mode: "initial" | "more",
): Promise<void> {
  if (mode === "initial" && loading.value) return;
  if (mode === "more" && (loading.value || loadingMore.value)) return;

  const seq = ++requestSeq;

  if (mode === "more") {
    loadingMore.value = true;
    loadMoreError.value = false;
  } else {
    loading.value = true;
    error.value = false;
    loadMoreError.value = false;
  }

  try {
    const res = await SettingApi.GetLoginRecords({
      page: targetPage,
      pageSize: PAGE_SIZE,
      scope: scope.value,
    });
    // 期间切换了筛选 / 重新加载：丢弃过期响应
    if (seq !== requestSeq) return;

    const data = res.data ?? {};
    const list = Array.isArray(data.items) ? data.items : [];
    items.value = mode === "more" ? items.value.concat(list) : list;
    page.value = targetPage;
    total.value = Number(data.total) || 0;
    domesticTotal.value = Number(data.domesticTotal) || 0;
    allTotal.value = Number(data.allTotal) || 0;
    loadedOnce.value = true;
  } catch (err) {
    if (seq !== requestSeq) return;
    console.error("[setting/login-records] 加载登录记录失败", err);
    if (mode === "more") {
      loadMoreError.value = true;
    } else {
      error.value = true;
    }
  } finally {
    if (seq === requestSeq) {
      if (mode === "more") {
        loadingMore.value = false;
      } else {
        loading.value = false;
      }
    }
  }
}

/** 切换筛选：重置到第 1 页重新拉取。 */
function resetAndLoad(): void {
  // 让在途请求失效，并清空列表回到骨架屏
  requestSeq += 1;
  items.value = [];
  page.value = 1;
  total.value = 0;
  error.value = false;
  loadMoreError.value = false;
  loading.value = false;
  loadingMore.value = false;
  void loadPage(1, "initial");
}

/** 首屏失败重试 */
function retryInitial(): void {
  if (loading.value) return;
  void loadPage(1, "initial");
}

/** 加载更多（失败后不再自动加载，由底部重试按钮触发）。 */
function loadMore(): void {
  if (loading.value || loadingMore.value || loadMoreError.value) return;
  if (!hasMore.value) return;
  void loadPage(page.value + 1, "more");
}

/** 加载更多失败重试 */
function retryLoadMore(): void {
  if (loading.value || loadingMore.value) return;
  if (!hasMore.value) return;
  void loadPage(page.value + 1, "more");
}

watch(scope, resetAndLoad);

onMounted(() => {
  void loadPage(1, "initial");
});
</script>

<template>
  <div class="setting-subpage">
    <div class="setting-card">
      <div class="setting-header records-header">
        <div class="records-heading">
          <h3 class="setting-title">登录记录</h3>
          <p class="setting-subtitle">
            记录每次成功登录的设备与 IP 归属地，默认只显示国内登录。
          </p>
        </div>

        <el-radio-group v-model="scope" size="small">
          <el-radio-button value="domestic">国内</el-radio-button>
          <el-radio-button value="all">全部</el-radio-button>
        </el-radio-group>
      </div>

      <p v-if="loadedOnce && !loading" class="records-summary">{{ summaryText }}</p>

      <!-- 首屏加载骨架 -->
      <div v-if="loading" class="records-skeleton">
        <el-skeleton :rows="5" animated />
      </div>

      <!-- 失败态 -->
      <div v-else-if="error" class="records-state">
        <span class="records-state-title">登录记录加载失败</span>
        <span class="setting-desc">请检查网络后重试。</span>
        <el-button type="primary" plain @click="retryInitial">重试</el-button>
      </div>

      <!-- 空态 -->
      <el-empty v-else-if="items.length === 0" :description="emptyText" :image-size="72" />

      <!-- 列表 -->
      <ul v-else class="records-list">
        <li v-for="item in items" :key="item.id" class="record-item">
          <div class="record-top">
            <span class="record-device">{{ item.device || "未知设备" }}</span>
            <el-tag size="small" :type="statusTagType(item)" effect="light">
              {{ statusLabel(item) }}
            </el-tag>
          </div>

          <div class="record-sub">
            <span v-if="scope === 'all' && item.isDomestic" class="record-domestic">国内</span>
            <span class="record-info">
              {{ item.location || "未知位置" }} · {{ formatLoginTime(item.loginAt) }}
            </span>
          </div>

          <div class="record-meta">{{ metaText(item) }}</div>
        </li>
      </ul>

      <!-- 加载更多 / 没有更多 -->
      <div v-if="items.length > 0" class="records-footer">
        <el-button v-if="loadMoreError" plain @click="retryLoadMore">
          加载失败，点击重试
        </el-button>
        <el-button v-else-if="hasMore" type="primary" plain :loading="loadingMore" @click="loadMore">
          加载更多
        </el-button>
        <span v-else-if="finished" class="records-finished">没有更多了</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 页面骨架（.setting-subpage / .setting-card / 标题 / 副标题）见
// features/setting/style/index.scss，这里只写列表 / 状态 / 筛选的布局。
.records-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.records-heading {
  flex: 1;
  min-width: 200px;
}

.records-summary {
  margin: 0 0 10px;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
}

.records-skeleton {
  padding: 4px 0;
}

.records-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 0 12px;
  text-align: center;
}

.records-state-title {
  color: var(--chat-text);
  font-size: 13px;
  font-weight: 600;
}

.records-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.record-item {
  padding: 10px 2px;
  border-bottom: 1px solid var(--chat-border);

  &:last-child {
    border-bottom: none;
  }
}

.record-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.record-device {
  overflow: hidden;
  color: var(--chat-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.record-info {
  overflow: hidden;
  color: var(--chat-text-secondary);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// 「国内」小徽标：主题浅底 + 同色系字，日 / 夜主题自动适配
.record-domestic {
  flex-shrink: 0;
  padding: 0 6px;
  border: 1px solid var(--theme-color-muted);
  border-radius: 999px;
  background: var(--theme-color-soft);
  color: var(--theme-color-strong);
  font-size: 10px;
  line-height: 16px;
}

.record-meta {
  margin-top: 2px;
  color: var(--chat-muted);
  font-size: 11px;
  line-height: 17px;
}

.records-footer {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}

.records-finished {
  color: var(--chat-muted-light);
  font-size: 11px;
  line-height: 17px;
}
</style>
