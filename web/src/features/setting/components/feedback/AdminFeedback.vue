<script setup lang="ts">
import { SettingApi } from "@/features/setting/api";
import type {
  AdminFeedbackItemDto,
  FeedbackAppFilter,
  FeedbackStatusFilter,
} from "@/features/setting/types";
import {
  feedbackAppLabel,
  feedbackStatusLabel,
  feedbackStatusTagType,
  feedbackUserLabel,
  formatLocalTime,
} from "./format";

/**
 * 管理员视角的「查看意见」：筛选 + 全部反馈列表 + 直接回复。
 * 普通用户不会渲染本组件（见 views/setting/feedback/index.vue 的角色切换）。
 */

/** 每页条数（与后端默认值一致）。 */
const PAGE_SIZE = 20;

// —— 筛选条件 ——
/** 状态筛选（全部 / 待回复 / 已回复） */
const status = ref<FeedbackStatusFilter>("all");
/** 来源端筛选（全部 / 网页 / 小程序） */
const app = ref<FeedbackAppFilter>("all");
/** 输入框里的关键词（回车或点「搜索」才生效，避免每敲一个字都发请求） */
const keywordInput = ref("");
/** 已生效的关键词 */
const keyword = ref("");

// —— 列表状态 ——
const items = ref<AdminFeedbackItemDto[]>([]);
const page = ref(1);
/** 当前筛选命中的反馈数 */
const total = ref(0);
/** 全部反馈的待回复 / 已回复总数（用于 tab 徽标，不受关键词 / 来源筛选影响） */
const pendingTotal = ref(0);
const repliedTotal = ref(0);
/** 首屏 / 筛选变化后的整页加载中 */
const loading = ref(false);
/** 加载下一页中 */
const loadingMore = ref(false);
/** 首屏失败 */
const error = ref(false);
/** 加载更多失败 */
const loadMoreError = ref(false);
/** 无权限（非管理员调管理员接口会 403） */
const forbidden = ref(false);
/** 是否已完成过一次整页请求 */
const loadedOnce = ref(false);

/**
 * 请求序号：筛选变化 / 重新加载时自增。
 * 旧请求返回时序号对不上就丢弃，避免慢响应覆盖新筛选的结果。
 */
let requestSeq = 0;

// —— 回复编辑 ——
/** 每条反馈的回复草稿（只有打开编辑器时才写入），key = 反馈 ID */
const replyDrafts = reactive<Record<number, string>>({});
/** 正在展开编辑器的反馈 ID（null 表示都收起） */
const editingId = ref<number | null>(null);
/** 正在提交回复的反馈 ID（同时充当 loading 与防重复提交） */
const replyingId = ref<number | null>(null);

const hasMore = computed(
  () => items.value.length > 0 && items.value.length < total.value,
);

const finished = computed(
  () => items.value.length > 0 && items.value.length >= total.value,
);

/** 「全部」徽标 = 待回复 + 已回复（后端只单独给两个分类总数） */
const allTotal = computed(() => pendingTotal.value + repliedTotal.value);

/** 空态文案随筛选变化，便于管理员确认当前筛选条件 */
const emptyText = computed(() => {
  if (keyword.value) return "没有找到匹配的反馈";
  if (status.value === "pending") return "暂无待回复反馈";
  if (status.value === "replied") return "暂无已回复反馈";
  return "暂无用户反馈";
});

/** 摘要：当前筛选命中多少条 */
const summaryText = computed(() => {
  if (!loadedOnce.value) return "";
  return keyword.value || status.value !== "all" || app.value !== "all"
    ? `当前筛选命中 ${total.value} 条反馈`
    : `共 ${total.value} 条反馈`;
});

// —— 数据加载 ——

/**
 * 加载指定页。
 * @param targetPage 目标页码
 * @param mode initial 首屏 / 筛选变化；more 加载更多
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
    forbidden.value = false;
    loadMoreError.value = false;
  }

  const params: {
    page: number;
    pageSize: number;
    status: FeedbackStatusFilter;
    app: FeedbackAppFilter;
    keyword?: string;
  } = {
    page: targetPage,
    pageSize: PAGE_SIZE,
    status: status.value,
    app: app.value,
  };
  if (keyword.value) {
    params.keyword = keyword.value;
  }

  try {
    const res = await SettingApi.GetAdminFeedback(params);
    // 期间切换了筛选 / 重新加载：丢弃过期响应
    if (seq !== requestSeq) return;

    const data = res.data ?? {};
    const list = Array.isArray(data.items)
      ? data.items.filter((item) => item && typeof item === "object")
      : [];
    items.value = mode === "more" ? items.value.concat(list) : list;
    page.value = targetPage;
    total.value = Number(data.total) || 0;
    pendingTotal.value = Number(data.pendingTotal) || 0;
    repliedTotal.value = Number(data.repliedTotal) || 0;
    loadedOnce.value = true;

    // 预填回复草稿：待回复的留空、已回复的用原回复内容，
    // 这样待回复条目可以一直显示回复输入框（符合「未回复显示 textarea + 回复按钮」）。
    for (const item of items.value) {
      if (replyDrafts[item.id] === undefined) {
        replyDrafts[item.id] = item.replyContent ?? "";
      }
    }
  } catch (err) {
    if (seq !== requestSeq) return;
    console.error("[setting/feedback] 加载全部反馈失败", err);
    if (isForbidden(err)) {
      // 非管理员访问：展示无权限提示，不当作普通加载失败处理
      forbidden.value = true;
      return;
    }
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

/** 取出 HTTP 状态码（403 用来区分无权限与普通失败）。 */
function isForbidden(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 403;
}

/** 重置到第 1 页并重新加载（筛选变化 / 重试共用）。 */
function resetAndLoad(): void {
  // 让在途请求失效，并清空列表回到骨架屏
  requestSeq += 1;
  items.value = [];
  page.value = 1;
  total.value = 0;
  error.value = false;
  forbidden.value = false;
  loadMoreError.value = false;
  loading.value = false;
  loadingMore.value = false;
  void loadPage(1, "initial");
}

/** 首屏失败 / 手动刷新 */
function retryInitial(): void {
  if (loading.value) return;
  void loadPage(1, "initial");
}

/** 加载更多（失败后不自动继续，由底部重试按钮触发） */
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

// —— 筛选 ——

/** 应用关键词（回车 / 点「搜索」触发）。 */
function applyKeyword(): void {
  const text = keywordInput.value.trim();
  if (text.length > 100) {
    ElMessage.warning("搜索关键词不能超过 100 个字符");
    return;
  }
  keyword.value = text;
  resetAndLoad();
}

/** 清空关键词并恢复全部结果 */
function clearKeyword(): void {
  keywordInput.value = "";
  if (!keyword.value) return;
  keyword.value = "";
  resetAndLoad();
}

// 状态 / 来源变化：重置到第 1 页重新拉取（关键词需点搜索才生效，不在此监听）
watch([status, app], () => resetAndLoad());

// —— 回复 ——

/**
 * 是否展示某条反馈的回复编辑器：
 * 待回复条目始终展示（管理员可直接输入回复）；已回复条目默认收起，点「更新回复」才展开。
 */
function isReplyEditorOpen(item: AdminFeedbackItemDto): boolean {
  return item.status !== "replied" || editingId.value === item.id;
}

/** 展开已回复条目的回复编辑器（草稿已预填原回复，便于覆盖更新）。 */
function startReply(item: AdminFeedbackItemDto): void {
  editingId.value = item.id;
  if (replyDrafts[item.id] === undefined) {
    replyDrafts[item.id] = item.replyContent ?? "";
  }
}

/** 收起已回复条目的编辑器：丢弃未提交的修改，草稿恢复为当前已保存的回复。 */
function cancelReply(): void {
  const id = editingId.value;
  if (id !== null) {
    const item = items.value.find((entry) => entry.id === id);
    if (item) {
      replyDrafts[id] = item.replyContent ?? "";
    }
  }
  editingId.value = null;
}

/**
 * 提交 / 更新回复。
 * 成功后就地更新该条数据与计数（不整页刷新，避免列表滚动位置跳动）；
 * 后端 400 / 403 / 404 的提示由 http 层全局弹出，这里 catch 只记日志。
 */
async function submitReply(item: AdminFeedbackItemDto): Promise<void> {
  if (replyingId.value !== null) return;

  const text = (replyDrafts[item.id] ?? "").trim();
  if (!text) {
    ElMessage.warning("请填写回复内容");
    return;
  }
  if (text.length > 2000) {
    ElMessage.warning("回复内容不能超过 2000 个字符");
    return;
  }

  replyingId.value = item.id;
  try {
    const res = await SettingApi.ReplyFeedback(item.id, text);
    const updated = res.data;

    const index = items.value.findIndex((entry) => entry.id === item.id);
    if (index >= 0) {
      const previous = items.value[index]!;
      // 以本地已有字段为底合并：即使后端返回字段不全，也不会把用户身份丢掉
      const wasPending = previous.status === "pending";
      items.value[index] = {
        ...previous,
        ...(updated && typeof updated === "object" ? updated : {}),
        status: "replied",
        replyContent: updated?.replyContent ?? text,
        repliedAt: updated?.repliedAt ?? new Date().toISOString(),
      };
      replyDrafts[item.id] = items.value[index]!.replyContent ?? text;
      // 待回复 → 已回复：同步两个分类计数（tab 徽标与「全部」保持一致）
      if (wasPending) {
        pendingTotal.value = Math.max(pendingTotal.value - 1, 0);
        repliedTotal.value += 1;
      }
    }

    editingId.value = null;
    ElMessage.success("回复成功");
  } catch (err) {
    console.error("[setting/feedback] 回复失败", err);
  } finally {
    replyingId.value = null;
  }
}

onMounted(() => {
  void loadPage(1, "initial");
});
</script>

<template>
  <div class="setting-subpage">
    <div class="setting-card">
      <div class="setting-header">
        <h3 class="setting-title">查看意见</h3>
        <p class="setting-subtitle">
          管理端可查看用户提交的意见并直接回复；回复后用户可在「我的反馈」中看到。
        </p>
      </div>

      <!-- 筛选栏：状态 / 来源 / 关键词 -->
      <div class="feedback-filters">
        <el-radio-group v-model="status" size="small">
          <el-radio-button value="all">
            全部
            <span v-if="loadedOnce" class="feedback-count">{{ allTotal }}</span>
          </el-radio-button>
          <el-radio-button value="pending">
            待回复
            <span v-if="loadedOnce" class="feedback-count">{{ pendingTotal }}</span>
          </el-radio-button>
          <el-radio-button value="replied">
            已回复
            <span v-if="loadedOnce" class="feedback-count">{{ repliedTotal }}</span>
          </el-radio-button>
        </el-radio-group>

        <div class="feedback-filter-row">
          <el-radio-group v-model="app" size="small">
            <el-radio-button value="all">全部来源</el-radio-button>
            <el-radio-button value="web">网页</el-radio-button>
            <el-radio-button value="mp">小程序</el-radio-button>
          </el-radio-group>

          <div class="feedback-search">
            <input
              v-model="keywordInput"
              class="setting-input"
              maxlength="100"
              placeholder="搜索内容 / 联系方式 / 用户"
              @keyup.enter="applyKeyword"
            />
            <el-button type="primary" plain @click="applyKeyword">搜索</el-button>
            <el-button v-if="keyword" plain @click="clearKeyword">清除</el-button>
          </div>
        </div>
      </div>

      <p v-if="loadedOnce && !loading && !forbidden" class="feedback-summary">
        {{ summaryText }}
      </p>

      <!-- 首屏加载骨架 -->
      <div v-if="loading" class="feedback-skeleton">
        <el-skeleton :rows="6" animated />
      </div>

      <!-- 无权限：非管理员访问管理员接口时后端返回 403 -->
      <div v-else-if="forbidden" class="feedback-state">
        <span class="feedback-state-title">无权限查看全部反馈</span>
        <span class="setting-desc">当前账号不是管理员，如需查看请联系管理员。</span>
      </div>

      <!-- 失败态 -->
      <div v-else-if="error" class="feedback-state">
        <span class="feedback-state-title">反馈列表加载失败</span>
        <span class="setting-desc">请检查网络后重试。</span>
        <el-button type="primary" plain @click="retryInitial">重试</el-button>
      </div>

      <!-- 空态 -->
      <el-empty
        v-else-if="items.length === 0"
        :description="emptyText"
        :image-size="72"
      />

      <!-- 反馈列表 -->
      <ul v-else class="feedback-list">
        <li v-for="item in items" :key="item.id" class="feedback-item">
          <div class="feedback-item-top">
            <span class="feedback-user">{{ feedbackUserLabel(item) }}</span>
            <span class="feedback-user-id">#{{ item.userId }}</span>
            <el-tag
              size="small"
              :type="feedbackStatusTagType(item.status)"
              effect="light"
            >
              {{ feedbackStatusLabel(item.status) }}
            </el-tag>
            <span class="feedback-app">{{ feedbackAppLabel(item.app) }}</span>
            <span class="feedback-time">{{ formatLocalTime(item.createdAt) }}</span>
          </div>

          <p class="feedback-content">{{ item.content }}</p>

          <p v-if="item.contact" class="feedback-meta">
            联系方式：{{ item.contact }}
          </p>

          <!-- 已回复：展示现有回复 -->
          <div v-if="item.status === 'replied'" class="feedback-reply">
            <p class="feedback-reply-title">管理员回复</p>
            <p class="feedback-reply-content">
              {{ item.replyContent || "（无回复内容）" }}
            </p>
            <p class="feedback-reply-time">
              回复时间：{{ formatLocalTime(item.repliedAt) }}
            </p>
          </div>

          <!-- 回复编辑器：待回复条目始终展示；已回复条目点「更新回复」后展开 -->
          <div v-if="isReplyEditorOpen(item)" class="feedback-reply-editor">
            <el-input
              v-model="replyDrafts[item.id]"
              class="feedback-textarea"
              type="textarea"
              :rows="3"
              maxlength="2000"
              show-word-limit
              resize="vertical"
              placeholder="填写回复内容，用户会在「我的反馈」中看到"
              :disabled="replyingId === item.id"
            />
            <div class="feedback-reply-actions">
              <!-- 只有已回复条目（展开编辑）才需要「取消」，待回复条目输入框常驻 -->
              <el-button
                v-if="item.status === 'replied'"
                plain
                size="small"
                :disabled="replyingId === item.id"
                @click="cancelReply"
              >
                取消
              </el-button>
              <el-button
                type="primary"
                size="small"
                :loading="replyingId === item.id"
                :disabled="replyingId !== null && replyingId !== item.id"
                @click="submitReply(item)"
              >
                {{ item.status === "replied" ? "更新回复" : "回复" }}
              </el-button>
            </div>
          </div>

          <!-- 已回复且未展开编辑器：一个「更新回复」按钮用于覆盖原回复 -->
          <div v-else class="feedback-reply-actions">
            <el-button
              plain
              size="small"
              :disabled="replyingId !== null"
              @click="startReply(item)"
            >
              更新回复
            </el-button>
          </div>
        </li>
      </ul>

      <!-- 加载更多 / 没有更多 -->
      <div v-if="items.length > 0" class="feedback-footer">
        <el-button v-if="loadMoreError" plain @click="retryLoadMore">
          加载失败，点击重试
        </el-button>
        <el-button
          v-else-if="hasMore"
          type="primary"
          plain
          :loading="loadingMore"
          @click="loadMore"
        >
          加载更多
        </el-button>
        <span v-else-if="finished" class="feedback-finished">没有更多了</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 共享骨架见 features/setting/style/index.scss，
// 反馈列表 / 回复块 / 筛选栏等样式见 features/setting/style/feedback.scss。
@use "@/features/setting/style/feedback.scss";

.feedback-summary {
  margin: 0 0 10px;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
}
</style>
