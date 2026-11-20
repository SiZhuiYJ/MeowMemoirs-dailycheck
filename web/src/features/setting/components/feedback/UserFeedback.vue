<script setup lang="ts">
import { SettingApi } from "@/features/setting/api";
import type { FeedbackItemDto } from "@/features/setting/types";
import {
  feedbackAppLabel,
  feedbackStatusLabel,
  feedbackStatusTagType,
  formatLocalTime,
} from "./format";

/**
 * 普通用户视角的「意见反馈」：上方提交表单，下方「我的反馈」分页列表。
 * 管理员不会渲染本组件（见 views/setting/feedback/index.vue 的角色切换）。
 */

/** 每页条数（与后端默认值一致）。 */
const PAGE_SIZE = 20;

// —— 提交表单 ——
const content = ref("");
const contact = ref("");
/** 提交中（同时用于禁用输入与防止重复提交） */
const submitting = ref(false);

// —— 我的反馈列表 ——
const items = ref<FeedbackItemDto[]>([]);
const page = ref(1);
const total = ref(0);
/** 首屏 / 重新加载中 */
const loading = ref(false);
/** 加载下一页中 */
const loadingMore = ref(false);
/** 首屏失败 */
const error = ref(false);
/** 加载更多失败 */
const loadMoreError = ref(false);
/** 是否已完成过一次整页请求（控制刷新按钮 / 摘要显示） */
const loadedOnce = ref(false);

/**
 * 请求序号：重新加载时自增，旧请求返回时序号对不上就丢弃，
 * 避免提交后触发的刷新被更早的慢响应覆盖（与 login-records 的写法一致）。
 */
let requestSeq = 0;

const hasMore = computed(
  () => items.value.length > 0 && items.value.length < total.value,
);

const finished = computed(
  () => items.value.length > 0 && items.value.length >= total.value,
);

// —— 数据加载 ——

/**
 * 加载指定页。
 * @param targetPage 目标页码
 * @param mode initial 首屏 / 重新加载；more 加载更多
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
    const res = await SettingApi.GetMyFeedback({
      page: targetPage,
      pageSize: PAGE_SIZE,
    });
    // 期间发起了新的整页请求：丢弃过期响应
    if (seq !== requestSeq) return;

    const data = res.data ?? {};
    const list = Array.isArray(data.items)
      ? data.items.filter((item) => item && typeof item === "object")
      : [];
    items.value = mode === "more" ? items.value.concat(list) : list;
    page.value = targetPage;
    total.value = Number(data.total) || 0;
    loadedOnce.value = true;
  } catch (err) {
    if (seq !== requestSeq) return;
    console.error("[setting/feedback] 加载我的反馈失败", err);
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

/** 重置到第 1 页并重新加载（提交成功 / 重试共用）。 */
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

// —— 提交 ——

/**
 * 提交反馈。
 * 前端做与后端一致的 trim / 长度校验（避免一次无意义的网络往返），
 * 后端 400 的提示仍由 http 层全局弹出，这里 catch 只记日志、不重复弹窗。
 */
async function submitFeedback(): Promise<void> {
  if (submitting.value) return;

  const text = content.value.trim();
  if (!text) {
    ElMessage.warning("请填写反馈内容");
    return;
  }
  if (text.length > 2000) {
    ElMessage.warning("反馈内容不能超过 2000 个字符");
    return;
  }

  const contactText = contact.value.trim();
  if (contactText.length > 128) {
    ElMessage.warning("联系方式不能超过 128 个字符");
    return;
  }

  submitting.value = true;
  try {
    await SettingApi.SubmitFeedback({
      content: text,
      contact: contactText || null,
      app: "web",
    });
    ElMessage.success("提交成功，感谢您的反馈");
    // 清空表单，并把「我的反馈」刷新回第 1 页（新反馈在列表顶部）
    content.value = "";
    contact.value = "";
    resetAndLoad();
  } catch (err) {
    console.error("[setting/feedback] 提交反馈失败", err);
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  void loadPage(1, "initial");
});
</script>

<template>
  <div class="setting-subpage">
    <!-- 卡片 1：提交反馈 -->
    <div class="setting-card">
      <div class="setting-header">
        <h3 class="setting-title">意见反馈</h3>
        <p class="setting-subtitle">
          使用中遇到问题，或对功能有建议，都可以告诉我们；处理后会在这里回复您。
        </p>
      </div>

      <div class="setting-form">
        <div class="setting-field">
          <span>反馈内容 <span class="feedback-required">*</span></span>
          <el-input
            v-model="content"
            class="feedback-textarea"
            type="textarea"
            :rows="4"
            maxlength="2000"
            show-word-limit
            resize="vertical"
            placeholder="请描述您遇到的问题或建议，越具体越方便我们定位"
            :disabled="submitting"
          />
        </div>

        <div class="setting-field">
          <span>联系方式（可选）</span>
          <input
            v-model="contact"
            class="setting-input"
            maxlength="128"
            placeholder="邮箱 / 微信号 / 手机号，便于我们回复您"
            :disabled="submitting"
          />
          <span class="setting-desc">不会公开展示，仅在需要进一步沟通时使用。</span>
        </div>
      </div>

      <div class="setting-footer">
        <el-button
          type="primary"
          class="setting-submit"
          :loading="submitting"
          :disabled="!content.trim()"
          @click="submitFeedback"
        >
          提交反馈
        </el-button>
      </div>
    </div>

    <!-- 卡片 2：我的反馈 -->
    <div class="setting-card">
      <div class="setting-header feedback-list-header">
        <div class="feedback-list-heading">
          <h3 class="setting-title">我的反馈</h3>
          <p class="setting-subtitle">提交后可在这里查看处理状态与管理员回复。</p>
        </div>
        <el-button
          v-if="loadedOnce && !loading"
          plain
          size="small"
          @click="retryInitial"
        >
          刷新
        </el-button>
      </div>

      <!-- 首屏加载骨架 -->
      <div v-if="loading" class="feedback-skeleton">
        <el-skeleton :rows="5" animated />
      </div>

      <!-- 失败态：列表请求关闭了全局提示，由这里给出重试入口 -->
      <div v-else-if="error" class="feedback-state">
        <span class="feedback-state-title">反馈记录加载失败</span>
        <span class="setting-desc">请检查网络后重试。</span>
        <el-button type="primary" plain @click="retryInitial">重试</el-button>
      </div>

      <!-- 空态 -->
      <el-empty
        v-else-if="items.length === 0"
        description="暂无反馈记录"
        :image-size="72"
      >
        <p class="feedback-empty-desc">提交反馈后可以在这里查看处理进度</p>
      </el-empty>

      <!-- 反馈列表 -->
      <ul v-else class="feedback-list">
        <li v-for="item in items" :key="item.id" class="feedback-item">
          <div class="feedback-item-top">
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

          <!-- 有回复才展示回复块 -->
          <div v-if="item.status === 'replied'" class="feedback-reply">
            <p class="feedback-reply-title">管理员回复</p>
            <p class="feedback-reply-content">
              {{ item.replyContent || "（无回复内容）" }}
            </p>
            <p class="feedback-reply-time">
              回复时间：{{ formatLocalTime(item.repliedAt) }}
            </p>
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
// 反馈列表 / 回复块等与管理员视图共用的样式见 features/setting/style/feedback.scss。
@use "@/features/setting/style/feedback.scss";

.feedback-list-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.feedback-list-heading {
  flex: 1;
  min-width: 200px;
}

// 必填标记：只做视觉提示，提交前的空值校验在脚本里
.feedback-required {
  color: var(--chat-danger);
}
</style>
