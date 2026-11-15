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
    <MmNavBar title="数据隐私" />
    <text class="group-title">数据与隐私</text>

    <!-- 白卡片内容块：段落之间用分割线 token 分隔 -->
    <view class="page-card privacy-card">
      <text class="title">数据隐私政策</text>

      <view class="divider"></view>

      <text class="text">我们非常重视您的隐私。您的所有记事数据都经过加密存储，仅供您个人查看。</text>

      <view class="divider"></view>

      <text class="text">我们不会将您的个人信息出售或共享给任何第三方。您可以随时导出或删除您的数据。</text>
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

.privacy-card {
  padding: 16px;
}

.title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

/* 段落分割线：统一 --divider-color */
.divider {
  height: 1px;
  margin: 14px 0;
  background-color: var(--divider-color);
}

.text {
  display: block;
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-color);
}
</style>
