<script setup lang="ts">
import Txet from "@/components/Text/index.vue";

/**
 * 自适应宽度的跑马灯文本。
 *
 * 占满父容器剩余宽度：文字放得下时静止显示，放不下时用 Txet 左右来回滚动。
 * Txet 需要**像素宽度**才能算滚动距离，而这里的可用宽度由父级布局（flex /
 * 响应式断点）决定，所以用 ResizeObserver 实测后通过 `:width` 传给它。
 * 宽度或文字变化时 Txet 会自己重新测量（见 components/Text/index.vue），
 * 这里不要用 `:key` 重挂组件。
 */
const { text, speed = 10, mode = "bounce", gap = 40 } = defineProps<{
  text: string;
  /** 滚动速度（px/s） */
  speed?: number;
  mode?: "bounce" | "scroll";
  /** scroll 模式下两段文字之间的间距 */
  gap?: number;
}>();

const hostRef = useTemplateRef<HTMLElement>("hostRef");
const hostWidth = ref(0);
let resizeObserver: ResizeObserver | null = null;

watch(
  hostRef,
  (el) => {
    resizeObserver?.disconnect();
    resizeObserver = null;

    if (!el) {
      hostWidth.value = 0;
      return;
    }

    hostWidth.value = Math.floor(el.clientWidth);

    // 极老 WebView / 非浏览器环境没有 ResizeObserver：降级为只量一次，
    // 不抛错（异常会冒到全局 errorHandler）。
    if (typeof ResizeObserver !== "function") return;

    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") hostWidth.value = Math.floor(width);
    });
    resizeObserver.observe(el);
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <span ref="hostRef" class="marquee-host">
    <Txet v-if="hostWidth > 0" :text="text" :width="hostWidth" :speed="speed" :mode="mode" :gap="gap" shrinkWhenShort />
  </span>
</template>

<style scoped>
.marquee-host {
  display: block;
  min-width: 0;
  overflow: hidden;
}
</style>
