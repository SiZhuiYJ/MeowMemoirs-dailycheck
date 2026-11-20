<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';
import { useThemeStore, PRESET_SEEDS, normalizeHexColor } from '@/stores/theme';
import { apiBase, thumbnailUrl } from '@/libs/http/apiBase';
import { computed, ref, watch } from 'vue';
import MmNavBar from '@/components/MmNavBar.vue';
import MmLazyImage from '@/components/MmLazyImage.vue';

const props = defineProps<{ isActive: boolean }>();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const isLoading = ref(true);

/** 当前用户头像地址 */
const avatarUrl = computed(() => {
  const user = authStore.user;
  return user?.avatarKey ? `${apiBase.value}/mm/Files/users/${user.userId}/${user.avatarKey}` : '';
});

/** 头像缩略占位图（服务端 96px _thumb；不存在时后端回退原图） */
const avatarThumbUrl = computed(() => thumbnailUrl(avatarUrl.value));

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

// —— 主题设置（单色风格：用户只选一个「强调色」种子，其余色阶自动推导）——

/** 预设强调色是否处于选中态（currentSeed 已是归一化小写 hex）。 */
function isSeedActive(seed: string): boolean {
  return themeStore.currentSeed === seed;
}

/** 点击预设圆点：切换强调色种子。 */
function handleSelectSeed(seed: string) {
  if (!themeStore.setSeed(seed)) {
    uni.showToast({ title: '颜色应用失败，请重试', icon: 'none' });
  }
}

// 自定义强调色输入（#RRGGBB）
const customSeed = ref(themeStore.currentSeed);

/** 输入框左侧色块预览：合法时显示当前输入色，非法时回退到浅色底。 */
const customPreviewStyle = computed(() => ({
  backgroundColor: normalizeHexColor(customSeed.value) ?? 'var(--surface-soft)',
}));

/**
 * 深色模式开关：switch 的 change 事件在 uni 类型里是原生 Event、没有 detail，
 * 这里用 any 取 detail.value，避免 vue-tsc 报 TS2339。
 */
function handleDarkModeChange(event: any) {
  themeStore.setDarkMode(!!event?.detail?.value);
}

/** 主题设置是否展开（默认收起，只显示当前强调色摘要，点击标题行展开）。 */
const themeExpanded = ref(false);

function toggleThemeExpanded() {
  themeExpanded.value = !themeExpanded.value;
}

/** 应用自定义强调色：先归一并校验 hex，非法值给出 toast 提示。 */
function applyCustomSeed() {
  const normalized = normalizeHexColor(customSeed.value);
  if (!normalized) {
    uni.showToast({ title: '请输入正确的颜色值，如 #e3c0df', icon: 'none' });
    return;
  }
  if (!themeStore.setSeed(normalized)) {
    uni.showToast({ title: '颜色应用失败，请重试', icon: 'none' });
    return;
  }
  customSeed.value = normalized;
  uni.showToast({ title: '已应用自定义颜色', icon: 'none' });
}

// 功能菜单（顺序与改版前保持一致）
// 「意见反馈」按角色改文案：管理员进入的是「查看意见」页（同一路径，页面内部按 isAdmin 切换视图）
const menuItems = computed(() => [
  { label: '更新日志', path: '/pages/settings/changelog' },
  { label: '重要提醒', path: '/pages/settings/reminders' },
  { label: authStore.isAdmin ? '查看意见' : '意见反馈', path: '/pages/settings/feedback' },
  { label: '数据隐私', path: '/pages/settings/privacy' },
  { label: '登录记录', path: '/pages/settings/login-records' },
]);

function handleNavigateToProfile() {
  uni.navigateTo({
    url: '/pages/profile/index'
  });
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
</script>

<template>
  <view class="tab-content" :style="themeStore.themeStyle">

    <!-- 毛玻璃顶栏：内容与顶栏之间保留 16px 间距（tab-content 顶部内边距） -->
    <MmNavBar title="设置" :show-back="false" align="left" />

    <view class="settings-container">
      <!-- 账号卡片：白卡片 + 轻描边 + 轻阴影，点击进入个人主页 -->
      <view class="mm-card profile-card" :class="{ skeleton: isLoading }" hover-class="mm-hover"
        @click="!isLoading && handleNavigateToProfile()">
        <view class="profile-item">
          <view class="item-left">
            <view class="avatar-container">
              <template v-if="isLoading">
                <view class="skeleton-avatar"></view>
              </template>
              <template v-else>
                <mm-lazy-image v-if="avatarUrl" class="avatar-img" :src="avatarUrl" :thumbnail="avatarThumbUrl"
                  mode="aspectFill" />
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

      <!-- 主题设置卡片（可折叠）：标题行常驻显示当前强调色摘要，点击展开配置 -->
      <view class="mm-card theme-card">
        <view class="theme-card-head" hover-class="mm-hover" @click="toggleThemeExpanded">
          <text class="mm-section-title card-section-title">主题</text>
          <view class="theme-summary">
            <view class="theme-summary-dot" :style="{ backgroundColor: themeStore.currentSeed }"></view>
            <text class="theme-summary-hex">{{ themeStore.currentSeed.toUpperCase() }}</text>
            <image class="theme-chevron" :class="{ expanded: themeExpanded }" src="/static/svg/turn-right.svg"
              mode="aspectFit" />
          </view>
        </view>

        <!-- 折叠区：强调色 / 自定义颜色 / 深色模式 -->
        <view class="theme-body" :class="{ expanded: themeExpanded }">
          <!-- 强调色：8 个单色圆点（选中项加主题色描边 + check 图标） -->
          <view class="theme-block">
            <view class="block-head">
              <text class="block-label">强调色</text>
              <text class="block-value">{{ themeStore.currentSeed.toUpperCase() }}</text>
            </view>
            <view class="seed-grid">
              <view v-for="seed in PRESET_SEEDS" :key="seed" class="seed-swatch-cell"
                :class="{ selected: isSeedActive(seed) }" hover-class="mm-hover" @click="handleSelectSeed(seed)">
                <view class="seed-dot" :style="{ backgroundColor: seed }">
                  <view v-if="isSeedActive(seed)" class="seed-check">
                    <image class="seed-check-icon" src="/static/svg/check_mark.svg" mode="aspectFit" />
                  </view>
                </view>
              </view>
            </view>
          </view>

          <!-- 自定义颜色：输入 #RRGGBB + 应用按钮（normalizeHexColor 校验） -->
          <view class="theme-block">
            <text class="block-label">自定义颜色</text>
            <view class="custom-row">
              <view class="custom-preview" :style="customPreviewStyle"></view>
              <input class="custom-input" v-model="customSeed" placeholder="#RRGGBB" maxlength="7"
                placeholder-class="custom-input-placeholder" @confirm="applyCustomSeed" />
              <button class="custom-apply-btn" hover-class="mm-hover" @click="applyCustomSeed">应用</button>
            </view>
            <text class="block-hint">输入 16 进制颜色值，如 #e3c0df</text>
          </view>

          <!-- 深色模式开关 -->
          <view class="theme-block dark-block">
            <view class="dark-text">
              <text class="block-label">深色模式</text>
              <text class="block-hint">切换日间 / 夜间主题</text>
            </view>
            <switch class="dark-switch" :checked="themeStore.isDark" @change="handleDarkModeChange"
              :color="themeStore.themeStyle['--theme-primary']" />
          </view>
        </view>
      </view>

      <!-- 功能菜单：白卡片分组 + 分割线 -->
      <view class="mm-card menu-card">
        <view v-for="item in menuItems" :key="item.path" class="settings-item" hover-class="mm-hover"
          @click="navigateTo(item.path)">
          <text class="item-label">{{ item.label }}</text>
          <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
        </view>
      </view>
    </view>

    <!-- 退出登录：危险操作使用 danger token -->
    <view class="actions">
      <button class="btn-logout" hover-class="mm-hover" @click="handleLogout">退出登录</button>
    </view>

  </view>
</template>

<style scoped lang="scss">
/* ============================================================
   设置页：单色风格（浅灰底 + 白卡片 + 单一强调色）
   —— 所有颜色均来自 App.vue / themeStore 的 CSS 变量
   ============================================================ */

.tab-content {
  /* 底部安全区由 pages/main 的 .tab-page 统一预留，这里只留模块间距 */
  padding: var(--page-pad) var(--page-pad) 16px;
  box-sizing: border-box;
  background-color: var(--bg-color);
  min-height: 100vh;
}

.settings-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 4px;
}

/* ---------- 账号卡片 ---------- */
.profile-card {
  cursor: pointer;
}

.profile-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 56px;
}

.item-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.avatar-container {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  overflow: hidden;
  background-color: var(--surface-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid var(--border-color);
}

.avatar-img {
  display: block;
  width: 100%;
  height: 100%;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  background-color: var(--theme-color-soft);
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-text {
  font-size: 22px;
  color: var(--theme-color-strong);
  font-weight: 600;
}

.user-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.nickName {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 2px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.userAccount {
  font-size: 12px;
  color: var(--text-muted);
}

.arrow-icon {
  width: 16px;
  height: 16px;
  opacity: 0.35;
  flex-shrink: 0;
}

/* ---------- 主题设置卡片（可折叠） ---------- */
/* 标题行：整行可点击，高度 ≥44px；右侧显示当前强调色摘要与展开箭头 */
.theme-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  margin: -6px 0;
}

.card-section-title {
  display: block;
}

.theme-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.theme-summary-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  box-sizing: border-box;
}

.theme-summary-hex {
  font-size: 12px;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

/* 展开箭头：收起时朝下，展开时朝上 */
.theme-chevron {
  width: 16px;
  height: 16px;
  opacity: 0.35;
  transform: rotate(90deg);
  transition: transform 0.25s ease;
}

.theme-chevron.expanded {
  transform: rotate(-90deg);
}

/* 折叠区：max-height + 透明度过渡；收起时不占高度 */
.theme-body {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  transition: max-height 0.28s ease, opacity 0.2s ease;
}

.theme-body.expanded {
  max-height: 760px;
  opacity: 1;
}

.theme-block {
  padding: 14px 0;
}

.theme-block + .theme-block {
  border-top: 1px solid var(--divider-color);
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.block-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
}

.block-value {
  font-size: 12px;
  color: var(--text-muted);
}

.block-hint {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-faint);
}

/* 强调色圆点：4 列网格，每个热区 46px（≥44px 移动端规范） */
.seed-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-top: 10px;
}

.seed-swatch-cell {
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
}

.seed-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  position: relative;
  box-sizing: border-box;
}

/* 选中态：主题色描边外扩，不改变圆点尺寸 */
.seed-swatch-cell.selected .seed-dot {
  border-color: var(--theme-color-strong);
  box-shadow: 0 0 0 2px var(--theme-color-strong);
}

/* check 徽标固定白底：深色模式下黑色图标也能看清 */
.seed-check {
  position: absolute;
  right: -7px;
  bottom: -7px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: #ffffff;
  border: 1px solid var(--theme-color-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.seed-check-icon {
  width: 11px;
  height: 11px;
}

/* 自定义颜色输入行 */
.custom-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.custom-preview {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  flex-shrink: 0;
}

.custom-input {
  flex: 1;
  min-width: 0;
  height: var(--control-h);
  padding: 0 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  font-size: 14px;
  color: var(--text-color);
  box-sizing: border-box;
}

.custom-input-placeholder {
  color: var(--text-faint);
}

.custom-apply-btn {
  flex-shrink: 0;
  height: var(--control-h);
  padding: 0 16px;
  border-radius: 10px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.custom-apply-btn::after {
  border: none;
}

/* 深色模式行 */
.dark-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dark-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dark-text .block-hint {
  margin-top: 2px;
}

.dark-switch {
  flex-shrink: 0;
  transform: scale(0.9);
  transform-origin: right center;
}

/* ---------- 功能菜单 ---------- */
.menu-card {
  padding: 0;
  overflow: hidden;
}

.settings-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid var(--divider-color);
  background-color: transparent;
}

.settings-item:last-child {
  border-bottom: none;
}

.item-label {
  font-size: 15px;
  color: var(--text-color);
}

/* ---------- 退出登录 ---------- */
.actions {
  margin-top: 16px;
}

.btn-logout {
  width: 100%;
  height: var(--control-h);
  border-radius: 10px;
  background-color: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  color: var(--color-danger-text);
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.btn-logout::after {
  border: none;
}

/* ---------- 骨架屏（用 token，避免写死灰阶） ---------- */
.skeleton {
  pointer-events: none;

  .skeleton-avatar {
    width: 100%;
    height: 100%;
    background-color: var(--surface-soft);
    position: relative;
    overflow: hidden;

    &::after {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, var(--border-color), transparent);
      animation: skeleton-loading 1.5s infinite;
    }
  }

  .skeleton-nickname {
    width: 120px;
    height: 18px;
    background-color: var(--surface-soft);
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
      background: linear-gradient(90deg, transparent, var(--border-color), transparent);
      animation: skeleton-loading 1.5s infinite;
    }
  }

  .skeleton-account {
    width: 80px;
    height: 14px;
    background-color: var(--surface-soft);
    border-radius: 4px;
  }
}

@keyframes skeleton-loading {
  0% {
    transform: translateX(-100%);
  }

  100% {
    transform: translateX(100%);
  }
}
</style>
