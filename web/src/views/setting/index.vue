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
    <el-scrollbar ref="scrollbarRef" wrap-style="max-height: calc(100vh - var(--header-h));" view-class="">
      <div class="open">
        <router-view v-slot="{ Component, route }">
          <Transition @enter="onEnter" @leave="onLeave" name="routes" mode="out-in">
            <component :is="Component" :key="route.fullPath" />
          </Transition>
        </router-view>
      </div>
      <el-button @click="scrollToTop" type="primary" style="position: fixed; right: 20px; bottom: 20px;">
        <svg-icon icon-class="general-pg-up" size="20px" />
      </el-button>
    </el-scrollbar>
  </div>
</template>

<style scoped lang="scss">
.setting {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.topbar {
  position: relative;
  height: var(--header-h);
  width: 100%;
  z-index: 1;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color);
  background: rgba($color: #000000, $alpha: 0);

  .topbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    color: var(--text-color);
    cursor: pointer;
  }
}

.open {
  height: 10000px;
  width: 100vw;
  display: flex;
  flex-direction: column;
  align-items: center;
}
</style>
