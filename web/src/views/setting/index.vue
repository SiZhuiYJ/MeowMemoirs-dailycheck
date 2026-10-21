<script setup lang="ts">
import router from "@/routers";
import { CaretLeft } from "@element-plus/icons-vue";
import { ElScrollbar } from "element-plus";
import SettingsMenu from "@/features/auth/components/Settings/menu.vue";
import { smoothScrollTo } from "@/utils/smoothScroll"; // 引入上面的工具函数
const scrollbarRef =
  useTemplateRef<InstanceType<typeof ElScrollbar>>("scrollbarRef");

const scrollToTop = () => {
  if (scrollbarRef.value) {
    const wrap = scrollbarRef.value.wrapRef;
    if (wrap) {
      smoothScrollTo(wrap, 0, 400); // 400ms 内平滑滚动到顶部
    }
  }
};

import gsap from 'gsap';

import { useTransitionComposable } from '@/composables/transition-composable';

const { toggleTransitionComplete } = useTransitionComposable();

// Transition Hooks
const onEnter = (el: Element, done: () => void) => {
  gsap.set(el, { autoAlpha: 0, scale: 0.8, xPercent: -100 });
  gsap
    .timeline({
      paused: true,
      onComplete() {
        toggleTransitionComplete(true);
        done();
      },
    })
    .to(el, { autoAlpha: 1, xPercent: 0, duration: 0.25 })
    .to(el, { scale: 1, duration: 0.25 })
    .play();
};

const onLeave = (el: Element, done: () => void) => {
  toggleTransitionComplete(false);
  gsap
    .timeline({ paused: true, onComplete: done })
    .to(el, { scale: 0.8, duration: 0.2 })
    .to(el, { xPercent: 100, autoAlpha: 0, duration: 0.2 })
    .play();
};

onMounted(async () => {
  toggleTransitionComplete(true);
});
</script>

<template>
  <div class="setting">
    <header class="topbar">
      <div class="topbar-left" @click="router.push('/home')">
        <el-icon>
          <CaretLeft />
        </el-icon>
        返回
      </div>

      <SettingsMenu />
    </header>
    <el-scrollbar ref="scrollbarRef" wrap-style="max-height: calc(var(--app-h) - var(--header-total-h));" view-class="">
      <div class="open">
        <router-view v-slot="{ Component, route }">
          <Transition @enter="onEnter" @leave="onLeave" name="routes" mode="out-in">
            <component :is="Component" :key="route.fullPath" />
          </Transition>
        </router-view>
      </div>
      <el-button @click="scrollToTop" type="primary" class="scroll-top-btn">
        <svg-icon icon-class="general-pg-up" size="20px" />
      </el-button>
    </el-scrollbar>
  </div>
</template>

<style scoped lang="scss">
.setting {
  // --app-h 跟随地址栏/软键盘变化，比 100vh 准确（移动端 100vh 会超出可视区）。
  height: var(--app-h);
  // 不用 100vw：存在纵向滚动条时 100vw 含滚动条宽度，会横向溢出。
  width: 100%;
  overflow: hidden;
}

// 回到顶部按钮：固定在右下角，必须让开安全区，
// 否则在带手势条的机型上会被系统手势区压住/误触。
.scroll-top-btn {
  position: fixed;
  right: calc(20px + var(--safe-right));
  bottom: calc(20px + var(--safe-bottom));
}

.topbar {
  position: relative;
  // 与 Topbar.vue 一致：含状态栏/刘海安全区。
  height: var(--header-total-h);
  width: 100%;
  z-index: 1;
  padding: var(--safe-top) calc(16px + var(--safe-right)) 0 calc(16px + var(--safe-left));
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color);
  background: rgba($color: #000000, $alpha: 0);

  .topbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    color: var(--text-color);
    cursor: pointer;
  }
}

.open {
  height: 10000px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}
</style>
