<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import http from '@/libs/http/config';
import { API_BASE_URL } from '@/config';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { notifySuccess, notifyError } from '@/utils/notification';
import MmNavBar from '@/components/MmNavBar.vue';

const authStore = useAuthStore();
const themeStore = useThemeStore();

const loading = ref(false);

onShow(async () => {
  themeStore.updateNavBarColor();
  await authStore.fetchUserInfo();
  // 获取第三方绑定信息
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

function handleNavigate(url: string) {
  uni.navigateTo({ url });
}

function handleViewAvatar() {
  if (authStore.user?.avatarKey) {
    const url = `${API_BASE_URL}/mm/Files/users/${authStore.user.userId}/${authStore.user.avatarKey}`;
    uni.previewImage({
      urls: [url],
      current: 0
    });
  }
}

function handleEditAvatar() {
  uni.showActionSheet({
    itemList: ['使用微信头像', '选择照片'],
    success: async (res) => {
      if (res.tapIndex === 0) {
        // WeChat Avatar
        // Since uni.getUserProfile is limited, we try to guide the user or use uni.chooseImage with special handling if possible.
        // However, standard practice now is often just letting them pick.
        // We will try a simple approach: Just fetch it? No, can't.
        // We will use uni.getUserProfile if available (deprecated but works in some contexts) or warn.
        // Actually, let's just use chooseImage/chooseMedia but maybe the user expects the "WeChat Avatar" button behavior.
        // Since we can't invoke that programmatically from ActionSheet, we might just try to use uni.getUserProfile to get the URL.
        // Note: As of 2022, getUserProfile returns grey avatar. 
        // Best approach for "WeChat Avatar" option in a custom UI without a specific button is tricky.
        // We'll treat it as a "Select from Album" but maybe user has saved it?
        // Let's implement the 'Select Photo' flow primarily, and for 'WeChat Avatar' maybe show a toast explaining they should select it from album if they can't authorize.
        // OR: We try `uni.getUserProfile` and if it works (old base lib) great.

        // Actually, let's try to just use uni.chooseImage for both but maybe with different source?
        // No.
        // Let's just implement "Select Photo" fully first as that covers "File Upload".
        // For "WeChat Avatar", if we are in MP-WEIXIN:
        // We can't easily get it.
        // I will implement a workaround: Provide a "Use WeChat Avatar" button that calls getUserProfile.
        // If it fails or returns placeholder, I'll alert the user.

        // #ifdef MP-WEIXIN
        uni.getUserProfile({
          desc: '用于完善会员资料',
          success: (profileRes) => {
            // profileRes.userInfo.avatarUrl might be temporary or grey.
            // If valid, we download it.
            const avatarUrl = profileRes.userInfo.avatarUrl;
            downloadAndUpload(avatarUrl);
          },
          fail: () => {
            // If fail, maybe they cancelled or not supported.
            uni.showToast({ title: '无法获取微信头像，请尝试文件上传', icon: 'none' });
          }
        });
        // #endif

        // #ifndef MP-WEIXIN
        uni.showToast({ title: '仅微信小程序支持', icon: 'none' });
        // #endif

      } else if (res.tapIndex === 1) {
        // Select Photo
        uni.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          sourceType: ['album', 'camera'],
          success: (chooseRes) => {
            const tempFilePaths = chooseRes.tempFilePaths;
            if (tempFilePaths.length > 0) {
              // Navigate to cropper
              uni.navigateTo({
                url: `/pages/common/cropper?src=${tempFilePaths[0]}`,
                events: {
                  cropSuccess: (data: any) => {
                    uploadFile(data.tempFilePath);
                  }
                }
              });
            }
          }
        });
      }
    }
  });
}

function downloadAndUpload(url: string) {
  uni.showLoading({ title: '上传中...' });
  uni.downloadFile({
    url: url,
    success: (res) => {
      if (res.statusCode === 200) {
        uploadFile(res.tempFilePath);
      } else {
        uni.hideLoading();
        notifyError('头像下载失败');
      }
    },
    fail: () => {
      uni.hideLoading();
      notifyError('头像下载失败');
    }
  });
}

function uploadFile(filePath: string) {
  loading.value = true;
  uni.uploadFile({
    url: `${API_BASE_URL}/mm/Files/avatar`,
    filePath: filePath,
    name: 'file',
    header: {
      'Authorization': `Bearer ${authStore.accessToken}`
    },
    success: (uploadRes) => {
      loading.value = false;
      uni.hideLoading(); // Just in case
      if (uploadRes.statusCode === 200) {
        try {
          const data = JSON.parse(uploadRes.data);
          const key = data.key;
          if (key && authStore.user?.userId) {
            // Update store
            authStore.updateUser({ avatarKey: key });
            notifySuccess('头像上传成功');
          } else {
            notifyError('头像上传失败: 无效的响应');
          }
        } catch (e) {
          notifyError('头像上传失败: 数据解析错误');
        }
      } else {
        notifyError('头像上传失败');
      }
    },
    fail: (err) => {
      loading.value = false;
      uni.hideLoading();
      notifyError('头像上传失败: 网络错误');
    }
  });
}

// Deprecated old handler, kept just in case but we use separate handlers now
async function handleAvatarClick() {
  handleEditAvatar();
}

// 注销逻辑已移至独立页面 /pages/profile/deactivate
</script>

<template>
  <view class="container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：根容器 padding-top = 16px（--page-pad），作为内容与顶栏之间的间距 -->
    <MmNavBar title="个人信息" />
    <NotificationSystem />

    <!-- 头像卡：白卡片 + 头像 fallback 用主题浅底 -->
    <view class="card profile-header">
      <view class="avatar-large">
        <image v-if="authStore.user?.avatarKey"
          :src="`${API_BASE_URL}/mm/Files/users/${authStore.user.userId}/${authStore.user.avatarKey}`"
          class="avatar-img" mode="aspectFill" @click.stop="handleViewAvatar" />
        <text v-else class="avatar-text-large" @click.stop="handleViewAvatar">{{ (authStore.user?.nickName ||
          authStore.user?.userAccount ||
          authStore.user?.email ||
          'U')[0].toUpperCase() }}</text>
        <view class="avatar-edit-overlay" hover-class="mm-hover" @click.stop="handleEditAvatar">
          <text class="edit-icon">✎</text>
        </view>
      </view>
      <text class="user-email">{{ authStore.user?.email }}</text>
    </view>

    <!-- 菜单列表：白卡片 + 分割线 + 右侧箭头，行高 ≥ 44px -->
    <view class="card">
      <view class="list-group">
        <view class="list-item" hover-class="mm-hover" @click="handleNavigate('/pages/profile/update-account')">
          <text class="item-label">账号</text>
          <view class="item-value">
            <text class="value-text">{{ authStore.user?.userAccount || '未设置' }}</text>
            <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
          </view>
        </view>
        <view class="list-item" hover-class="mm-hover" @click="handleNavigate('/pages/profile/update-nickname')">
          <text class="item-label">昵称</text>
          <view class="item-value">
            <text class="value-text">{{ authStore.user?.nickName || '未设置' }}</text>
            <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
          </view>
        </view>
        <view class="list-item" hover-class="mm-hover" @click="handleNavigate('/pages/profile/update-password')">
          <text class="item-label">修改密码</text>
          <view class="item-value">
            <text class="value-text">点击修改</text>
            <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
          </view>
        </view>
      </view>
    </view>

    <view class="card">
      <view class="list-group">
        <view class="list-item" hover-class="mm-hover" @click="handleNavigate('/pages/profile/third-party-binds')">
          <text class="item-label">第三方账号绑定</text>
          <view class="item-value">
            <text class="value-text">
              {{ authStore.user?.thirdPartyBindings?.length ? authStore.user.thirdPartyBindings.length + '个已绑定' : '未绑定'
              }}
            </text>
            <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
          </view>
        </view>
      </view>
    </view>

    <!-- 注销入口：danger 语义色 -->
    <view class="actions">
      <button class="btn-deactivate" hover-class="mm-hover" @click="handleNavigate('/pages/profile/deactivate')">注销账号</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* 页面容器：浅灰底 + 16px 内容边距，底部预留安全区 */
.container {
  min-height: 100vh;
  box-sizing: border-box;
  padding: var(--page-pad);
  padding-bottom: calc(var(--page-pad) + var(--safe-bottom));
  background-color: var(--bg-color);
  color: var(--text-color);
}

/* 通用卡片：白底 + 常规描边 + 12 圆角 + 卡片阴影 */
.card {
  margin-bottom: 12px;
  padding: 16px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

/* 头像卡 */
.profile-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px 20px;
}

/* 头像：fallback 底用主题浅底，1px 常规描边 */
.avatar-large {
  position: relative;
  width: 80px;
  height: 80px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--border-color);
  border-radius: 50%;
  box-shadow: var(--card-shadow);
}

.avatar-img {
  width: 100%;
  height: 100%;
}

/* fallback 文字：主题强调色，与浅底保持对比 */
.avatar-text-large {
  font-size: 30px;
  font-weight: 600;
  color: var(--theme-color-strong);
}

.avatar-edit-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--mask-color);
}

.edit-icon {
  margin-bottom: 2px;
  font-size: 13px;
  color: #ffffff;
}

.user-email {
  font-size: 13px;
  color: var(--text-muted);
}

/* 信息行 / 菜单项：分割线用 --divider-color，行高 ≥ 44px */
.list-group {
  display: flex;
  flex-direction: column;
}

.list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 44px;
  padding: 12px 0;
  border-bottom: 1px solid var(--divider-color);
}

.list-item:last-child {
  border-bottom: none;
}

.item-label {
  font-size: 15px;
  color: var(--text-color);
}

.item-value {
  display: flex;
  align-items: center;
  gap: 6px;
}

.value-text {
  font-size: 13px;
  color: var(--text-muted);
}

/* 右侧箭头图标保持原样，降低透明度不抢视线 */
.arrow-icon {
  width: 16px;
  height: 16px;
  opacity: 0.35;
}

.actions {
  margin-top: 20px;
}

/* 注销入口：danger 语义色（浅底 + 描边 + 深红字） */
.btn-deactivate {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: var(--control-h);
  background-color: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  border-radius: 10px;
  color: var(--color-danger-text);
  font-size: 14px;
  font-weight: 500;
}

.btn-deactivate::after {
  border: none;
}
</style>
