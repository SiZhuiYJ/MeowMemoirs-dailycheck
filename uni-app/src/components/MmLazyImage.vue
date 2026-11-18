<template>
  <view class="mm-lazy-image" :style="placeholderStyle">
    <!-- 缩略占位图：体积小、几乎秒出，原图加载完成后被覆盖 -->
    <image v-if="thumbnail && !thumbFailed" class="mm-lazy-image__thumb" :src="thumbnail" :mode="mode" :webp="webp"
      @error="handleThumbError" />
    <!-- 原图：默认透明，@load 后淡入；lazy-load 让列表/滚动区域里的图片滚动到附近才真正下载 -->
    <image v-if="src" class="mm-lazy-image__main" :class="{ 'is-loaded': loaded }" :src="src" :mode="mode"
      :webp="webp" :lazy-load="lazyLoad" :style="{ transitionDuration: `${duration}ms` }" @load="handleMainLoad"
      @error="handleMainError" />
  </view>
</template>

<script setup lang="ts">
/**
 * 通用渐进加载图片组件（缩略占位图 → 原图淡入 + 小程序原生 lazy-load）
 *
 * 设计目标：所有「远程图片/头像」统一走这里，避免各页面重复写两层 image + 淡入逻辑。
 *
 * 用法（组件会 100% 铺满父容器，父容器需给定尺寸，圆角/裁剪交给父容器）：
 *   <view class="avatar-container">
 *     <mm-lazy-image class="avatar-img" :src="avatarUrl" :thumbnail="avatarThumbUrl" mode="aspectFill" />
 *   </view>
 *
 * · thumbnail：服务端缩略图地址（公开图片可用 libs/http/apiBase 的 thumbnailUrl() 生成
 *   `?thumbnail=true`；不存在时后端回退原图）。不传则只显示占位底色。
 * · 原图加载完成前显示缩略图/底色，完成后淡入，避免整块空白或跳变。
 * · lazy-load 默认开启：在页面 / scroll-view 中滚动到附近才下载；首屏图片会立即加载。
 * · 点击事件不拦截，正常冒泡到父级（父级可继续用 @click / @click.stop）。
 */
import { computed, ref, watch } from 'vue';

interface Props {
  /** 原图地址；为空时不渲染图片（可由调用方 v-if 控制） */
  src?: string;
  /** 缩略占位图地址，可选 */
  thumbnail?: string;
  /** 图片裁剪模式，默认 aspectFill */
  mode?: string;
  /** 是否启用小程序原生 lazy-load，默认 true */
  lazyLoad?: boolean;
  /** 是否按 WebP 解析（本后端图片统一存 WebP），默认 true */
  webp?: boolean;
  /** 原图淡入时长（ms），默认 260 */
  duration?: number;
  /** 占位底色；不传则用主题浅底 */
  placeholderColor?: string;
}

const props = withDefaults(defineProps<Props>(), {
  src: '',
  thumbnail: '',
  mode: 'aspectFill',
  lazyLoad: true,
  webp: true,
  duration: 260,
  placeholderColor: '',
});

const emit = defineEmits<{ (e: 'load'): void; (e: 'error'): void }>();

/** 原图是否已加载完成（完成后淡入并盖住占位图） */
const loaded = ref(false);
/** 缩略图是否加载失败（失败则隐藏，只保留底色，避免碎图） */
const thumbFailed = ref(false);

const placeholderStyle = computed(() =>
  props.placeholderColor ? { backgroundColor: props.placeholderColor } : undefined
);

// 换图（头像/背景重新上传、切换账号）时重置状态，重新走一遍「占位 → 原图」
watch(
  () => props.src,
  () => {
    loaded.value = false;
  }
);
watch(
  () => props.thumbnail,
  () => {
    thumbFailed.value = false;
  }
);

function handleMainLoad() {
  loaded.value = true;
  emit('load');
}

function handleMainError() {
  // 原图失败时保持占位图可见（不要显示碎图），由调用方决定是否兜底
  loaded.value = false;
  emit('error');
}

function handleThumbError() {
  thumbFailed.value = true;
}
</script>

<style scoped lang="scss">
.mm-lazy-image {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--theme-color-soft);
}

.mm-lazy-image__thumb,
.mm-lazy-image__main {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: 100%;
  height: 100%;
}

.mm-lazy-image__thumb {
  z-index: 0;
}

.mm-lazy-image__main {
  z-index: 1;
  opacity: 0;
  transition-property: opacity;
  transition-timing-function: ease;
}

.mm-lazy-image__main.is-loaded {
  opacity: 1;
}
</style>
