<script setup lang="ts">
import { ArrowLeft } from "@element-plus/icons-vue";
import gsap from "gsap";
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import SettingsMenu from "@/features/auth/components/Settings/menu.vue";
import { useTransitionComposable } from "@/composables/transition-composable";
import { smoothScrollTo } from "@/utils/smoothScroll";
import router from "@/routers";

/**
 * 设置页外壳：与聊天页 / 用户主页共用 app-shell。
 *
 * 结构：整页渐变底 → 一个圆角面板 → 面板内 el-scrollbar + 悬浮毛玻璃顶栏。
 * 顶栏左侧「返回」，右侧保留原来的设置菜单（当前页名 + 汉堡 + 展开动画），
 * 菜单尺寸由 SettingsMenu / SettingsMenuItem 收到 32 / 24px 的控件高度。
 *
 * 子页切换动画保留原实现（GSAP 缩放 + 左右滑动），只修掉了残留：
 * 旧实现用 `<Transition name="routes">`，同时套上了 views/main/index.vue 里的
 * 全局 `.routes-enter-from { transform: translateX(-12%) }`；GSAP 启动时把这段
 * CSS 解析成固定的 x 偏移（393 宽时约 -43.39px），而 timeline 只把 xPercent
 * 补间到 0，这个 x 偏移从未被清掉 —— 切页后子页永久左移、左边被面板裁掉。
 *
 * 现在给 Transition 加 `:css="false"`：Vue 不再添加任何 CSS 过渡类，动画完全由
 * GSAP 负责；timeline 结束时再 clearProps 清掉内联 transform / opacity，
 * 原动画保持不变，也不会再留下任何位移。
 */
const route = useRoute();
const { toggleTransitionComplete } = useTransitionComposable();

/** 用到 setScrollTop / wrapRef；不引 ElScrollbar 类型，避免把 Element Plus 入口拉进类型图。 */
const scrollbarRef = useTemplateRef<{
  setScrollTop: (top: number) => void;
  wrapRef?: HTMLElement | null;
}>("scrollbarRef");
const scrollTop = ref(0);
const showBackToTop = computed(() => scrollTop.value > 200);

function handleScroll({ scrollTop: value }: { scrollTop: number }) {
  scrollTop.value = value;
}

function scrollToTop() {
  const wrap = scrollbarRef.value?.wrapRef;
  if (wrap) {
    // 与原设置页一致：400ms ease-in-out 平滑回顶，而不是直接跳。
    smoothScrollTo(wrap, 0, 400);
    return;
  }
  scrollbarRef.value?.setScrollTop(0);
}

/** 切换子页后回到顶部：新页面不能继承上一页的滚动位置。 */
watch(
  () => route.fullPath,
  () => {
    void nextTick(() => scrollbarRef.value?.setScrollTop(0));
  },
);

// Transition Hooks：与原设置页一致，只在结束时多一步 clearProps。
const onEnter = (el: Element, done: () => void) => {
  gsap.set(el, { autoAlpha: 0, scale: 0.8, xPercent: -100 });
  gsap
    .timeline({
      paused: true,
      onComplete() {
        // 清掉 GSAP 写在元素上的内联变换，避免任何偏移残留到下一个页面。
        gsap.set(el, {
          clearProps: "transform,opacity,visibility,translate,rotate,scale",
        });
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

onMounted(() => {
  toggleTransitionComplete(true);
});
</script>

<template>
  <div class="setting-page">
    <div class="setting-panel">
      <div class="setting-detail">
        <el-scrollbar ref="scrollbarRef" class="setting-scrollbar" @scroll="handleScroll">
          <div class="setting-scroll-content">
            <router-view v-slot="{ Component, route: currentRoute }">
              <!-- :css="false"：不挂 .routes-* 之类的 CSS 类，避免和 GSAP 抢 transform -->
              <Transition name="setting-routes" :css="false" mode="out-in" @enter="onEnter" @leave="onLeave">
                <component :is="Component" :key="currentRoute.fullPath" />
              </Transition>
            </router-view>
          </div>
        </el-scrollbar>

        <!-- 顶栏：app-shell 提供的悬浮毛玻璃样式，内容从下面滚过去 -->
        <header class="setting-topbar">
          <el-button :icon="ArrowLeft" @click="router.push('/home')">返回</el-button>
          <SettingsMenu />
        </header>

        <!-- 长页面（平台绑定）回到顶部；与聊天页「回到底部」一样是主题色胶囊 -->
        <button v-show="showBackToTop" class="setting-to-top" type="button" aria-label="回到顶部" @click="scrollToTop">
          <svg-icon icon-class="general-pg-up" size="14px" />
          <span>顶部</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/app-shell" as shell;
@use "@/styles/responsive-mixins" as rp;

.setting-page {
  @include shell.app-shell-tokens;
  @include shell.app-page-shell;

  // 与聊天页 / 用户主页复用同一套 --chat-* 皮肤：日间浅色、夜间深色。
  --shell-bg: var(--chat-bg);
  --shell-surface: var(--chat-surface);
  --shell-border: var(--chat-border);
  --shell-shadow: var(--chat-shadow);
  --shell-muted: var(--chat-muted);
  --shell-accent-soft: var(--chat-accent-soft);
}

.setting-panel {
  @include shell.app-surface-panel;

  flex: 1;
  min-height: 0;
}

// app-page-shell 里的 `.el-button` 高度规则写在 scoped 样式里只会命中
// 子组件的根节点；设置子页 / 顶栏菜单里的按钮命中不到，这里用 :deep 显式下沉，
// 让它们沿用同一档 32 / 24px 控件高度（与聊天页一致）。
.setting-page :deep(.el-button:not(.is-link)) {
  height: var(--shell-control-h);
}

.setting-detail {
  @include shell.app-panel-body;
}

.setting-scrollbar {
  height: 100%;
}

// 顶部让出悬浮顶栏的高度；底部多留一点给「顶部」胶囊，避免压住最后一个卡片。
.setting-scroll-content {
  box-sizing: border-box;
  min-height: 100%;
  padding: calc(var(--shell-bar-h) + var(--shell-gap)) var(--shell-gap) calc(var(--shell-pad) + 40px);
}

.setting-topbar {
  @include shell.app-floating-header;
}

// 与聊天页 .scroll-to-latest 同款：主题浅底 + 主题色文字的小胶囊。
.setting-to-top {
  position: absolute;
  right: var(--shell-gap);
  bottom: var(--shell-gap);
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 999px;
  color: var(--chat-accent);
  background: var(--chat-accent-soft);
  box-shadow: var(--theme-outer-glow-lighter);
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
  transition: transform 0.15s ease, background-color 0.15s ease;

  &:hover {
    transform: translateY(-1px);
    background: var(--chat-accent-soft-hover);
  }
}

@include rp.device-mobile {
  .setting-page {
    @include shell.app-shell-tokens-mobile;
  }
}

@include rp.device-phone {
  .setting-scrollbar :deep(.el-scrollbar__bar.is-vertical) {
    width: 3px;
  }
}
</style>
