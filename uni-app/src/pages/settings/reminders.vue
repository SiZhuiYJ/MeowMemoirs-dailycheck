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
        <text class="title">重要提醒</text>
        <text class="text">1. 请务必妥善保管您的账号密码。</text>
        <text class="text">2. 定期备份您的记事数据以防丢失。</text>
        <text class="text">3. 如果遇到异常登录，请及时修改密码。</text>
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
  margin-bottom: 8px;
}
</style>
