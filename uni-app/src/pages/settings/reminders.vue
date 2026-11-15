<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useThemeStore } from '@/stores/theme';
import MmNavBar from '@/components/MmNavBar.vue';
const themeStore = useThemeStore();

onShow(() => {
  themeStore.updateNavBarColor();
});
</script>

<template>
  <view class="page-container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：page-container 顶部 padding 16px，作为内容与顶栏之间的间距 -->
    <MmNavBar title="重要提醒" />
    <!-- 分组小标题：13px 灰色，与全站设置页一致 -->
    <text class="group-title">账号安全提醒</text>

    <!-- 白卡片列表：圆角 + 1px 描边 + 卡片阴影，条目行高 ≥44px -->
    <view class="page-card reminder-card">
      <text class="title">重要提醒</text>

      <view class="rule-row">
        <text class="rule-text">1. 请务必妥善保管您的账号密码。</text>
      </view>
      <view class="rule-row">
        <text class="rule-text">2. 定期备份您的记事数据以防丢失。</text>
      </view>
      <view class="rule-row">
        <text class="rule-text">3. 如果遇到异常登录，请及时修改密码。</text>
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

.reminder-card {
  padding: 16px;
}

.title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
}

/* 每条提醒一行：min-height 44px 保证触屏行高，行间分割线 */
.rule-row {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 0;
  border-bottom: 1px solid var(--divider-color);
}

.rule-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.rule-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-color);
}
</style>
