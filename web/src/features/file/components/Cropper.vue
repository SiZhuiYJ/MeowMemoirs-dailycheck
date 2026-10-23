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

<style scoped>
.cropper-wrapper {
  --size: 400px;
  box-shadow: 0 3px 5px 1px #cfcfcf;
  border: 10px solid white;
  width: var(--size);
  height: var(--size);
}

button {
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid var(--theme-action-bg);
  background: var(--theme-action-bg);
  color: var(--theme-action-contrast);
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;
}

button:hover {
  background: var(--theme-action-hover);
}
</style>
