<script setup lang="ts">
import { computed, ref, watch } from "vue";

type SizeValue = number | string;

const props = withDefaults(
  defineProps<{
    src?: string;
    thumbnailSrc?: string;
    alt?: string;
    size?: SizeValue;
    width?: SizeValue;
    height?: SizeValue;
    isPreview?: boolean;
    shape?: "circle" | "square";
    fit?: "cover" | "contain";
  }>(),
  {
    src: "",
    thumbnailSrc: "",
    alt: "avatar",
    size: 40,
    width: undefined,
    height: undefined,
    shape: "circle",
    fit: "cover",
  },
);

const fullReady = ref(false);
const fullFailed = ref(false);
const thumbFailed = ref(false);

const showPreview = ref(false);

watch(
  () => [props.src, props.thumbnailSrc],
  () => {
    fullReady.value = false;
    fullFailed.value = false;
    thumbFailed.value = false;
  },
  { immediate: true },
);

const normalizedWidth = computed(() => props.width ?? props.size);
const normalizedHeight = computed(() => props.height ?? props.size);

const rootStyle = computed(() => ({
  width:
    typeof normalizedWidth.value === "number"
      ? `${normalizedWidth.value}px`
      : normalizedWidth.value,
  height:
    typeof normalizedHeight.value === "number"
      ? `${normalizedHeight.value}px`
      : normalizedHeight.value,
}));

const thumbSrc = computed(() => {
  if (thumbFailed.value) {
    return fullFailed.value ? "" : props.src;
  }
  return props.thumbnailSrc || props.src;
});

/**
 * 全尺寸图只在这些情况下加载：
 *   · 需要点击预览（`isPreview`）；
 *   · 显示尺寸 ≥ 72px（96px 缩略图放到 2x 屏仍然够用）。
 *
 * 旧实现对所有头像都同时渲染缩略图和全尺寸两张 `<img>`：消息列表里
 * 每个 40px 头像都会额外拉一张 60KB+ 的原图。服务端只有 1MB/s 带宽时，
 * 一个 50 条消息的会话光头像就是好几 MB —— 现在小尺寸只拉缩略图。
 */
const FULL_LAYER_MIN_SIZE = 72;
const displaySizePx = computed(() => {
  const raw = normalizedWidth.value;
  const size = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  return Number.isFinite(size) ? size : 0;
});

const showFullLayer = computed(() =>
  Boolean(
    props.src &&
      !fullFailed.value &&
      (props.isPreview || displaySizePx.value >= FULL_LAYER_MIN_SIZE),
  ),
);
const hasImage = computed(() => Boolean(thumbSrc.value || showFullLayer.value));
const mediaStyle = computed(() => ({
  objectFit: props.fit,
}));

function handleFullLoad() {
  fullReady.value = true;
}

function handleFullError() {
  fullFailed.value = true;
}

function handleThumbError() {
  thumbFailed.value = true;
}
function toggleImagePreview() {
  if (props.src && !fullFailed.value && props.isPreview)
    showPreview.value = !showPreview.value;
}
</script>

<template>
  <div class="progressive-avatar" :class="[shape, { 'has-image': hasImage, 'full-ready': fullReady }]"
    :style="rootStyle">
    <div class="avatar-fallback">
      <slot />
    </div>
    <img v-if="thumbSrc && !thumbFailed" class="avatar-layer avatar-thumb" :src="thumbSrc" :alt="alt"
      :style="mediaStyle" loading="lazy" @error="handleThumbError" />
    <img v-if="showFullLayer" class="avatar-layer avatar-full" :src="src" :alt="alt" :style="mediaStyle"
      loading="lazy" @load="handleFullLoad" @error="handleFullError" @click="toggleImagePreview" />
    <Teleport to="body">
      <el-image-viewer v-if="showPreview && isPreview" :url-list="[src]" show-progress :initial-index="0"
        @close="showPreview = false" />
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.progressive-avatar {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: inherit;
  background: #f3f4f6;

  &.circle {
    border-radius: 999px;
  }

  &.square {
    border-radius: 6px;
  }
}

.avatar-layer,
.avatar-fallback {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  background: inherit;
}

// .avatar-thumb {
//   filter: blur(10px);
// }

// .avatar-full {
//   opacity: 0;
// }

// .full-ready .avatar-full {
//   opacity: 1;
// }</style>
