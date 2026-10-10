<template>
  <view class="page-container" :style="themeStore.themeStyle">
    <NotificationSystem />

    <view class="page-card">
      <view class="form-field">
        <text class="label">第三方账号绑定</text>
        <view class="desc">管理您绑定的第三方账号，用于便捷登录</view>
      </view>

      <view class="bind-list">
        <view class="bind-item" v-for="binding in thirdPartyBindings" :key="binding.provider">
          <view class="bind-info">
            <image class="bind-icon" :src="binding.icon" mode="aspectFit" />
            <view class="bind-details">
              <text class="bind-name">{{ binding.name }}</text>
              <text class="bind-desc">
                {{ hasProviderBind(binding.provider) ? '已绑定，' +
                  toLocalDateOnlyString(parseDateOnly(getBindingDate(binding.provider)!))
                  : '未绑定' }}
              </text>
            </view>
          </view>
          <button class="bind-btn" :class="hasProviderBind(binding.provider) ? 'unbind-btn' : 'bind-btn-primary'"
            @click="binding.toggleBind(binding.name)">
            {{ hasProviderBind(binding.provider) ? '解绑' : '绑定' }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import http from '@/libs/http/config';
import { notifySuccess, notifyError } from '@/utils/notification';
import { toLocalDateOnlyString, parseDateOnly } from "@/utils/date";

const authStore = useAuthStore();
const themeStore = useThemeStore();
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

onShow(async () => {
  themeStore.updateNavBarColor();
  // 获取最新的第三方绑定信息
  await fetchThirdPartyBindings();
});

// 获取第三方绑定信息
async function fetchThirdPartyBindings() {
  try {
    const res = await http.get('/mm/Auth/bindings');
    if (res.statusCode === 200 && res.data) {
      // 更新用户信息中的第三方绑定数据
      authStore.updateUser({
        thirdPartyBindings: res.data.bindings || []
      });
    }
  } catch (error) {
    console.error('Failed to fetch third party bindings', error);
  }
}

// 检查特定提供商是否已绑定
function hasProviderBind(provider: string) {
  return authStore.user?.thirdPartyBindings?.some((binding: any) => binding.provider === provider) || false;
}

// 获取特定提供商的绑定日期
function getBindingDate(provider: string) {
  const binding = authStore.user?.thirdPartyBindings?.find((binding: any) => binding.provider === provider);
  return binding ? binding.boundAt : null;
}

// 处理微信绑定/解绑
async function toggleWechatBind() {
  if (hasProviderBind('wechat')) {
    // 解绑微信
    uni.showModal({
      title: '确认解绑',
      content: '解绑后将无法使用微信一键登录，确定要解绑吗？',
      confirmText: '确定解绑',
      cancelText: '取消',
      success: async (modalRes) => {
        if (modalRes.confirm) {
          try {
            await http.delete('/mm/Auth/wechat/unbind');
            notifySuccess('微信解绑成功');

            // 更新用户信息
            await authStore.fetchUserInfo();
          } catch (error: any) {
            console.error('解绑微信失败:', error);

            if (error.statusCode === 401) {
              notifyError('用户未登录或登录已过期');
            } else if (error.statusCode === 404) {
              notifyError('当前用户未绑定微信账号');
            } else {
              notifyError(error.data?.message || '解绑失败，请稍后重试');
            }
          }
        }
      }
    });
  } else {
    // 绑定微信
    if (hasWechatEnv()) {
      await bindWechat();
    } else {
      notifyError('请在微信小程序环境中使用此功能');
    }
  }
  // 更新绑定信息
  fetchThirdPartyBindings();
}

// 检查是否在微信环境中
function hasWechatEnv() {
  // #ifdef MP-WEIXIN
  return true;
  // #endif
  return false;
}

// 绑定微信
async function bindWechat() {
  try {
    // #ifdef MP-WEIXIN
    const loginRes: any = await new Promise((resolve, reject) => {
      uni.login({
        provider: 'weixin',
        success: resolve,
        fail: reject
      });
    });

    if (!loginRes.code) {
      throw new Error('获取微信登录凭证失败');
    }

    await http.post('/mm/Auth/wechat/bind', {
      code: loginRes.code
    });

    notifySuccess('微信绑定成功');

    // 更新用户信息
    await authStore.fetchUserInfo();
    // #endif

    // #ifndef MP-WEIXIN
    notifyError('请在微信小程序环境中使用此功能');
    // #endif
  } catch (error: any) {
    console.error('绑定微信失败:', error);

    if (error.statusCode === 409) {
      notifyError(error.data?.message || '绑定失败：微信账号已被绑定');
    } else if (error.statusCode === 401) {
      notifyError('用户未登录或登录已过期，请重新登录');
    } else {
      notifyError(error.data?.message || '绑定失败，请稍后重试');
    }
  }
}
// 处理百度绑定/解绑
async function toggleBind(bindName: string) {
  console.log(`${bindName}绑定/解绑功能待实现`);
  notifySuccess(`${bindName}绑定功能待实现`);
  if (hasProviderBind(bindName)) {

  }
}
</script>

<style scoped lang="scss">
@use "@/styles/page-layouts.scss";

.bind-list {
  margin-top: 20px;
}

.bind-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.1);

  &:last-child {
    border-bottom: none;
  }
}

.bind-info {
  display: flex;
  align-items: center;
  flex: 1;
}

.bind-icon {
  width: 40px;
  height: 40px;
  margin-right: 12px;
  border-radius: 8px;
}

.bind-details {
  flex: 1;
}

.bind-name {
  display: block;
  font-size: 16px;
  color: var(--text-color);
  margin-bottom: 4px;
}

.bind-desc {
  display: block;
  font-size: 14px;
  color: var(--text-muted);
}

.bind-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  border: none;
  margin-left: 16px;
}

.bind-btn-primary {
  background-color: var(--theme-primary);
  color: white;
}

.unbind-btn {
  background-color: #f0f0f0;
  color: #ff4757;
}

.desc {
  font-size: 14px;
  color: var(--text-muted);
  margin-top: 8px;
}
</style>