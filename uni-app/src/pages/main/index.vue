<script setup lang="ts">
import { ref, reactive } from 'vue';
import { onShow, onLoad, onUnload } from '@dcloudio/uni-app';
import CustomTabBar from '@/components/CustomTabBar.vue';
import HomeTab from '@/components/tabs/HomeTab.vue';
import ClassTab from '@/components/tabs/ClassTab.vue';
import CheckInTab from '@/components/tabs/CheckInTab.vue';
import SettingsTab from '@/components/tabs/SettingsTab.vue';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';

const authStore = useAuthStore();
const themeStore = useThemeStore();
const currentTab = ref(0); // Default to Home (喵咪记事簿)

onShow(() => {
  themeStore.updateNavBarColor();
});

// Animation State
const visibleTabs = reactive(new Set([0]));
const tabClasses = reactive<Record<number, string>>({ 0: '', 1: '', 2: '', 3: '' });
const cleanupTimers: Record<number, number> = {};

onLoad((options: any) => {
  if (options && options.tab) {
    const tabIndex = Number(options.tab);
    if (!isNaN(tabIndex) && tabIndex >= 0 && tabIndex <= 2) {
      currentTab.value = tabIndex;
      visibleTabs.add(tabIndex);
    }
  }
  
  uni.$on('switch-tab', (index: number) => {
    handleTabChange(index);
  });
});

onUnload(() => {
  uni.$off('switch-tab');
});

function handleTabChange(index: number) {
  if (currentTab.value === index) return;
  
  const oldIndex = currentTab.value;
  const newIndex = index;
  const isForward = newIndex > oldIndex;

  // 0. Cancel any pending cleanup for the NEW tab (if user quickly switched back)
  if (cleanupTimers[newIndex]) {
    clearTimeout(cleanupTimers[newIndex]);
    delete cleanupTimers[newIndex];
  }

  // 1. Set initial position class IMMEDIATELY before showing
  tabClasses[newIndex] = isForward ? 'init-right' : 'init-left';
  
  // 2. Ensure new tab is rendered
  visibleTabs.add(newIndex);
  
  // 3. Start animation in next tick
  setTimeout(() => {
    tabClasses[oldIndex] = isForward ? 'slide-out-left' : 'slide-out-right';
    tabClasses[newIndex] = isForward ? 'slide-in-right' : 'slide-in-left';
  }, 50); 

  // 4. Update current
  currentTab.value = newIndex;

  // 5. Cleanup after animation
  // Clear any existing cleanup timer for the old tab to restart the countdown
  if (cleanupTimers[oldIndex]) {
    clearTimeout(cleanupTimers[oldIndex]);
  }
  
  cleanupTimers[oldIndex] = setTimeout(() => {
    // Only hide if it's NOT the current tab (user didn't switch back)
    if (currentTab.value !== oldIndex) {
        visibleTabs.delete(oldIndex);
        tabClasses[oldIndex] = '';
    }
    // Always clean up the timer reference
    delete cleanupTimers[oldIndex];
    
    // Also reset class for the current tab to remove animation fill mode
    // But ONLY if it is still the current tab
    if (currentTab.value === newIndex) {
        tabClasses[newIndex] = '';
    }
  }, 350) as unknown as number; 
}
</script>

<template>
  <view class="main-container" :style="themeStore.themeStyle">
    <view class="content-area">
      <view class="tab-page" v-show="visibleTabs.has(0)" :class="tabClasses[0]">
        <HomeTab :isActive="currentTab === 0" />
      </view>
      <view class="tab-page" v-show="visibleTabs.has(1)" :class="tabClasses[1]">
        <ClassTab :isActive="currentTab === 1" />
      </view>
      <view class="tab-page" v-show="visibleTabs.has(2)" :class="tabClasses[2]">
        <CheckInTab :isActive="currentTab === 2" />
      </view>
      <view class="tab-page" v-show="visibleTabs.has(3)" :class="tabClasses[3]">
        <SettingsTab :isActive="currentTab === 3" />
      </view>
    </view>
    
    <CustomTabBar :current="currentTab" @change="handleTabChange" />
  </view>
</template>

<style scoped lang="scss">
.main-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  position: relative;
  background-color: var(--bg-color);
}

.content-area {
  width: 100%;
  height: 100%;
  position: relative;
}

.tab-page {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background-color: var(--bg-color);
  /* Default state is visible at 0,0 */
}

/* Initial States to prevent flash */
.init-right {
  transform: translateX(100%);
}

.init-left {
  transform: translateX(-100%);
}

/* Animations */
@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@keyframes slideOutLeft {
  from { transform: translateX(0); }
  to { transform: translateX(-100%); }
}

@keyframes slideInLeft {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

@keyframes slideOutRight {
  from { transform: translateX(0); }
  to { transform: translateX(100%); }
}

.slide-in-right {
  animation: slideInRight 0.3s ease forwards;
  z-index: 10;
}

.slide-out-left {
  animation: slideOutLeft 0.3s ease forwards;
  z-index: 9;
}

.slide-in-left {
  animation: slideInLeft 0.3s ease forwards;
  z-index: 10;
}

.slide-out-right {
  animation: slideOutRight 0.3s ease forwards;
  z-index: 9;
}
</style>
