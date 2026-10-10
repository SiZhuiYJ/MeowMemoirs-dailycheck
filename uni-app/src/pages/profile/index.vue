<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import http from '@/libs/http/config';
import { API_BASE_URL } from '@/config';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { notifySuccess, notifyError } from '@/utils/notification';

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
    <NotificationSystem />

    <view class="profile-header">
      <view class="avatar-large">
        <image v-if="authStore.user?.avatarKey"
          :src="`${API_BASE_URL}/mm/Files/users/${authStore.user.userId}/${authStore.user.avatarKey}`"
          class="avatar-img" mode="aspectFill" @click.stop="handleViewAvatar" />
        <text v-else class="avatar-text-large" @click.stop="handleViewAvatar">{{ (authStore.user?.nickName ||
          authStore.user?.userAccount ||
          authStore.user?.email ||
          'U')[0].toUpperCase() }}</text>
        <view class="avatar-edit-overlay" @click.stop="handleEditAvatar">
          <text class="edit-icon">✎</text>
        </view>
      </view>
      <text class="user-email">{{ authStore.user?.email }}</text>
    </view>

    <view class="card">
      <view class="list-group">
        <view class="list-item" @click="handleNavigate('/pages/profile/update-account')">
          <text class="item-label">账号</text>
          <view class="item-value">
            <text class="value-text">{{ authStore.user?.userAccount || '未设置' }}</text>
            <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
          </view>
        </view>
        <view class="list-item" @click="handleNavigate('/pages/profile/update-nickname')">
          <text class="item-label">昵称</text>
          <view class="item-value">
            <text class="value-text">{{ authStore.user?.nickName || '未设置' }}</text>
            <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
          </view>
        </view>
        <view class="list-item" @click="handleNavigate('/pages/profile/update-password')">
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
        <view class="list-item" @click="handleNavigate('/pages/profile/third-party-binds')">
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

    <view class="actions">
      <button class="btn-deactivate" @click="handleNavigate('/pages/profile/deactivate')">注销账号</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.container {
  min-height: 100%;
  box-sizing: border-box;
  background-color: var(--bg-color);
  padding: var(--uni-container-padding);
}

.profile-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 24px;
  padding: 20px 0;
}

.avatar-large {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background-color: var(--theme-primary);
  /* Changed to theme primary */
  border: 2px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  /* Ensure image stays inside */
  position: relative;
}

.avatar-edit-overlay {
  position: absolute;
  bottom: 0;
  width: 100%;
  height: 24px;
  background-color: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}

.edit-icon {
  color: white;
  font-size: 14px;
  margin-bottom: 2px;
}

.avatar-img {
  width: 100%;
  height: 100%;
}

.avatar-text-large {
  font-size: 32px;
  font-weight: bold;
  color: #ffffff;
  /* White text on colored background */
}

.user-name {
  font-size: 20px;
  font-weight: bold;
  color: var(--text-color);
  margin-bottom: 4px;
}

.user-email {
  font-size: 14px;
  color: var(--text-muted);
}

.card {
  background-color: var(--bg-elevated);
  border-radius: var(--uni-card-border-radius);
  padding: var(--uni-card-padding);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  margin-bottom: var(--uni-card-margin-bottom);
}



.field {
  margin-bottom: 16px;
}

.field:last-child {
  margin-bottom: 0;
}

.label {
  display: block;
  font-size: 14px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.hint-text {
  display: block;
  font-size: 12px;
  color: #fa5151;
  margin-top: 4px;
}

.input {
  width: 100%;
  height: 44px;
  background-color: #f9fafb;
  /* Keep light input background or use a slightly darker one if needed, but #f9fafb is fine */
  border-radius: 8px;
  padding: 0 12px;
  font-size: 14px;
  color: #1f2937;
  box-sizing: border-box;
  border: 1px solid var(--border-color);
}

.list-group {
  display: flex;
  flex-direction: column;
}

.list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.1);
}

.list-item:last-child {
  border-bottom: none;
}

.item-label {
  font-size: 16px;
  color: var(--text-color);
}

.item-value {
  display: flex;
  align-items: center;
  gap: 8px;
}

.value-text {
  font-size: 14px;
  color: var(--text-muted);
}

.arrow-icon {
  width: 16px;
  height: 16px;
  opacity: 0.3;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.method-selector {
  display: flex;
  margin-bottom: 16px;
  background-color: #f3f4f6;
  padding: 4px;
  border-radius: 8px;
}

.method-tab {
  flex: 1;
  text-align: center;
  padding: 8px 0;
  font-size: 14px;
  color: #6b7280;
  border-radius: 6px;
  transition: all 0.2s;
}

.method-tab.active {
  background-color: #ffffff;
  color: #1f2937;
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.btn-save {
  background-color: var(--theme-primary);
  /* var(--accent-color) usually maps to green, making it explicit */
  color: var(--accent-on);
  border-radius: 8px;
  font-size: 16px;
  height: 44px;
  line-height: 44px;
  border: none;
  font-weight: 600;
}

/* Modal Styles */
.modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.modal-content {
  width: 80%;
  max-width: 320px;
  background-color: #ffffff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.modal-header {
  padding: 16px;
  text-align: center;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  border-bottom: 1px solid #e5e7eb;
}

.modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background-color: #ffffff;
}

.code-row {
  display: flex;
  gap: 8px;
}

.code-input {
  flex: 1;
}

.code-btn {
  width: 100px;
  height: 44px;
  line-height: 44px;
  text-align: center;
  padding: 0;
  font-size: 12px;
  background-color: #f9fafb;
  border: 1px solid #e5e7eb;
  color: #1f2937;
  border-radius: 8px;
}

.code-btn[disabled] {
  opacity: 0.6;
}

.code-btn::after {
  border: none;
}

.warning-text {
  font-size: 14px;
  color: #ef4444;
  line-height: 1.5;
}

.modal-footer {
  display: flex;
  border-top: 1px solid #e5e7eb;
  background-color: #ffffff;
}

.modal-btn {
  flex: 1;
  height: 48px;
  line-height: 48px;
  text-align: center;
  background-color: transparent;
  font-size: 16px;
  border-radius: 0;
}

.modal-btn::after {
  border: none;
}

.modal-btn.cancel {
  color: #6b7280;
  border-right: 1px solid #e5e7eb;
}

.modal-btn.confirm {
  color: var(--accent-color);
}

.modal-btn.danger {
  color: #ef4444;
}

.btn-deactivate {
  background-color: transparent;
  color: #fa5151;
  font-size: 14px;
  height: 40px;
  line-height: 40px;
  border: none;
  font-weight: 400;
  margin-top: 20px;
}

.btn-deactivate::after {
  border: none;
}
</style>
