<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useThemeStore } from '@/stores/theme';
const themeStore = useThemeStore();

onShow(() => {
  themeStore.updateNavBarColor();
});

const logs = [
  { version: 'v1.0.2', date: '2026-02-11', content: '优化设置页布局，增加更新日志、意见反馈等功能区块。' },
  { version: 'v1.0.1', date: '2026-02-10', content: '优化主题色切换逻辑与缓存机制。' },
  { version: 'v1.0.0', date: '2026-02-01', content: '喵咪记事簿正式上线！' }
];
</script>

<template>
  <view class="container" :style="themeStore.themeStyle">
    <view class="log-list">
      <view v-for="(log, index) in logs" :key="index" class="log-item">
        <view class="log-header">
          <text class="version">{{ log.version }}</text>
          <text class="date">{{ log.date }}</text>
        </view>
        <view class="log-content">{{ log.content }}</view>
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
.log-item {
  background-color: var(--bg-elevated);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  border: 1px solid var(--border-color);
}
.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.version {
  font-size: 18px;
  font-weight: bold;
  color: var(--theme-primary);
}
.date {
  font-size: 14px;
  color: var(--text-muted);
}
.log-content {
  font-size: 15px;
  color: var(--text-color);
  line-height: 1.6;
}
</style>
