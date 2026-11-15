<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useThemeStore } from '@/stores/theme';
import MmNavBar from '@/components/MmNavBar.vue';
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
  <view class="page-container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：page-container 顶部 padding 16px，作为内容与顶栏之间的间距 -->
    <MmNavBar title="登录记录" />
    <text class="group-title">登录记录</text>

    <!-- 白卡片列表：每行 ≥44px，行间分割线 token -->
    <view class="page-card record-list">
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
@use "@/styles/page-layouts.scss";

/* 分组小标题：13px / 600 灰字 */
.group-title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  margin: 0 2px 8px;
}

/* 卡片内列表：收窄上下内边距，行高由条目撑开 */
.record-list {
  padding: 4px 16px;
}

.record-item {
  min-height: 44px;
  padding: 14px 0;
  /* 行间分割线统一走 --divider-color */
  border-bottom: 1px solid var(--divider-color);
}

.record-item:last-child {
  border-bottom: none;
}

.record-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.device {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

/* 状态胶囊：常规项用次级底；当前登录用主题浅底 + 强调色 */
.status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background-color: var(--surface-soft);
  color: var(--text-muted);
}

.status.active {
  color: var(--theme-color-strong);
  background-color: var(--theme-color-soft);
}

.info {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
