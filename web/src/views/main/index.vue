<script setup lang="ts">
import Topbar from "@/features/auth/components/Topbar.vue";

// 路由切换动画改成 CSS 过渡（见下方 <style>）：
// 旧实现用 gsap 两段 timeline（leave 0.2+0.2s、enter 0.25+0.25s ≈ 0.9s），
// 而 gsap 只有这个动画和通知组件在用 —— 却被静态打进首屏。现在：
//   · gsap 不再出现在首屏依赖里（通知系统也改成了空闲后挂载）；
//   · 单次导航的动画等待从 ~0.9s 降到 ~0.32s。
</script>

<template>
  <div class="main">
    <Topbar />
    <router-view v-slot="{ Component, route }">
      <Transition name="routes" mode="out-in">
        <component :is="Component" :key="route.fullPath" />
      </Transition>
    </router-view>
  </div>
</template>

<style scoped lang="scss">
.main {
  // --app-h：跟随地址栏与软键盘的真实视口高度（移动端 100vh 会把底部顶出屏幕）。
  height: var(--app-h);
  // 不用 100vw：存在纵向滚动条时含滚动条宽度，会横向溢出。
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}
</style>

<style lang="scss">
/* 路由切换过渡。不能用 scoped：过渡类名挂在子路由组件的根节点上。 */
.routes-enter-active,
.routes-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.routes-enter-from {
  opacity: 0;
  transform: translateX(-12%) scale(0.98);
}

.routes-leave-to {
  opacity: 0;
  transform: translateX(12%) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .routes-enter-active,
  .routes-leave-active {
    transition: none;
  }
}
</style>
