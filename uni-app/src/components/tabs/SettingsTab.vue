<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';
import { useThemeStore, PRESET_PALETTES } from '@/stores/theme';
import { API_BASE_URL } from '@/config';
import { computed, ref, reactive, watch } from 'vue';
import { useNavbar } from '@/utils/useNavbar';

const props = defineProps<{ isActive: boolean }>();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const { paddingTop, height, paddingLeft, navbarHeight } = useNavbar();
const isLoading = ref(true);

watch(() => props.isActive, async (newVal) => {
  if (newVal) {
    isLoading.value = true;
    try {
      await authStore.fetchUserInfo();
    } finally {
      isLoading.value = false;
    }
  }
}, { immediate: true });

const palettes = PRESET_PALETTES;

const isExpanded = ref(false);

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value;
};

function getActivePaletteIndex() {
  const idx = palettes.findIndex(p => isCurrentPalette(p.colors));
  return idx;
}

const itemHeight = 62; // px, matching the CSS padding + content

const listStyle = computed(() => {
  if (isExpanded.value) {
    return {
      transform: 'translateY(0)',
    };
  }
  const idx = getActivePaletteIndex();
  // If not found (custom), it's the item after presets (index = palettes.length)
  const offset = idx !== -1 ? idx : palettes.length;
  return {
    transform: `translateY(-${offset * itemHeight}px)`,
  };
});

const containerStyle = computed(() => {
  // Total items: presets (palettes.length) + custom (1) + collapse trigger (1)
  const totalItems = palettes.length + 2;
  const expandedHeight = totalItems * itemHeight;
  return {
    height: isExpanded.value ? `${expandedHeight}px` : `${itemHeight}px`,
  };
});

function handleSelectAndCollapse(colors: string[]) {
  handlePaletteSelect(colors);
  isExpanded.value = false;
}

// Custom Theme Logic
const customModalVisible = ref(false);
const customForm = reactive({
  colors: ['#8EA88E', '#B3C6AB', '#ECE7DA', '#F1F1EB'] // Default
});

function handleNavigateToProfile() {
  uni.navigateTo({
    url: '/pages/profile/index'
  });
}

function handlePaletteSelect(colors: string[]) {
  themeStore.setPalette(colors);
}

function openCustomTheme() {
  customForm.colors = [...themeStore.customColors];
  customModalVisible.value = true;
}

function applyCustomTheme() {
  themeStore.setCustomPalette([...customForm.colors]);
  themeStore.setPalette([...customForm.colors]);
  customModalVisible.value = false;
}

function handleCustomSelect() {
  if (isExpanded.value) {
    handleSelectAndCollapse(themeStore.customColors);
  } else {
    toggleExpand();
  }
}

function handleLogout() {
  uni.showModal({
    title: '退出登录',
    content: '确定要退出吗？',
    success: (res) => {
      if (res.confirm) {
        authStore.clear();
        uni.reLaunch({ url: '/pages/auth/index' });
      }
    }
  });
}

function navigateTo(path: string) {
  uni.navigateTo({ url: path });
}

function isCurrentPalette(pColors: string[]) {
  return JSON.stringify(pColors) === JSON.stringify(themeStore.currentColors);
}
</script>

<template>
  <view class="tab-content" :style="themeStore.themeStyle">

    <view class="tab-header-fixed"
      :style="{ paddingTop: paddingTop + 'px', paddingLeft: paddingLeft + 'px', paddingRight: paddingLeft + 'px' }">
      <view class="header-info-inner" :style="{ height: height + 'px' }">
        <text class="title">设置</text>
      </view>
    </view>

    <!-- 撑开固定头部的内容区域 -->
    <view :style="{ height: `calc(${navbarHeight}px - var(--uni-container-padding))` }"></view>

    <view class="settings-container">
      <!-- User Profile (Avatar + nickName) -->
      <view class="settings-group profile-group" :class="{ skeleton: isLoading }" @click="!isLoading && handleNavigateToProfile()">
        <view class="settings-item profile-item">
          <view class="item-left">
            <view class="avatar-container">
              <template v-if="isLoading">
                <view class="skeleton-avatar"></view>
              </template>
              <template v-else>
                <image v-if="authStore.user?.avatarKey"
                  :src="`${API_BASE_URL}/mm/Files/users/${authStore.user.userId}/${authStore.user.avatarKey}`"
                  class="avatar-img" mode="aspectFill" />
                <view v-else class="avatar-placeholder">
                  <text class="avatar-text">{{ (authStore.user?.nickName || authStore.user?.userAccount ||
                    'U')[0].toUpperCase() }}</text>
                </view>
              </template>
            </view>
            <view class="user-info">
              <template v-if="isLoading">
                <view class="skeleton-nickname"></view>
                <view class="skeleton-account"></view>
              </template>
              <template v-else>
                <text class="nickName">{{ authStore.user?.nickName || authStore.user?.userAccount || '未设置昵称' }}</text>
                <text class="userAccount">@{{ authStore.user?.userAccount || 'user' }}</text>
              </template>
            </view>
          </view>
          <view class="item-right" v-if="!isLoading">
            <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
          </view>
        </view>
      </view>

      <!-- Theme Color -->
      <view class="settings-section theme-section-container">
        <view class="theme-section">
          <view class="section-left">
            <text class="section-title">主题颜色</text>
          </view>
          <view class="section-right">
            <view class="palette-list" :class="{ expanded: isExpanded }">
              <view class="palette-viewport" :style="containerStyle">
                <view class="palette-inner" :style="listStyle">
                  <!-- Preset Palettes -->
                  <view v-for="(palette, idx) in palettes" :key="idx" class="palette-row"
                    @click="isExpanded ? handleSelectAndCollapse(palette.colors) : toggleExpand()">
                    <view class="row-content">
                      <view class="color-blocks">
                        <view v-for="(c, cIdx) in palette.colors" :key="cIdx" class="color-block"
                          :style="{ backgroundColor: c }"></view>
                      </view>
                    </view>
                    <view class="row-right">
                      <image v-if="isExpanded && isCurrentPalette(palette.colors)" class="check-mark-svg"
                        src="/static/svg/check_mark.svg" mode="aspectFit" />
                      <image v-if="!isExpanded" class="expand-arrow" src="/static/svg/turn-right.svg"
                        mode="aspectFit" />
                    </view>
                  </view>

                  <!-- Custom Option -->
                  <view class="palette-row" @click="handleCustomSelect">
                    <view class="row-content">
                      <view class="color-blocks custom-preview">
                        <view v-for="(c, cIdx) in themeStore.customColors" :key="cIdx" class="color-block"
                          :style="{ backgroundColor: c }"></view>
                      </view>

                      <image v-if="isExpanded" class="config-icon" src="/static/svg/colour_configuration.svg"
                        mode="aspectFit" @click.stop="openCustomTheme" />
                    </view>
                    <view class="row-right">
                      <image v-if="isExpanded && getActivePaletteIndex() === -1" class="check-mark-svg"
                        src="/static/svg/check_mark.svg" mode="aspectFit" />
                      <image v-if="!isExpanded" class="expand-arrow" src="/static/svg/turn-right.svg"
                        mode="aspectFit" />
                    </view>
                  </view>

                  <!-- Collapse Trigger at the bottom -->
                  <view v-if="isExpanded" class="collapse-trigger" @click.stop="toggleExpand">
                    <image class="expand-arrow up" src="/static/svg/turn-right.svg" mode="aspectFit" />
                  </view>
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- Functional Blocks -->
      <view class="settings-group">
        <view class="settings-item" @click="navigateTo('/pages/settings/changelog')">
          <text class="item-label">更新日志</text>
          <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
        </view>
        <view class="settings-item" @click="navigateTo('/pages/settings/reminders')">
          <text class="item-label">重要提醒</text>
          <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
        </view>
        <view class="settings-item" @click="navigateTo('/pages/settings/feedback')">
          <text class="item-label">意见反馈</text>
          <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
        </view>
        <view class="settings-item" @click="navigateTo('/pages/settings/privacy')">
          <text class="item-label">数据隐私</text>
          <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
        </view>
        <view class="settings-item" @click="navigateTo('/pages/settings/login-records')">
          <text class="item-label">登录记录</text>
          <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
        </view>
      </view>
    </view>

    <view class="actions">
      <button class="btn-logout" @click="handleLogout">退出登录</button>
    </view>

    <!-- Custom Theme Modal -->
    <view class="modal-mask" v-if="customModalVisible">
      <view class="modal-content">
        <view class="modal-header">自定义主题</view>
        <view class="modal-body">
          <view class="color-input-row" v-for="(c, idx) in customForm.colors" :key="idx">
            <text class="color-label">颜色 {{ idx + 1 }}</text>
            <input class="input-color-text" v-model="customForm.colors[idx]" placeholder="#RRGGBB" maxlength="7" />
            <view class="color-preview" :style="{ backgroundColor: customForm.colors[idx] }"></view>
          </view>
        </view>
        <view class="modal-footer">
          <button class="modal-btn cancel" @click="customModalVisible = false">取消</button>
          <button class="modal-btn confirm" @click="applyCustomTheme">应用</button>
        </view>
      </view>
    </view>

  </view>
</template>

<style scoped lang="scss">
.tab-content {
  padding: var(--uni-container-padding);
  box-sizing: border-box;
  background-color: var(--bg-color);
  min-height: 100vh;
}

.tab-header-fixed {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background-color: rgba(var(--bg-color), 0.01);
}

.header-info-inner {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  color: var(--text-color);
}

.title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
}

.settings-container {
  padding-bottom: 12px;
}


.profile-group {
  margin-top: 0;
}

.settings-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
  background-color: transparent;
}

.settings-item:last-child {
  border-bottom: none;
}

.settings-item:active {
  background-color: rgba(255, 255, 255, 0.2);
}

.item-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.item-icon {
  font-size: 20px;
}

.item-text {
  font-size: 16px;
  color: var(--text-color);
}

.arrow-icon {
  width: 16px;
  height: 16px;
  opacity: 0.3;
}

.settings-section {
  padding: 16px;
  background-color: transparent;
  border-bottom: 1px solid var(--border-color);
}

.profile-item {
  padding: 20px 16px;
}

.avatar-container {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  overflow: hidden;
  background-color: #eee;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 16px;
  border: 1px solid var(--border-color);
}

.avatar-img {
  width: 100%;
  height: 100%;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  background-color: var(--theme-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-text {
  font-size: 24px;
  color: #fff;
  font-weight: bold;
}

.user-info {
  display: flex;
  flex-direction: column;
}

.nickName {
  font-size: 18px;
  font-weight: bold;
  color: var(--text-color);
  margin-bottom: 4px;
}

.userAccount {
  font-size: 14px;
  color: var(--text-muted);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.theme-section-container {
  padding: 16px;
  background-color: var(--bg-soft);
  border-radius: 12px;
  margin: 12px 0;
  border: 1px solid var(--border-color);
}

.settings-group {
  background-color: var(--bg-soft);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

.settings-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
  background-color: transparent;
}

.settings-item:last-child {
  border-bottom: none;
}

.item-label {
  font-size: 16px;
  color: var(--text-color);
}

.theme-section {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  background-color: transparent;
  padding: 0;
}

.section-left {
  height: 62px;
  /* Same as row height */
  display: flex;
  align-items: center;
  white-space: nowrap;
  margin-right: 12px;
}

.section-right {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  /* Align list content to right */
}

.section-title {
  font-size: 14px;
  color: var(--text-muted);
  font-weight: bold;
}

.palette-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.palette-viewport {
  overflow: hidden;
  transition: height 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
}

.palette-inner {
  display: flex;
  flex-direction: column;
  gap: 0;
  transition: transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
}

.palette-row {
  display: flex;
  justify-content: flex-end;
  /* Align content to right */
  align-items: center;
  gap: 12px;
  height: 62px;
  box-sizing: border-box;
  background-color: transparent;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  /* Subtle divider */
  transition: background-color 0.2s;
}

.palette-row:last-child {
  border-bottom: none;
}

.palette-row:active {
  background-color: rgba(255, 255, 255, 0.1);
}

.row-content {
  display: flex;
  align-items: center;
}

.row-right {
  width: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.color-blocks {
  display: flex;
  gap: 8px;
}

.color-block {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.check-mark-svg {
  width: 20px;
  height: 20px;
  filter: opacity(0.6);
  /* Muted look */
}

.expand-arrow {
  width: 14px;
  height: 14px;
  opacity: 0.3;
  transition: transform 0.3s;
}

.expand-arrow.up {
  transform: rotate(-90deg);
}

.custom-text {
  font-size: 14px;
  color: var(--text-color);
  font-weight: 500;
}

.custom-preview {
  margin-right: 12px;
}

.custom-preview {
  margin-right: 8px;
}

.custom-text {
  font-size: 14px;
  color: var(--text-color);
  flex: 1;
}

.config-icon {
  width: 20px;
  height: 20px;
  margin-left: 8px;
  opacity: 0.6;
}

.config-icon:active {
  opacity: 1;
  transform: scale(1.1);
}

.collapse-trigger {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 62px;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}

.actions {
  margin-bottom: 80px;
}

.btn-logout {
  background-color: var(--bg-elevated);
  color: #fa5151;
  border-radius: 8px;
  font-size: 16px;
  height: 44px;
  line-height: 44px;
  border: 1px solid #e5e7eb;
  font-weight: 500;
  width: 100%;
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

.color-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-label {
  font-size: 14px;
  color: #666;
  width: 50px;
}

.input-color-text {
  flex: 1;
  height: 36px;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 0 8px;
  font-size: 14px;
}

.color-preview {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  border: 1px solid #eee;
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
  color: var(--theme-primary);
}

/* Skeleton Loader */
.skeleton {
  pointer-events: none;
  
  .skeleton-avatar {
    width: 100%;
    height: 100%;
    background: #f0f0f0;
    border-radius: 50%;
    position: relative;
    overflow: hidden;
    &::after {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
      animation: skeleton-loading 1.5s infinite;
    }
  }
  
  .skeleton-nickname {
    width: 120px;
    height: 20px;
    background: #f0f0f0;
    border-radius: 4px;
    margin-bottom: 8px;
    position: relative;
    overflow: hidden;
    &::after {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
      animation: skeleton-loading 1.5s infinite;
    }
  }
  
  .skeleton-account {
    width: 80px;
    height: 14px;
    background: #f5f5f5;
    border-radius: 4px;
  }
}

@keyframes skeleton-loading {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
</style>
