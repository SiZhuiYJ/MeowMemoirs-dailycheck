<script setup lang="ts">
import { useThemeStore } from '../stores/theme';

/**
 * 自定义底部标签栏（微信小程序规范版）
 *
 * 本次单色风格改造要点：
 * 1. 由「居中药丸胶囊 + 滑动背景色块」改为全宽固定底栏：
 *    白底 var(--bg-elevated)、顶部 1px var(--border-color) 描边、
 *    高度 var(--tabbar-h)（56px），底部再追加 var(--safe-bottom) 适配全面屏；
 * 2. 4 个等宽 tab，每项点击区域 ≥44px；激活项用主题强调色 + 600 字重 +
 *    顶部 3px 圆角强调条，去掉胶囊色块、缩放等重动效，保持克制；
 * 3. 所有颜色取自主题 CSS 变量（日/夜自动切换），不再写死旧绿色/米色；
 * 4. props（current）与 emit（change）接口与原实现完全一致，仅样式层重写。
 */
const props = defineProps<{
  current: number;
}>();

const emit = defineEmits<{
  (e: 'change', index: number): void;
}>();

const themeStore = useThemeStore();

const tabs = [
  { text: '主页' },
  { text: '课程' },
  { text: '打卡' },
  { text: '设置' },
];

function handleTabClick(index: number) {
  if (props.current === index) return;
  emit('change', index);
}
</script>

<template>
  <view class="tab-bar" :style="themeStore.themeStyle">
    <view
      v-for="(item, index) in tabs"
      :key="index"
      class="tab-item"
      :class="{ active: current === index }"
      hover-class="mm-hover"
      :hover-stay-time="120"
      @click="handleTabClick(index)"
    >
      <!-- 激活项顶部 3px 强调条（圆角 2px），未激活时收起 -->
      <view class="tab-indicator"></view>
      <text class="tab-text">{{ item.text }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.tab-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
  display: flex;
  align-items: stretch;
  width: 100%;
  box-sizing: border-box;
  /* 内容区固定 56px，底部安全区用 padding 补足（盒高含 padding，内容不变形） */
  height: calc(var(--tabbar-h) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  padding-left: var(--safe-left);
  padding-right: var(--safe-right);
  /* 小程序规范：全宽白底 + 顶部 1px 分割线，无胶囊圆角 */
  background-color: var(--bg-elevated);
  border-top: 1px solid var(--border-color);
}

.tab-item {
  /* 4 等宽项；min-height 保证 ≥44px 的点击热区 */
  flex: 1 1 0;
  min-width: 0;
  min-height: 44px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.tab-indicator {
  position: absolute;
  top: 0;
  left: 50%;
  width: 24px;
  height: 3px;
  border-radius: 2px;
  background-color: var(--theme-primary);
  opacity: 0;
  transform: translateX(-50%) scaleX(0.4);
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.tab-item.active .tab-indicator {
  opacity: 1;
  transform: translateX(-50%) scaleX(1);
}

.tab-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  transition: color 0.2s ease;
}

.tab-item.active .tab-text {
  color: var(--theme-primary);
  font-weight: 600;
}
</style>
