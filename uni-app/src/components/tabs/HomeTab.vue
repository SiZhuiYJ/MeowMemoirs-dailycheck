<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';
import { APP_TITLE } from '@/config';
import MmNavBar from '@/components/MmNavBar.vue';
import { ref, onMounted } from 'vue';

const authStore = useAuthStore();
const isLoading = ref(true);

onMounted(() => {
  // Mock loading for a better UI transition
  setTimeout(() => {
    isLoading.value = false;
  }, 800);
});
</script>

<template>
  <view class="tab-content">
    <!-- 毛玻璃顶栏：MmNavBar 自带等高占位；内容与顶栏之间保留 .tab-content 的 16px 顶部内边距作为间距 -->
    <MmNavBar :title="APP_TITLE" :show-back="false" align="left" />

    <template v-if="isLoading">
      <view class="header skeleton">
        <view class="skeleton-subtitle"></view>
      </view>
      <view class="content skeleton">
        <view class="skeleton-placeholder"></view>
      </view>
    </template>

    <template v-else>
      <!-- 页面头部（欢迎语） -->
      <view class="header">
        <text class="subtitle">欢迎回来，{{ authStore.user?.nickName || authStore.user?.userAccount || '用户' }}</text>
      </view>

      <!-- 主页内容占位卡片：单色白卡片 + token 描边/阴影 -->
      <view class="content">
        <text class="placeholder-text">这里是主页内容</text>
        <!-- You can add dashboard widgets or summary stats here later -->
      </view>
    </template>
  </view>
</template>

<style scoped lang="scss">
/* 主页 tab 根节点：底色跟随主题；min-height 用 100% 避免在 100vh 的滚动容器里再套 100vh */
.tab-content {
  padding: var(--page-pad);
  box-sizing: border-box;
  background-color: var(--bg-color);
  min-height: 100%;
}

.header {
  margin-bottom: 16px;
}

.subtitle {
  font-size: 14px;
  color: var(--text-muted);
  margin-top: 10px;
}

/* 内容占位卡片：与全局 .mm-card 同款单色卡片语言 */
.content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 240px;
  padding: var(--page-pad);
  box-sizing: border-box;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  margin-bottom: 12px;
}

.placeholder-text {
  color: var(--text-muted);
  font-size: 14px;
}

/* Skeleton：灰阶全部走 token，夜间不会残留写死的浅灰/纯白 */
.skeleton {
  pointer-events: none;

  .skeleton-subtitle {
    width: 200px;
    height: 24px;
    background-color: var(--surface-soft);
    border: 1px solid var(--divider-color);
    border-radius: 4px;
    margin-top: 10px;
    position: relative;
    overflow: hidden;

    &::after {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, var(--divider-color), transparent);
      animation: skeleton-loading 1.5s infinite;
    }
  }

  .skeleton-placeholder {
    width: 100px;
    height: 20px;
    background-color: var(--divider-color);
    border-radius: 4px;
  }
}

@keyframes skeleton-loading {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
</style>
