<template>
  <view class="page-container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：page-container 顶部 padding 16px，作为内容与顶栏之间的间距 -->
    <MmNavBar title="第三方账号绑定" />
    <NotificationSystem />

    <!-- 绑定状态总览：一眼看清「到底绑没绑」，从本页返回个人主页也能看到同样的结论 -->
    <view class="page-card">
      <view class="form-field">
        <text class="label">绑定状态</text>
        <view class="status-row">
          <view class="status-dot" :class="{ 'status-dot-bound': boundLabels.length > 0 }"></view>
          <text class="status-text">{{ statusText }}</text>
        </view>
        <view class="desc">绑定后可使用对应平台快捷登录本账号；解绑不影响账号的其他功能。</view>
      </view>
    </view>

    <view class="page-card">
      <view class="form-field">
        <text class="label">第三方账号</text>
        <view class="desc">当前支持绑定微信一键登录，其他渠道后续开放。</view>
      </view>

      <view class="bind-list">
        <view class="bind-item" v-for="binding in visibleBindings" :key="binding.provider">
          <view class="bind-info">
            <image class="bind-icon" :src="binding.icon" mode="aspectFit" />
            <view class="bind-details">
              <text class="bind-name">{{ binding.name }}</text>
              <text class="bind-desc" :class="{ 'bind-desc-bound': hasProviderBind(binding.provider) }">
                {{ getBindingStatusText(binding.provider) }}
              </text>
            </view>
          </view>

          <!-- 已开放渠道：绑定 / 解绑（操作期间禁用并显示 loading，避免重复点击） -->
          <button v-if="isProviderAvailable(binding.provider)" class="bind-btn"
            :class="hasProviderBind(binding.provider) ? 'unbind-btn' : 'bind-btn-primary'"
            :loading="pendingProvider === binding.provider" :disabled="!!pendingProvider || confirming"
            hover-class="mm-hover" @click="binding.toggleBind(binding.name)">
            {{ pendingProvider === binding.provider
              ? (hasProviderBind(binding.provider) ? '解绑中' : '绑定中')
              : (hasProviderBind(binding.provider) ? '解绑' : '绑定') }}
          </button>
          <!-- 未开放渠道：明确标注不可操作，不再点了没反应 -->
          <view v-else class="bind-btn bind-btn-disabled">
            <text class="bind-btn-disabled-text">
              {{ hasProviderBind(binding.provider) ? '暂不支持' : '敬请期待' }}
            </text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import MmNavBar from '@/components/MmNavBar.vue';
import http from '@/libs/http/config';
import { notifySuccess, notifyError, notifyInfo } from '@/utils/notification';
import {
  formatThirdPartyBoundAt,
  getBoundThirdPartyLabels,
  normalizeThirdPartyBindings,
} from '@/utils/third-party';

const authStore = useAuthStore();
const themeStore = useThemeStore();

/** 只在微信小程序里开放微信绑定（其余渠道后端暂未提供绑定接口） */
const AVAILABLE_PROVIDERS = ['wechat'];

/** 正在绑定 / 解绑的渠道；有值时所有操作按钮禁用并显示 loading */
const pendingProvider = ref<string | null>(null);
/** 确认框展示中：防止快速连点弹出多个确认框 / 并发发起两次绑定 */
const confirming = ref(false);
/** 绑定状态是否正在同步（首次进入 / 手动刷新） */
const loading = ref(false);

interface thirdBinds {
  name: string;// 中文名
  provider: string;// 对应编号
  icon: string;// 图标路径
  toggleBind: (bindName: string) => void;// 绑定/解绑函数
}

// 绑定第三方映数组
const thirdPartyBindings = ref<thirdBinds[]>([
  {
    name: '微信',
    provider: 'wechat',
    icon: '/static/svg/appIcon/weixin.svg',
    toggleBind: toggleWechatBind
  }, {
    name: '百度',
    provider: 'baidu',
    icon: '/static/svg/appIcon/baidu.svg',
    toggleBind: toggleBind
  },
  {
    name: '爱奇艺',
    provider: 'aiqiyi',
    icon: '/static/svg/appIcon/aiqiyi.svg',
    toggleBind: toggleBind
  },
  {
    name: '百度贴吧',
    provider: 'baidutieba',
    icon: '/static/svg/appIcon/baidutieba.svg',
    toggleBind: toggleBind
  },
  {
    name: '哔哩哔哩',
    provider: 'bilibili',
    icon: '/static/svg/appIcon/bilibili.svg',
    toggleBind: toggleBind
  },
  {
    name: '钉钉',
    provider: 'dingding',
    icon: '/static/svg/appIcon/dingding.svg',
    toggleBind: toggleBind
  },
  {
    name: '豆瓣网站',
    provider: 'doubanwang',
    icon: '/static/svg/appIcon/doubanwang.svg',
    toggleBind: toggleBind
  },
  {
    name: '饿了么',
    provider: 'elemo',
    icon: '/static/svg/appIcon/elemo.svg',
    toggleBind: toggleBind
  },
  {
    name: 'Facebook',
    provider: 'facebook',
    icon: '/static/svg/appIcon/facebook.svg',
    toggleBind: toggleBind
  },
  {
    name: '公众号',
    provider: 'gongzhonghao',
    icon: '/static/svg/appIcon/gongzhonghao.svg',
    toggleBind: toggleBind
  },
  {
    name: '谷歌',
    provider: 'google',
    icon: '/static/svg/appIcon/google.svg',
    toggleBind: toggleBind
  },
  {
    name: '花瓣网',
    provider: 'huabanwang',
    icon: '/static/svg/appIcon/huabanwang.svg',
    toggleBind: toggleBind
  },
  {
    name: '快手',
    provider: 'kuaishou',
    icon: '/static/svg/appIcon/kuaishou.svg',
    toggleBind: toggleBind
  },
  {
    name: '酷狗音乐',
    provider: 'kugouyinle',
    icon: '/static/svg/appIcon/kugouyinle.svg',
    toggleBind: toggleBind
  },
  {
    name: 'LinkedIn',
    provider: 'linkedin',
    icon: '/static/svg/appIcon/linkedin.svg',
    toggleBind: toggleBind
  },
  {
    name: '美团',
    provider: 'meituan',
    icon: '/static/svg/appIcon/meituan.svg',
    toggleBind: toggleBind
  },
  {
    name: '陌陌',
    provider: 'momo',
    icon: '/static/svg/appIcon/momo.svg',
    toggleBind: toggleBind
  },
  {
    name: '企业微信',
    provider: 'qiyeweixin',
    icon: '/static/svg/appIcon/qiyeweixin.svg',
    toggleBind: toggleBind
  },
  {
    name: 'QQ音乐',
    provider: 'QQyinle',
    icon: '/static/svg/appIcon/QQyinle.svg',
    toggleBind: toggleBind
  },
  {
    name: '淘宝',
    provider: 'taobao',
    icon: '/static/svg/appIcon/taobao.svg',
    toggleBind: toggleBind
  },
  {
    name: '腾讯会议',
    provider: 'tengxunhuiyi',
    icon: '/static/svg/appIcon/tengxunhuiyi.svg',
    toggleBind: toggleBind
  },
  {
    name: '腾讯QQ',
    provider: 'tengxunQQ',
    icon: '/static/svg/appIcon/tengxunQQ.svg',
    toggleBind: toggleBind
  },
  {
    name: '腾讯视频',
    provider: 'tengxunshipin',
    icon: '/static/svg/appIcon/tengxunshipin.svg',
    toggleBind: toggleBind
  },
  {
    name: '腾讯微视',
    provider: 'tengxunweishi',
    icon: '/static/svg/appIcon/tengxunweishi.svg',
    toggleBind: toggleBind
  },
  {
    name: '推特',
    provider: 'twitter',
    icon: '/static/svg/appIcon/twitter.svg',
    toggleBind: toggleBind
  },
  {
    name: '网易云音乐',
    provider: 'wangyiyunyinle',
    icon: '/static/svg/appIcon/wangyiyunyinle.svg',
    toggleBind: toggleBind
  },
  {
    name: '小红书',
    provider: 'xiaohongshu',
    icon: '/static/svg/appIcon/xiaohongshu.svg',
    toggleBind: toggleBind
  },
  {
    name: '新浪微博',
    provider: 'xinlang',
    icon: '/static/svg/appIcon/xinlang.svg',
    toggleBind: toggleBind
  },
  {
    name: 'YouTube',
    provider: 'youtube',
    icon: '/static/svg/appIcon/youtube.svg',
    toggleBind: toggleBind
  },
  {
    name: '支付宝',
    provider: 'zhifubao',
    icon: '/static/svg/appIcon/zhifubao.svg',
    toggleBind: toggleBind
  },
  {
    name: '知乎',
    provider: 'zhihu',
    icon: '/static/svg/appIcon/zhihu.svg',
    toggleBind: toggleBind
  },

]);

/** 当前已绑定的渠道列表（统一从 store 解析，兼容后端字段大小写） */
const boundBindings = computed(() => normalizeThirdPartyBindings(authStore.user?.thirdPartyBindings));
/** 已绑定渠道的中文名，用于状态总览 */
const boundLabels = computed(() => getBoundThirdPartyLabels(authStore.user?.thirdPartyBindings));
/** 状态总览文案：正在同步 / 已绑定哪些 / 尚未绑定 */
const statusText = computed(() => {
  if (loading.value) return '正在同步绑定状态…';
  return boundLabels.value.length ? `已绑定：${boundLabels.value.join('、')}` : '尚未绑定第三方账号';
});

/**
 * 页面上实际展示的渠道：只显示已开放的（微信）和历史上已经绑定的渠道。
 * 其余渠道后端还没有绑定接口，全部列出来只会制造「点了没反应」的困惑。
 */
const visibleBindings = computed(() =>
  thirdPartyBindings.value.filter(
    (binding) => isProviderAvailable(binding.provider) || hasProviderBind(binding.provider),
  ),
);

onShow(async () => {
  themeStore.updateNavBarColor();
  // 每次进入 / 返回都重新拉取，避免显示上一次的旧状态
  await fetchThirdPartyBindings(true);
});

/**
 * 拉取第三方绑定状态
 * @param silent 静默模式：自动刷新失败时只打日志，不打扰用户（手动操作失败才提示）
 */
async function fetchThirdPartyBindings(silent = false) {
  loading.value = true;
  try {
    const res = await http.get('/mm/Auth/bindings');
    if (res.statusCode === 200) {
      authStore.updateUser({
        thirdPartyBindings: normalizeThirdPartyBindings(res.data),
      });
    }
  } catch (error) {
    console.error('获取第三方绑定信息失败:', error);
    if (!silent) notifyError('绑定状态获取失败，请稍后重试');
  } finally {
    loading.value = false;
  }
}

/** 检查特定提供商是否已绑定 */
function hasProviderBind(provider: string) {
  return boundBindings.value.some((binding) => binding.provider === provider);
}

/** 获取特定提供商的绑定日期（后端返回完整时间戳，这里统一格式化为 YYYY-MM-DD） */
function getBindingDate(provider: string) {
  const binding = boundBindings.value.find((item) => item.provider === provider);
  return formatThirdPartyBoundAt(binding?.boundAt);
}

/** 列表里每行的状态文案 */
function getBindingStatusText(provider: string): string {
  if (hasProviderBind(provider)) {
    const date = getBindingDate(provider);
    return date ? `已绑定 · ${date}` : '已绑定';
  }
  return isProviderAvailable(provider) ? '未绑定' : '暂未开放';
}

/** 该渠道是否已开放绑定 */
function isProviderAvailable(provider: string): boolean {
  return AVAILABLE_PROVIDERS.includes(provider);
}

/** 绑定 / 解绑的二次确认（uni.showModal 回调转 Promise，失败按取消处理） */
function showConfirm(title: string, content: string, confirmText: string): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      confirmText,
      cancelText: '取消',
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    });
  });
}

/** 从请求错误里提取服务端文案（后端业务错误常返回纯文本） */
function extractServerMessage(error: any): string {
  const data = error?.data;
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (data && typeof data.message === 'string' && data.message.trim()) return data.message.trim();
  return '';
}

/** 检查是否在微信环境中 */
function hasWechatEnv() {
  // #ifdef MP-WEIXIN
  return true;
  // #endif
  return false;
}

// 处理微信绑定/解绑
async function toggleWechatBind() {
  // confirming 在确认框弹出前置位：避免快速连点弹两次确认框 / 并发发起两次绑定
  if (pendingProvider.value || confirming.value) return;

  confirming.value = true;
  try {
    if (hasProviderBind('wechat')) {
      await unbindWechat();
    } else {
      await bindWechat();
    }
  } finally {
    confirming.value = false;
  }
}

// 绑定微信
async function bindWechat() {
  if (!hasWechatEnv()) {
    notifyError('请在微信小程序中使用此功能');
    return;
  }

  const confirmed = await showConfirm(
    '绑定微信',
    '将当前微信账号绑定到本账号后，可直接使用微信一键登录，是否继续？',
    '绑定',
  );
  if (!confirmed) return;

  pendingProvider.value = 'wechat';
  // 原生 loading 遮罩：点击后立即有反馈，同时防止连点重复发起授权
  uni.showLoading({ title: '绑定中…', mask: true });
  let succeeded = false;
  try {
    // #ifdef MP-WEIXIN
    const loginRes: any = await Promise.race([
      new Promise((resolve, reject) => {
        uni.login({
          provider: 'weixin',
          success: resolve,
          fail: reject,
        });
      }),
      // 兜底：uni.login 回调异常不触发时，最多等 10s 就结束 loading 并提示失败
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('微信授权超时，请重试')), 10000);
      }),
    ]);

    if (!loginRes?.code) {
      throw new Error('未获取到微信授权凭证，请重试');
    }

    // 401 在这里表示「微信授权失败」而不是登录态失效，跳过自动刷新，
    // 否则会把同一个一次性 code 反复消费、错误信息也会变得难以理解。
    // retryCount: 0 避免网络抖动时重放同一个 code；timeout 保证不会无限等待。
    await http.post('/mm/Auth/wechat/bind', { code: loginRes.code }, {
      skipAuthRefresh: true,
      retryCount: 0,
      timeout: 15000,
    });
    // #endif
    succeeded = true;
  } catch (error: any) {
    handleBindError(error);
  } finally {
    uni.hideLoading();
    pendingProvider.value = null;
  }

  if (!succeeded) return;

  // 成功后的本地状态更新与提示放在网络请求之外：即使本地存储异常，也不会把「已绑定成功」误报成失败
  try {
    upsertLocalBinding('wechat');
  } catch (storageError) {
    console.error('本地记录微信绑定状态失败:', storageError);
  }
  notifySuccess('微信绑定成功');
  // 后台再与服务端同步一次（失败也不影响本地呈现）
  void fetchThirdPartyBindings(true);
}

// 解绑微信
async function unbindWechat() {
  const confirmed = await showConfirm(
    '确认解绑',
    '解绑后将无法使用微信一键登录，确定要解绑吗？',
    '确定解绑',
  );
  if (!confirmed) return;

  pendingProvider.value = 'wechat';
  uni.showLoading({ title: '解绑中…', mask: true });
  let succeeded = false;
  try {
    // 解绑不消费一次性凭证，保留 401 自动刷新；retryCount: 0 避免 DELETE 重试把 404 变成报错
    await http.delete('/mm/Auth/wechat/unbind', {
      retryCount: 0,
      timeout: 15000,
    });
    succeeded = true;
  } catch (error: any) {
    handleUnbindError(error);
  } finally {
    uni.hideLoading();
    pendingProvider.value = null;
  }

  if (!succeeded) return;

  try {
    removeLocalBinding('wechat');
  } catch (storageError) {
    console.error('本地清理微信绑定状态失败:', storageError);
  }
  notifySuccess('微信解绑成功');
  void fetchThirdPartyBindings(true);
}

/** 本地标记已绑定：让页面状态立即更新（服务端同步在后台进行） */
function upsertLocalBinding(provider: string) {
  const others = normalizeThirdPartyBindings(authStore.user?.thirdPartyBindings)
    .filter((item) => item.provider !== provider)
    .map((item) => ({ provider: item.provider, boundAt: item.boundAt ?? '', isBound: item.isBound !== false }));
  others.push({ provider, boundAt: new Date().toISOString(), isBound: true });
  authStore.updateUser({ thirdPartyBindings: others });
}

/** 本地移除绑定：让页面状态立即更新 */
function removeLocalBinding(provider: string) {
  const rest = normalizeThirdPartyBindings(authStore.user?.thirdPartyBindings)
    .filter((item) => item.provider !== provider)
    .map((item) => ({ provider: item.provider, boundAt: item.boundAt ?? '', isBound: item.isBound !== false }));
  authStore.updateUser({ thirdPartyBindings: rest });
}

/** 绑定失败：把不同状态码翻译成用户能看懂的提示，保证「一定有反馈」 */
function handleBindError(error: any) {
  console.error('绑定微信失败:', error);
  const status = error?.statusCode;
  const serverMessage = extractServerMessage(error);

  if (status === 409) {
    notifyError(serverMessage || '该微信已绑定其他账号，请先解绑后再试');
    // 本地状态可能已过期（比如在另一台设备绑过），重新拉取让按钮回到真实状态
    void fetchThirdPartyBindings(true);
  } else if (status === 401) {
    // bind 的 401 有两种来源：微信 code2session 失败（后端带 body 文案）或登录态过期（中间件 401、body 为空）。
    // 有 body 就展示服务端原因方便排查；没有 body 则提示重新进入页面触发登录态刷新。
    if (!serverMessage) {
      notifyError('登录状态可能已过期，请返回个人主页重新进入后再试');
    } else {
      notifyError(`微信授权失败：${serverMessage}`);
    }
  } else if (status === 400) {
    notifyError(serverMessage || '微信授权凭证无效，请重试');
  } else if (!status) {
    const fallback = error?.errMsg
      ? '微信授权失败，请重试'
      : (String(error?.message || '') || '绑定失败，请稍后重试');
    notifyError(serverMessage || fallback);
  } else {
    notifyError(serverMessage || '绑定失败，请稍后重试');
  }
}

/** 解绑失败提示 */
function handleUnbindError(error: any) {
  console.error('解绑微信失败:', error);
  const status = error?.statusCode;
  const serverMessage = extractServerMessage(error);

  if (status === 401) {
    notifyError(serverMessage || '登录已过期，请重新登录');
  } else if (status === 404) {
    notifyError(serverMessage || '当前尚未绑定微信');
    void fetchThirdPartyBindings(true);
  } else if (!status) {
    notifyError('网络异常，请检查网络后重试');
  } else {
    notifyError(serverMessage || '解绑失败，请稍后重试');
  }
}

// 暂未开放的渠道：给明确提示，不再假装成功
function toggleBind(bindName: string) {
  notifyInfo(`${bindName}绑定功能暂未开放，敬请期待`);
}
</script>

<style scoped lang="scss">
@use "@/styles/page-layouts.scss";

/* 卡片头部说明 */
.desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
}

/* 绑定状态总览：小圆点 + 文案，一眼看清是否已绑定 */
.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--text-faint);
}

.status-dot-bound {
  background-color: var(--color-success);
}

.status-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
}

.bind-list {
  margin-top: 12px;
}

.bind-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 44px;
  padding: 12px 0;
  /* 统一列表分割线 token（不再写死半透明黑） */
  border-bottom: 1px solid var(--divider-color);

  &:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
}

.bind-info {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

/* 图标：次级底 + 1px 描边 + 10 圆角 */
.bind-icon {
  width: 40px;
  height: 40px;
  margin-right: 12px;
  border-radius: 10px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  box-sizing: border-box;
}

.bind-details {
  flex: 1;
  min-width: 0;
}

.bind-name {
  display: block;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 2px;
}

.bind-desc {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
}

/* 已绑定的行用成功语义色强调 */
.bind-desc-bound {
  color: var(--color-success-text);
}

/* 行内按钮：36px 高（列表内按钮按规范 36–40px）+ 10 圆角 */
.bind-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  margin-left: 12px;
  box-sizing: border-box;
}

/* 操作中禁用态：降低不透明度，避免误以为可继续点 */
.bind-btn[disabled] {
  opacity: 0.6;
}

/* 绑定：次按钮（主题浅底 + 描边 + 强调色文字） */
.bind-btn-primary {
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
}

/* 解绑：危险按钮（danger soft 底 + danger 描边 + danger 文字） */
.unbind-btn {
  background-color: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  color: var(--color-danger-text);
}

/* 未开放渠道：中性灰占位，明确表示暂不可操作 */
.bind-btn-disabled {
  background-color: var(--surface-soft);
  border: 1px solid var(--divider-color);
}

.bind-btn-disabled-text {
  font-size: 12px;
  color: var(--text-faint);
}
</style>
