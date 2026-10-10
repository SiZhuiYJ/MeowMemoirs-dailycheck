<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useThemeStore } from '@/stores/theme';
const themeStore = useThemeStore();

onShow(() => {
  themeStore.updateNavBarColor();
});

const records = [
  { device: 'iPhone 13', location: '北京', time: '2026-02-11 10:30', status: '当前登录' },
  { device: 'Chrome - Windows', location: '北京', time: '2026-02-10 18:20', status: '已退出' },
  { device: 'iPhone 13', location: '上海', time: '2026-02-05 09:15', status: '已退出' }
];
</script>

<template>
  <view class="container" :style="themeStore.themeStyle">
    <view class="record-list">
      <view v-for="(record, index) in records" :key="index" class="record-item">
        <view class="record-main">
          <text class="device">{{ record.device }}</text>
          <text class="status" :class="{ active: record.status === '当前登录' }">{{ record.status }}</text>
        </view>
        <view class="record-sub">
          <text class="info">{{ record.location }} | {{ record.time }}</text>
        </view>
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
.record-item {
  background-color: var(--bg-elevated);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  border: 1px solid var(--border-color);
}
.record-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.device {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
}
.status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  background-color: var(--bg-soft);
  color: var(--text-muted);
}
.status.active {
  color: var(--theme-primary);
  background-color: var(--theme-primary-light);
}
.info {
  font-size: 13px;
  color: var(--text-muted);
}
</style>
