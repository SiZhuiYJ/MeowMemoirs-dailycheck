<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useThemeStore } from '@/stores/theme';
const themeStore = useThemeStore();

onShow(() => {
  themeStore.updateNavBarColor();
});
</script>

<template>
  <view class="container" :style="themeStore.themeStyle">
    <view class="content">
      <view class="card">
        <text class="title">数据隐私政策</text>
        <text class="text">我们非常重视您的隐私。您的所有记事数据都经过加密存储，仅供您个人查看。</text>
        <text class="text">我们不会将您的个人信息出售或共享给任何第三方。您可以随时导出或删除您的数据。</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.container {
  min-height: 100vh;
  background-color: var(--bg-color);
  padding: 20px;
}
.card {
  background-color: var(--bg-elevated);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid var(--border-color);
}
.title {
  font-size: 18px;
  font-weight: bold;
  color: var(--theme-primary);
  margin-bottom: 12px;
  display: block;
}
.text {
  font-size: 15px;
  color: var(--text-color);
  line-height: 1.8;
  display: block;
}
</style>
