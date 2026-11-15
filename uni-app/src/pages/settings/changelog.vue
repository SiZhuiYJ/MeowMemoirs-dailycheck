<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useThemeStore } from '@/stores/theme';
import MmNavBar from '@/components/MmNavBar.vue';
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
  <view class="page-container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：page-container 顶部 padding 16px，作为内容与顶栏之间的间距 -->
    <MmNavBar title="更新日志" />
    <!-- 分组小标题：13px 灰色，与全站设置页一致 -->
    <text class="group-title">更新日志</text>

    <!-- 白卡片列表：圆角 + 1px 描边 + 卡片阴影，行间用分割线 token -->
    <view class="page-card log-list">
      <view v-for="(log, index) in logs" :key="index" class="log-item">
        <view class="log-header">
          <text class="version">{{ log.version }}</text>
          <text class="date">{{ log.date }}</text>
        </view>
        <text class="log-content">{{ log.content }}</text>
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

/* 卡片内列表：收窄上下内边距，让行高自己撑开 */
.log-list {
  padding: 4px 16px;
}

.log-item {
  min-height: 44px;
  padding: 14px 0;
  /* 行间分割线统一走 --divider-color */
  border-bottom: 1px solid var(--divider-color);
}

.log-item:last-child {
  border-bottom: none;
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.version {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.date {
  font-size: 12px;
  color: var(--text-faint);
}

.log-content {
  display: block;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-muted);
}
</style>
