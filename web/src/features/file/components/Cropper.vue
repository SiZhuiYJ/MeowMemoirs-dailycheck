<script setup lang="ts">
import "vue-cropper/dist/index.css";
import { reactive, watch, useTemplateRef } from "vue";
import { VueCropper } from "vue-cropper";

const props = defineProps<{ img: string; size?: number }>();
const emit = defineEmits<{
  (e: "crop", data: string): void;
}>();

// const cropper = ref<any>(null);
const cropper = useTemplateRef("cropperRef");

const option = reactive<any>({
  img: props.img || "",
  autoCrop: true,
  // 固定裁剪框为 1:1
  fixed: true,
  // 限制裁剪框在图片内
  full: true,
  infoTrue: false,
  centerBox: true,
  outputSize: 1,
  // 使用 png 无损输出以保证最高画质
  outputType: "png",
  // 一些版本支持 fixedNumber/fixed-number 用于指定比例
  fixedNumber: [1, 1],
});

watch(
  () => props.img,
  (v) => {
    option.img = v || "";
  },
);

const doCrop = () => {
  if (!cropper.value) return;
  cropper.value.getCropData((data: string) => {
    emit("crop", data);
  });
};
</script>

<template>
  <div class="cropper-wrapper" :style="props.size ? `--size:${props.size}px` : ''">
    <vue-cropper ref="cropperRef" :img="option.img" :auto-crop="option.autoCrop" :fixed="option.fixed"
      :full="option.full" :info-true="option.infoTrue" :center-box="option.centerBox" :output-size="option.outputSize"
      :output-type="option.outputType" :fixed-number="option.fixedNumber">
    </vue-cropper>
  </div>
  <div style="margin-top: 20px; text-align: center">
    <button type="button" @click="doCrop">截取并返回图片</button>
  </div>
</template>

<style scoped lang="scss">
.cropper-wrapper {
  --size: 400px;
  // 固定 400px 在手机上会横向顶破卡片（头像页就踩过）：
  // 宽度跟着容器收缩，再用 aspect-ratio 撑成正方形；
  // 裁剪框内部是 100% x 100%，仍然拿到确定的宽高。
  width: min(var(--size), 100%);
  aspect-ratio: 1 / 1;
  height: auto;
  box-sizing: border-box;
  overflow: hidden;
  border: 10px solid var(--chat-surface-solid);
  border-radius: 8px;
  box-shadow: var(--theme-outer-glow-lighter);
}

button {
  height: var(--setting-input-h, 36px);
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--theme-action-bg);
  background: var(--theme-action-bg);
  color: var(--theme-action-contrast);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;
}

button:hover {
  background: var(--theme-action-hover);
}
</style>
