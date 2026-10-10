<script setup lang="ts">
import Topbar from "@/features/auth/components/Topbar.vue";
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
  <div class="main">
    <Topbar />
    <router-view v-slot="{ Component, route }">
      <Transition @enter="onEnter" @leave="onLeave" name="routes" mode="out-in">
        <component :is="Component" :key="route.fullPath" />
      </Transition>
    </router-view>
  </div>
</template>

<style scoped lang="scss">
.main {
  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}
</style>
