<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app';
import { useThemeStore } from '@/stores/theme';
import { useAuthStore } from '@/stores/auth';
import MmNavBar from '@/components/MmNavBar.vue';
import http from '@/libs/http/config';

/**
 * 意见反馈页（单页按角色切换视图）：
 * · 普通用户：提交反馈 + 「我的反馈」列表；
 * · 管理员：查看全部意见 + 逐条回复（管理员绝不渲染提交表单）。
 * 角色以 authStore.isAdmin 为准（来自后端 role 字段），后端接口也会做权限校验。
 */

const themeStore = useThemeStore();
const authStore = useAuthStore();

/** 反馈处理状态 */
type FeedbackStatus = 'pending' | 'replied';
/** 管理员端状态筛选（all 不加状态条件） */
type AdminStatus = 'all' | 'pending' | 'replied';
/** 管理员端来源筛选（all 不加来源条件） */
type AdminApp = 'all' | 'web' | 'mp';
/** 分页加载模式：initial 首屏（含筛选切换）/ refresh 下拉刷新 / more 触底加载更多 */
type LoadMode = 'initial' | 'refresh' | 'more';

/** 单条反馈（字段与后端 FeedbackItemDto 的 camelCase 一致，时间为 UTC 字符串） */
interface FeedbackItemDto {
  id: number;
  content: string;
  contact?: string | null;
  /** 来源端：web 网页 / mp 小程序 */
  app: string;
  status: FeedbackStatus;
  replyContent?: string | null;
  repliedAt?: string | null;
  createdAt: string;
}

/** 管理员看到的反馈：多出提交人身份字段 */
interface AdminFeedbackItemDto extends FeedbackItemDto {
  userId: number;
  userAccount?: string | null;
  nickName?: string | null;
  email?: string | null;
}

/** GET /mm/Feedback/mine 响应体 */
interface MyFeedbackListResponse {
  page?: number;
  pageSize?: number;
  total?: number;
  items?: FeedbackItemDto[];
}

/** GET /mm/Feedback 响应体（管理员，含待回复 / 已回复总数供 tab 徽标使用） */
interface AdminFeedbackListResponse {
  page?: number;
  pageSize?: number;
  total?: number;
  pendingTotal?: number;
  repliedTotal?: number;
  status?: string;
  keyword?: string | null;
  app?: string;
  items?: AdminFeedbackItemDto[];
}

/** 每页条数（与后端默认值一致） */
const PAGE_SIZE = 20;
/** 反馈内容 / 回复内容的最大长度（与后端校验一致） */
const MAX_CONTENT = 2000;
/** 联系方式最大长度（与后端校验一致） */
const MAX_CONTACT = 128;
/** 搜索关键词最大长度（与后端校验一致） */
const MAX_KEYWORD = 100;

// —— 角色判定 ——

/** 角色信息是否已就绪：未就绪时先展示骨架，避免普通用户/管理员看到错误视图 */
const roleReady = ref(false);
/** 是否管理员（唯一判定来源是 authStore，避免页面自己解析 token） */
const isAdmin = computed(() => authStore.isAdmin);
/** 顶部标题按角色动态切换 */
const navTitle = computed(() => (isAdmin.value ? '查看意见' : '意见反馈'));

/** 同步原生导航栏标题（MmNavBar 走 hidden 的 navigationStyle，此处兼容 H5 / 系统标题文案） */
function syncNavBarTitle(): void {
  uni.setNavigationBarTitle({ title: navTitle.value });
}

// —— 格式化小函数（不引新依赖，UTC 解析照抄 login-records）——

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

/** UTC 时间格式化为本地 "YYYY-MM-DD HH:mm" */
function formatLocalTime(value: string | null | undefined): string {
  const date = parseUtcDate(value);
  if (!date) return '时间未知';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}

/** 状态中文文案 */
function statusLabel(status: string | null | undefined): string {
  return status === 'replied' ? '已回复' : '待回复';
}

/** 来源端中文文案 */
function appLabel(app: string | null | undefined): string {
  return app === 'mp' ? '小程序' : '网页';
}

/** 管理员端提交人展示：昵称优先，其次 @账号，再邮箱，最后兜底 userId */
function adminUserLabel(item: AdminFeedbackItemDto): string {
  const nickName = (item.nickName ?? '').trim();
  if (nickName) return nickName;
  const userAccount = (item.userAccount ?? '').trim();
  if (userAccount) return `@${userAccount}`;
  const email = (item.email ?? '').trim();
  if (email) return email;
  return `用户 ${item.userId}`;
}

/** 从请求错误里提取服务端文案（后端业务错误返回 {message}） */
function extractServerMessage(error: any): string {
  const data = error?.data;
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (data && typeof data.message === 'string' && data.message.trim()) return data.message.trim();
  return '';
}

/** 统一 toast（避免各分支重复写 icon: none） */
function toast(title: string): void {
  uni.showToast({ title, icon: 'none' });
}

// ============================================================
// 普通用户：提交反馈
// ============================================================

/** 反馈内容草稿 */
const feedbackContent = ref('');
/** 联系方式草稿（可选） */
const feedbackContact = ref('');
/** 提交中（按钮 loading + 防重复提交） */
const submitting = ref(false);

/** 提交一条反馈：成功后清空表单并刷新「我的反馈」到第 1 页 */
async function submitFeedback(): Promise<void> {
  if (submitting.value) return;

  const content = feedbackContent.value.trim();
  if (!content) {
    toast('请输入反馈内容');
    return;
  }
  if (content.length > MAX_CONTENT) {
    toast(`反馈内容不能超过 ${MAX_CONTENT} 个字符`);
    return;
  }
  const contact = feedbackContact.value.trim();
  if (contact.length > MAX_CONTACT) {
    toast(`联系方式不能超过 ${MAX_CONTACT} 个字符`);
    return;
  }

  submitting.value = true;
  try {
    // app 固定传 mp：后端据此区分反馈来源端
    await http.post<FeedbackItemDto>('/mm/Feedback', {
      content,
      contact: contact || null,
      app: 'mp',
    });
    uni.showToast({ title: '提交成功，感谢您的反馈', icon: 'success' });
    feedbackContent.value = '';
    feedbackContact.value = '';
    // 刷新列表（保留旧列表不闪骨架），并滚回顶部让用户看到最新一条
    void loadMyFeedback('refresh');
    uni.pageScrollTo({ scrollTop: 0, duration: 200 });
  } catch (err) {
    console.error('[feedback] 提交反馈失败', err);
    toast(extractServerMessage(err) || '提交失败，请稍后重试');
  } finally {
    submitting.value = false;
  }
}

// ============================================================
// 普通用户：「我的反馈」列表（分页 + 下拉刷新 + 触底加载更多）
// ============================================================

/** 我的反馈列表 */
const myItems = ref<FeedbackItemDto[]>([]);
/** 当前已加载到的页码 */
const myPage = ref(1);
/** 我的反馈总数 */
const myTotal = ref(0);
/** 首屏 / 重试的整页加载中（展示骨架屏） */
const myLoading = ref(false);
/** 触底加载下一页中 */
const myLoadingMore = ref(false);
/** 下拉刷新中（保留旧列表，不显示骨架） */
const myRefreshing = ref(false);
/** 首屏加载失败（列表为空时才展示失败态） */
const myError = ref(false);
/** 加载更多失败（底部展示重试） */
const myLoadMoreError = ref(false);
/** 是否已经完成过一次整页请求（控制摘要显示） */
const myLoadedOnce = ref(false);

/**
 * 请求序号：重新加载 / 切换视图时自增。
 * 旧请求返回时序号对不上就丢弃，避免慢响应覆盖新数据。
 */
let mySeq = 0;

/** 还有下一页可加载 */
const myHasMore = computed(() => myItems.value.length > 0 && myItems.value.length < myTotal.value);
/** 已全部加载完（用于「没有更多了」） */
const myFinished = computed(() => myItems.value.length > 0 && myItems.value.length >= myTotal.value);

/**
 * 加载「我的反馈」指定页。
 * @param mode initial 首屏 / refresh 下拉刷新（保留旧列表） / more 触底加载更多
 */
async function loadMyFeedback(mode: LoadMode): Promise<void> {
  const seq = ++mySeq;
  const targetPage = mode === 'more' ? myPage.value + 1 : 1;

  if (mode === 'more') {
    myLoadingMore.value = true;
    myLoadMoreError.value = false;
  } else if (mode === 'refresh') {
    myRefreshing.value = true;
    myError.value = false;
  } else {
    myLoading.value = true;
    myError.value = false;
    myLoadMoreError.value = false;
  }

  try {
    const res = await http.get<MyFeedbackListResponse>('/mm/Feedback/mine', {
      params: { page: targetPage, pageSize: PAGE_SIZE },
    });
    // 期间重新加载过：丢弃过期响应
    if (seq !== mySeq) return;

    const data: MyFeedbackListResponse = res.data ?? {};
    const list = Array.isArray(data.items) ? data.items : [];
    myItems.value = mode === 'more' ? myItems.value.concat(list) : list;
    myPage.value = targetPage;
    myTotal.value = Number(data.total) || 0;
    myError.value = false;
    myLoadMoreError.value = false;
  } catch (err) {
    if (seq !== mySeq) return;
    console.error('[feedback] 加载我的反馈失败', err);
    if (mode === 'more') {
      myLoadMoreError.value = true;
    } else if (mode === 'refresh') {
      // 下拉刷新失败：有旧列表就保留并只 toast；没有数据时回退到失败态
      if (myItems.value.length > 0) {
        toast('刷新失败，请稍后重试');
      } else {
        myError.value = true;
      }
    } else {
      myError.value = true;
    }
  } finally {
    if (seq === mySeq) {
      if (mode === 'more') {
        myLoadingMore.value = false;
      } else if (mode === 'refresh') {
        myRefreshing.value = false;
      } else {
        myLoading.value = false;
      }
      myLoadedOnce.value = true;
    }
  }
}

/** 失败态「重试」：重新拉第 1 页 */
function retryMyInitial(): void {
  if (myLoading.value) return;
  void loadMyFeedback('initial');
}

/** 加载更多失败：重试下一页 */
function retryMyLoadMore(): void {
  if (myLoading.value || myLoadingMore.value || myRefreshing.value) return;
  if (!myHasMore.value) return;
  void loadMyFeedback('more');
}

// ============================================================
// 管理员：「查看意见」筛选 + 列表 + 回复
// ============================================================

/** 当前状态筛选 */
const adminStatus = ref<AdminStatus>('all');
/** 当前来源筛选 */
const adminApp = ref<AdminApp>('all');
/** 关键词输入框草稿 */
const keywordInput = ref('');
/** 已生效的关键词（回车 / 点搜索后才更新，避免边输边请求） */
const appliedKeyword = ref('');

/** 管理员列表 */
const adminItems = ref<AdminFeedbackItemDto[]>([]);
/** 当前已加载到的页码 */
const adminPage = ref(1);
/** 当前筛选命中的总数 */
const adminTotal = ref(0);
/** 全部未删除反馈的待回复总数（tab 徽标） */
const adminPendingTotal = ref(0);
/** 全部未删除反馈的已回复总数（tab 徽标） */
const adminRepliedTotal = ref(0);
/** 首屏 / 筛选切换的整页加载中 */
const adminLoading = ref(false);
/** 触底加载下一页中 */
const adminLoadingMore = ref(false);
/** 下拉刷新中 */
const adminRefreshing = ref(false);
/** 首屏加载失败 */
const adminError = ref(false);
/** 加载更多失败 */
const adminLoadMoreError = ref(false);
/** 无权限（非管理员调用管理员接口返回 403）：展示提示而不是崩溃 */
const adminForbidden = ref(false);

/** 管理员列表请求序号：筛选变化 / 重新加载时自增，丢弃过期响应 */
let adminSeq = 0;

/** 每条反馈的回复草稿（按 id 存，已有回复预填，支持「更新回复」） */
const replyDrafts = ref<Record<number, string>>({});
/** 正在提交回复的反馈 id（同一时间只允许一条，避免并发重复回复） */
const replyingId = ref<number | null>(null);

/** 还有下一页可加载 */
const adminHasMore = computed(
  () => adminItems.value.length > 0 && adminItems.value.length < adminTotal.value,
);
/** 已全部加载完 */
const adminFinished = computed(
  () => adminItems.value.length > 0 && adminItems.value.length >= adminTotal.value,
);

/** 状态分段选项（带待回复 / 已回复数量徽标） */
const statusOptions = computed<Array<{ label: string; value: AdminStatus; count: number | null }>>(
  () => [
    { label: '全部', value: 'all', count: null },
    { label: '待回复', value: 'pending', count: adminPendingTotal.value },
    { label: '已回复', value: 'replied', count: adminRepliedTotal.value },
  ],
);

/** 来源分段选项 */
const appOptions: ReadonlyArray<{ label: string; value: AdminApp }> = [
  { label: '全部', value: 'all' },
  { label: '网页', value: 'web' },
  { label: '小程序', value: 'mp' },
];

/** 同步回复草稿：已有回复预填，避免用户看不到当前回复内容 */
function syncReplyDrafts(list: AdminFeedbackItemDto[], replace: boolean): void {
  const next: Record<number, string> = replace ? {} : { ...replyDrafts.value };
  for (const item of list) {
    if (next[item.id] === undefined) {
      next[item.id] = item.replyContent ?? '';
    }
  }
  replyDrafts.value = next;
}

/**
 * 加载管理员反馈列表指定页。
 * @param mode initial 首屏 / 筛选切换 / refresh 下拉刷新 / more 触底加载更多
 */
async function loadAdminFeedback(mode: LoadMode): Promise<void> {
  const seq = ++adminSeq;
  const targetPage = mode === 'more' ? adminPage.value + 1 : 1;

  if (mode === 'more') {
    adminLoadingMore.value = true;
    adminLoadMoreError.value = false;
  } else if (mode === 'refresh') {
    adminRefreshing.value = true;
    adminError.value = false;
  } else {
    adminLoading.value = true;
    adminError.value = false;
    adminLoadMoreError.value = false;
  }

  try {
    const res = await http.get<AdminFeedbackListResponse>('/mm/Feedback', {
      params: {
        page: targetPage,
        pageSize: PAGE_SIZE,
        status: adminStatus.value,
        keyword: appliedKeyword.value,
        app: adminApp.value,
      },
    });
    // 期间筛选变化 / 重新加载过：丢弃过期响应
    if (seq !== adminSeq) return;

    const data: AdminFeedbackListResponse = res.data ?? {};
    const list = Array.isArray(data.items) ? data.items : [];
    adminItems.value = mode === 'more' ? adminItems.value.concat(list) : list;
    adminPage.value = targetPage;
    adminTotal.value = Number(data.total) || 0;
    adminPendingTotal.value = Number(data.pendingTotal) || 0;
    adminRepliedTotal.value = Number(data.repliedTotal) || 0;
    adminForbidden.value = false;
    adminError.value = false;
    adminLoadMoreError.value = false;
    syncReplyDrafts(list, mode !== 'more');
  } catch (err) {
    if (seq !== adminSeq) return;
    const error = err as { statusCode?: number } | null;
    console.error('[feedback] 加载全部反馈失败', err);
    // 403 不是网络故障：展示无权限提示，不提供无意义的重试
    if (error?.statusCode === 403) {
      adminForbidden.value = true;
      adminItems.value = [];
      adminError.value = false;
      adminLoadMoreError.value = false;
      return;
    }
    if (mode === 'more') {
      adminLoadMoreError.value = true;
    } else if (mode === 'refresh') {
      if (adminItems.value.length > 0) {
        toast('刷新失败，请稍后重试');
      } else {
        adminError.value = true;
      }
    } else {
      adminError.value = true;
    }
  } finally {
    if (seq === adminSeq) {
      if (mode === 'more') {
        adminLoadingMore.value = false;
      } else if (mode === 'refresh') {
        adminRefreshing.value = false;
      } else {
        adminLoading.value = false;
      }
    }
  }
}

/** 筛选条件变化：清空列表并回到第 1 页重新加载（序号自增让在途请求失效） */
function reloadAdminFromFirstPage(): void {
  adminSeq += 1;
  adminItems.value = [];
  adminPage.value = 1;
  adminTotal.value = 0;
  adminError.value = false;
  adminLoadMoreError.value = false;
  adminForbidden.value = false;
  adminLoading.value = false;
  adminLoadingMore.value = false;
  adminRefreshing.value = false;
  replyDrafts.value = {};
  void loadAdminFeedback('initial');
}

/** 切换状态筛选 */
function switchAdminStatus(next: AdminStatus): void {
  if (next === adminStatus.value) return;
  adminStatus.value = next;
  reloadAdminFromFirstPage();
}

/** 切换来源筛选 */
function switchAdminApp(next: AdminApp): void {
  if (next === adminApp.value) return;
  adminApp.value = next;
  reloadAdminFromFirstPage();
}

/** 应用关键词（回车或点「搜索」触发；trim 后 ≤100） */
function applyKeyword(): void {
  const text = keywordInput.value.trim();
  if (text.length > MAX_KEYWORD) {
    toast(`关键词不能超过 ${MAX_KEYWORD} 个字符`);
    return;
  }
  appliedKeyword.value = text;
  reloadAdminFromFirstPage();
}

/** 管理员失败态「重试」 */
function retryAdminInitial(): void {
  if (adminLoading.value) return;
  void loadAdminFeedback('initial');
}

/** 管理员加载更多失败：重试下一页 */
function retryAdminLoadMore(): void {
  if (adminLoading.value || adminLoadingMore.value || adminRefreshing.value) return;
  if (!adminHasMore.value) return;
  void loadAdminFeedback('more');
}

/**
 * 提交 / 更新一条回复。
 * 成功后用接口返回的最新项局部替换该条，并同步待回复 / 已回复计数，避免整页重拉。
 */
async function submitReply(item: AdminFeedbackItemDto): Promise<void> {
  if (replyingId.value !== null) return;

  const draft = (replyDrafts.value[item.id] ?? '').trim();
  if (!draft) {
    toast('请输入回复内容');
    return;
  }
  if (draft.length > MAX_CONTENT) {
    toast(`回复内容不能超过 ${MAX_CONTENT} 个字符`);
    return;
  }

  const wasReplied = item.status === 'replied';
  replyingId.value = item.id;
  try {
    const res = await http.post<AdminFeedbackItemDto>(`/mm/Feedback/${item.id}/reply`, {
      replyContent: draft,
    });
    const updated = res.data;
    if (updated && typeof updated === 'object') {
      const index = adminItems.value.findIndex((it) => it.id === item.id);
      if (index >= 0) {
        // 保留原对象字段（例如用户身份信息）并用返回项覆盖状态 / 回复字段
        adminItems.value.splice(index, 1, { ...adminItems.value[index], ...updated });
      }
      replyDrafts.value[item.id] = updated.replyContent ?? draft;
      // 只在「待回复 → 已回复」时调整计数，重复回复（覆盖）不改总数
      if (!wasReplied) {
        adminPendingTotal.value = Math.max(adminPendingTotal.value - 1, 0);
        adminRepliedTotal.value += 1;
      }
      uni.showToast({ title: wasReplied ? '回复已更新' : '回复成功', icon: 'success' });
    } else {
      // 接口未返回数据时退化为重拉当前筛选的第 1 页，保证列表状态正确
      void loadAdminFeedback('refresh');
      uni.showToast({ title: '回复成功', icon: 'success' });
    }
  } catch (err) {
    console.error('[feedback] 回复反馈失败', err);
    toast(extractServerMessage(err) || '回复失败，请稍后重试');
  } finally {
    replyingId.value = null;
  }
}

// ============================================================
// 页面生命周期
// ============================================================

/** 首次 onShow 才拉数据，之后回到页面不重复拉（下拉刷新可手动更新） */
let firstShown = false;

/** 首次进入时可能还没拿到 role（旧缓存登录态）：先 await 拉 /me，再决定渲染哪套视图 */
async function bootstrap(): Promise<void> {
  if (!roleReady.value) {
    if (!authStore.user || !authStore.user.role) {
      await authStore.fetchUserInfo();
    }
    roleReady.value = true;
    syncNavBarTitle();
  }
  if (firstShown) return;
  firstShown = true;
  if (isAdmin.value) {
    void loadAdminFeedback('initial');
  } else {
    void loadMyFeedback('initial');
  }
}

onShow(() => {
  themeStore.updateNavBarColor();
  void bootstrap();
});

// 下拉刷新：重新拉当前角色的第 1 页（保留旧列表，完成后收起刷新动画）
onPullDownRefresh(() => {
  if (!roleReady.value) {
    uni.stopPullDownRefresh();
    return;
  }
  if (isAdmin.value) {
    if (adminLoading.value || adminRefreshing.value) {
      uni.stopPullDownRefresh();
      return;
    }
    void loadAdminFeedback('refresh').finally(() => {
      uni.stopPullDownRefresh();
    });
  } else {
    if (myLoading.value || myRefreshing.value) {
      uni.stopPullDownRefresh();
      return;
    }
    void loadMyFeedback('refresh').finally(() => {
      uni.stopPullDownRefresh();
    });
  }
});

// 触底加载下一页：加载中 / 已刷完 / 失败态都不再触发，避免无限请求
onReachBottom(() => {
  if (!roleReady.value) return;
  if (isAdmin.value) {
    if (adminLoading.value || adminLoadingMore.value || adminRefreshing.value) return;
    // 加载更多失败后不再自动重试，避免触底反复请求；由底部「点击重试」触发
    if (adminLoadMoreError.value || !adminHasMore.value) return;
    void loadAdminFeedback('more');
  } else {
    if (myLoading.value || myLoadingMore.value || myRefreshing.value) return;
    if (myLoadMoreError.value || !myHasMore.value) return;
    void loadMyFeedback('more');
  }
});
</script>

<template>
  <view class="page-container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：标题按角色切换（管理员「查看意见」/ 普通用户「意见反馈」） -->
    <MmNavBar :title="navTitle" />

    <!-- 角色未就绪：先展示骨架，避免两套视图来回闪 -->
    <view v-if="!roleReady" class="page-card skeleton-list">
      <view v-for="i in 2" :key="i" class="skeleton-row">
        <view class="skeleton-line skeleton-main"></view>
        <view class="skeleton-line skeleton-sub"></view>
        <view class="skeleton-line skeleton-sub short"></view>
      </view>
    </view>

    <!-- ==================== 管理员：查看意见 ==================== -->
    <template v-else-if="isAdmin">
      <text class="group-title">查看意见</text>
      <text class="page-subtitle">管理端可查看并回复用户提交的意见</text>

      <!-- 筛选栏：状态分段（带数量徽标）+ 来源分段 + 关键词搜索 -->
      <view class="page-card filter-card">
        <view class="scope-switch">
          <view
            v-for="option in statusOptions"
            :key="option.value"
            class="scope-option"
            :class="{ active: adminStatus === option.value }"
            hover-class="mm-hover"
            @click="switchAdminStatus(option.value)"
          >
            <text class="scope-text">{{ option.label }}</text>
            <text v-if="option.count !== null" class="scope-count">{{ option.count }}</text>
          </view>
        </view>

        <view class="scope-switch app-switch">
          <view
            v-for="option in appOptions"
            :key="option.value"
            class="scope-option"
            :class="{ active: adminApp === option.value }"
            hover-class="mm-hover"
            @click="switchAdminApp(option.value)"
          >
            <text class="scope-text">{{ option.label }}</text>
          </view>
        </view>

        <view class="keyword-row">
          <input
            class="input keyword-input"
            v-model="keywordInput"
            :maxlength="MAX_KEYWORD"
            placeholder="搜索内容 / 联系方式 / 用户"
            placeholder-class="input-placeholder"
            confirm-type="search"
            @confirm="applyKeyword"
          />
          <button class="btn-search" hover-class="mm-hover" @click="applyKeyword">搜索</button>
        </view>
      </view>

      <!-- 无权限（403）：管理员接口被非管理员调用时给出明确提示 -->
      <view v-if="adminForbidden" class="page-card state-card">
        <text class="state-title">无权查看全部意见</text>
        <text class="state-desc">仅管理员可以查看并回复用户反馈</text>
      </view>

      <!-- 首屏加载中：2 条骨架 -->
      <view v-else-if="adminLoading" class="page-card skeleton-list">
        <view v-for="i in 2" :key="i" class="skeleton-row">
          <view class="skeleton-line skeleton-main"></view>
          <view class="skeleton-line skeleton-sub"></view>
          <view class="skeleton-line skeleton-sub short"></view>
        </view>
      </view>

      <!-- 意见列表：一条反馈一张卡片 -->
      <view v-else-if="adminItems.length > 0" class="feedback-list">
        <view v-for="item in adminItems" :key="item.id" class="page-card feedback-item">
          <!-- 第一行：提交人身份 + userId -->
          <view class="item-head">
            <text class="admin-user">{{ adminUserLabel(item) }}</text>
            <text class="item-user-id">#{{ item.userId }}</text>
          </view>

          <!-- 第二行：状态 / 来源 / 提交时间 -->
          <view class="tag-row">
            <text class="status-tag" :class="item.status === 'replied' ? 'is-replied' : 'is-pending'">
              {{ statusLabel(item.status) }}
            </text>
            <text class="app-tag">{{ appLabel(item.app) }}</text>
            <text class="item-time">{{ formatLocalTime(item.createdAt) }}</text>
          </view>

          <text class="item-content">{{ item.content }}</text>
          <text v-if="item.contact" class="item-meta">联系方式：{{ item.contact }}</text>

          <!-- 已回复：展示当前回复内容与回复时间 -->
          <view v-if="item.status === 'replied' && item.replyContent" class="reply-block">
            <text class="reply-title">管理员回复</text>
            <text class="reply-content">{{ item.replyContent }}</text>
            <text v-if="item.repliedAt" class="reply-time">{{ formatLocalTime(item.repliedAt) }}</text>
          </view>

          <!-- 回复编辑区：未回复 →「回复」；已回复 →「更新回复」（覆盖） -->
          <view class="reply-editor">
            <textarea
              class="reply-textarea"
              v-model="replyDrafts[item.id]"
              :maxlength="MAX_CONTENT"
              :disabled="replyingId === item.id"
              placeholder="输入回复内容（2000 字以内）"
              placeholder-class="input-placeholder"
            />
            <button
              class="btn-reply"
              hover-class="mm-hover"
              :loading="replyingId === item.id"
              :disabled="replyingId === item.id"
              @click="submitReply(item)"
            >
              {{ item.status === 'replied' ? '更新回复' : '回复' }}
            </button>
          </view>
        </view>

        <!-- 底部加载状态：加载中 / 失败重试 / 没有更多了 -->
        <view class="list-footer">
          <text v-if="adminLoadingMore" class="footer-text">加载中…</text>
          <view
            v-else-if="adminLoadMoreError"
            class="footer-retry"
            hover-class="mm-hover"
            @click="retryAdminLoadMore"
          >
            <text class="footer-text">加载失败，点击重试</text>
          </view>
          <text v-else-if="adminFinished" class="footer-text">没有更多了</text>
        </view>
      </view>

      <!-- 失败态 -->
      <view v-else-if="adminError" class="page-card state-card">
        <text class="state-title">意见列表加载失败</text>
        <text class="state-desc">请检查网络后重试</text>
        <view class="retry-btn" hover-class="mm-hover" @click="retryAdminInitial">
          <text class="retry-text">重试</text>
        </view>
      </view>

      <!-- 空态：区分「无任何反馈」与「筛选无结果」 -->
      <view v-else class="page-card state-card">
        <text class="state-title">{{ appliedKeyword ? '没有找到匹配的反馈' : '暂无反馈' }}</text>
        <text class="state-desc">{{
          appliedKeyword ? '试试更换关键词或筛选条件' : '用户提交意见后会显示在这里'
        }}</text>
      </view>
    </template>

    <!-- ==================== 普通用户：提交 + 我的反馈 ==================== -->
    <template v-else>
      <text class="group-title">提交反馈</text>

      <!-- 表单白卡片：输入/文本域 44px 控件规范 + 主题色聚焦描边 -->
      <view class="page-card">
        <view class="form-field">
          <text class="label">反馈内容</text>
          <textarea
            class="textarea"
            v-model="feedbackContent"
            :maxlength="MAX_CONTENT"
            :disabled="submitting"
            placeholder="请描述您遇到的问题或改进建议..."
            placeholder-class="input-placeholder"
          />
          <view class="field-foot">
            <text class="field-hint">请尽量描述清楚问题或建议</text>
            <text class="counter">{{ feedbackContent.length }}/{{ MAX_CONTENT }}</text>
          </view>
        </view>

        <view class="form-field last-field">
          <text class="label">联系方式（可选）</text>
          <input
            class="input"
            v-model="feedbackContact"
            :maxlength="MAX_CONTACT"
            :disabled="submitting"
            placeholder="邮箱 / 手机号 / 微信号"
            placeholder-class="input-placeholder"
          />
        </view>
      </view>

      <view class="page-actions">
        <button
          class="btn-primary"
          hover-class="mm-hover"
          :loading="submitting"
          :disabled="submitting"
          @click="submitFeedback"
        >
          {{ submitting ? '提交中…' : '提交反馈' }}
        </button>
      </view>

      <view class="list-header">
        <text class="group-title">我的反馈</text>
        <text v-if="myLoadedOnce && !myLoading" class="summary">共 {{ myTotal }} 条</text>
      </view>

      <!-- 首屏加载中：2 条骨架 -->
      <view v-if="myLoading" class="page-card skeleton-list">
        <view v-for="i in 2" :key="i" class="skeleton-row">
          <view class="skeleton-line skeleton-main"></view>
          <view class="skeleton-line skeleton-sub"></view>
          <view class="skeleton-line skeleton-sub short"></view>
        </view>
      </view>

      <!-- 我的反馈列表：一条一张卡片 -->
      <view v-else-if="myItems.length > 0" class="feedback-list">
        <view v-for="item in myItems" :key="item.id" class="page-card feedback-item">
          <view class="tag-row">
            <text class="status-tag" :class="item.status === 'replied' ? 'is-replied' : 'is-pending'">
              {{ statusLabel(item.status) }}
            </text>
            <text class="app-tag">{{ appLabel(item.app) }}</text>
            <text class="item-time">{{ formatLocalTime(item.createdAt) }}</text>
          </view>

          <text class="item-content">{{ item.content }}</text>
          <text v-if="item.contact" class="item-meta">联系方式：{{ item.contact }}</text>

          <!-- 已回复：展示管理员回复内容与回复时间 -->
          <view v-if="item.status === 'replied' && item.replyContent" class="reply-block">
            <text class="reply-title">管理员回复</text>
            <text class="reply-content">{{ item.replyContent }}</text>
            <text v-if="item.repliedAt" class="reply-time">{{ formatLocalTime(item.repliedAt) }}</text>
          </view>
        </view>

        <!-- 底部加载状态：加载中 / 失败重试 / 没有更多了 -->
        <view class="list-footer">
          <text v-if="myLoadingMore" class="footer-text">加载中…</text>
          <view
            v-else-if="myLoadMoreError"
            class="footer-retry"
            hover-class="mm-hover"
            @click="retryMyLoadMore"
          >
            <text class="footer-text">加载失败，点击重试</text>
          </view>
          <text v-else-if="myFinished" class="footer-text">没有更多了</text>
        </view>
      </view>

      <!-- 失败态 -->
      <view v-else-if="myError" class="page-card state-card">
        <text class="state-title">我的反馈加载失败</text>
        <text class="state-desc">请检查网络后重试</text>
        <view class="retry-btn" hover-class="mm-hover" @click="retryMyInitial">
          <text class="retry-text">重试</text>
        </view>
      </view>

      <!-- 空态 -->
      <view v-else class="page-card state-card">
        <text class="state-title">还没有提交过反馈</text>
        <text class="state-desc">提交后可以在这里查看处理进度与管理员回复</text>
      </view>
    </template>
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

/* 分组标题行：左侧标题 + 右侧计数 */
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 4px 2px 8px;
}

.summary {
  font-size: 12px;
  color: var(--text-faint);
}

.page-subtitle {
  display: block;
  margin: 0 2px 10px;
  font-size: 12px;
  color: var(--text-faint);
}

.last-field {
  margin-bottom: 0;
}

/* 多行文本域：1px 描边 + 10 圆角，聚焦时主题色描边 */
.textarea {
  width: 100%;
  height: 150px;
  padding: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-color);
  box-sizing: border-box;
}

.textarea:focus,
.textarea:focus-within {
  border-color: var(--theme-primary);
}

/* 单行输入框聚焦描边（:focus-within 兼容 H5 的 uni-input 包裹层） */
.input:focus,
.input:focus-within {
  border-color: var(--theme-primary);
}

/* 文本域下方：提示 + 字数统计 */
.field-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
}

.field-hint {
  font-size: 12px;
  color: var(--text-faint);
}

.counter {
  font-size: 12px;
  color: var(--text-faint);
}

/* ---------- 管理员筛选栏 ---------- */
.filter-card {
  padding: 12px 16px;
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

.scope-switch + .scope-switch {
  margin-top: 10px;
}

.scope-option {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border-radius: 999px;
  box-sizing: border-box;
}

.scope-text {
  font-size: 12px;
  color: var(--text-muted);
}

/* 状态 tab 的数量徽标：选中态跟随强调色 */
.scope-count {
  margin-left: 4px;
  font-size: 11px;
  color: var(--text-faint);
}

.scope-option.active {
  background-color: var(--theme-color-soft);
}

.scope-option.active .scope-text {
  font-weight: 600;
  color: var(--theme-color-strong);
}

.scope-option.active .scope-count {
  font-weight: 600;
  color: var(--theme-color-strong);
}

/* 关键词搜索行 */
.keyword-row {
  display: flex;
  align-items: center;
  margin-top: 10px;
}

.keyword-input {
  flex: 1;
  min-width: 0;
}

.btn-search {
  flex-shrink: 0;
  width: 72px;
  height: 36px;
  margin: 0 0 0 8px;
  padding: 0;
  border-radius: 10px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.btn-search::after {
  border: none;
}

/* 输入框占位文案：统一弱化色 */
.input-placeholder {
  color: var(--text-faint);
  font-size: 14px;
}

/* ---------- 反馈列表 ---------- */

/* 一条反馈一张卡片：卡片之间留 10px 间距，不再共用一个白色卡片 */
.feedback-list {
  display: block;
}

.feedback-item {
  padding: 14px 16px;
  margin-bottom: 0;
}

.feedback-item + .feedback-item {
  margin-top: 10px;
}

/* 第一行：提交人身份（管理员视图）+ userId */
.item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.admin-user {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-user-id {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-faint);
}

/* 第二行：状态 tag + 来源 tag + 时间 */
.tag-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

/* 状态 tag：待回复 = warning 语义色，已回复 = success 语义色 */
.status-tag {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 999px;
}

.status-tag.is-pending {
  color: var(--color-warning-text);
  background-color: var(--color-warning-soft);
}

.status-tag.is-replied {
  color: var(--color-success-text);
  background-color: var(--color-success-soft);
}

/* 来源端小徽标 */
.app-tag {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 999px;
  color: var(--text-muted);
  background-color: var(--surface-soft);
}

.item-time {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-faint);
}

/* 反馈正文：换行 + 长词断行，避免溢出卡片 */
.item-content {
  display: block;
  font-size: 14px;
  line-height: 1.65;
  color: var(--text-color);
  word-break: break-word;
}

.item-meta {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-faint);
  word-break: break-word;
}

/* 管理员回复块：浅底 + 左侧强调色竖线，与正文区分 */
.reply-block {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background-color: var(--surface-soft);
  border-left: 3px solid var(--theme-color-muted);
  box-sizing: border-box;
}

.reply-title {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--theme-color-strong);
  margin-bottom: 4px;
}

.reply-content {
  display: block;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-color);
  word-break: break-word;
}

.reply-time {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-faint);
}

/* 回复编辑区：文本域 + 右侧按钮 */
.reply-editor {
  display: flex;
  align-items: stretch;
  margin-top: 10px;
}

.reply-textarea {
  flex: 1;
  min-width: 0;
  height: 72px;
  padding: 10px 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-color);
  box-sizing: border-box;
}

.reply-textarea:focus,
.reply-textarea:focus-within {
  border-color: var(--theme-primary);
}

.btn-reply {
  flex-shrink: 0;
  width: 84px;
  height: 72px;
  margin: 0 0 0 8px;
  padding: 0 8px;
  border-radius: 10px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.btn-reply::after {
  border: none;
}

.btn-reply[disabled] {
  opacity: 0.55;
}

/* ---------- 骨架屏 ---------- */
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
  animation: feedback-skeleton 1.5s infinite;
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

@keyframes feedback-skeleton {
  0% {
    transform: translateX(-100%);
  }

  100% {
    transform: translateX(100%);
  }
}

/* ---------- 空态 / 失败态卡片 ---------- */
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
