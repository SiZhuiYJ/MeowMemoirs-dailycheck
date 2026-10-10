<script setup lang="ts">
import { computed } from 'vue';
import { useThemeStore } from '../stores/theme';

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

const pillStyle = computed(() => {
  const widthPercent = 100 / tabs.length;
  const translateX = props.current * 100;
  return {
    width: `${widthPercent}%`,
    transform: `translateX(${translateX}%)`,
  };
});
</script>

<template>
  <view class="tab-bar-container" :style="themeStore.themeStyle">
    <view class="tab-bar-capsule">
      <!-- Background Pill -->
      <view class="tab-pill-wrapper">
        <view class="tab-pill" :style="pillStyle"></view>
      </view>

      <!-- Tab Items -->
      <view
        v-for="(item, index) in tabs"
        :key="index"
        class="tab-item"
        :class="{ active: current === index }"
        hover-class="none"
        @click="handleTabClick(index)"
      >
        <text class="tab-text">{{ item.text }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.tab-bar-container {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding-bottom: calc(20px + env(safe-area-inset-bottom));
  display: flex;
  justify-content: center;
  z-index: 999;
  pointer-events: none; /* Let clicks pass through to content if they are not on the capsule */
}

.tab-bar-capsule {
  pointer-events: auto; /* Re-enable clicks for the bar itself */
  position: relative;
  display: flex;
  background-color: var(--bg-soft);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 30px;
  padding: 5px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  width: 90%;
  max-width: 400px;
  min-width: 280px;
}

.tab-pill-wrapper {
  position: absolute;
  top: 5px;
  left: 5px;
  right: 5px;
  bottom: 5px;
  pointer-events: none;
}

.tab-pill {
  height: 100%;
  background-color: var(--theme-primary);
  border-radius: 24px;
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); /* Bouncy effect */
  box-shadow: 0 4px 12px var(--theme-primary-light);
}

.tab-item {
  flex: 1;
  padding: 10px 0;
  border-radius: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
}

.tab-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  transition: all 0.3s;
}

.tab-item.active .tab-text {
  color: #fff;
  font-weight: 600;
  transform: scale(1.05);
}
</style>
