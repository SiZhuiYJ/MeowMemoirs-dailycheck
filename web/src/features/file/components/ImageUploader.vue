<script setup lang="ts">
import { ref, watch } from "vue";
import Cropper from "./Cropper.vue";

const emit = defineEmits<{
  (e: "crop", data: string): void;
}>();

const imgSrc = ref<string>("");
const cropped = ref<string>("");
const croppedWidth = ref<number | null>(null);
const croppedHeight = ref<number | null>(null);

const onCropped = (data: string) => {
  // console.log(data);
  cropped.value = data;
  emit('crop', data)
};

watch(cropped, (v) => {
  croppedWidth.value = null;
  croppedHeight.value = null;
  if (!v) return;
  const img = new Image();
  img.onload = () => {
    croppedWidth.value = img.width;
    croppedHeight.value = img.height;
  };
  img.src = v;
});
function handleFilesChange(event: Event) {
  const files = (event.target as HTMLInputElement).files;
  if (!files || !files[0]) return;
  const file = files[0];
  const reader = new FileReader();
  reader.onload = () => {
    imgSrc.value = reader.result as string;
    cropped.value = "";
  };
  reader.readAsDataURL(file);
}
</script>

<template>
  <div class="uploader">
    <label style="margin-bottom: 12px" class="upload-button" aria-label="上传文件按钮">
      <input type="file" id="realFileInput" name="uploadFile" aria-label="选择文件" accept="image/*"
        @change="handleFilesChange" />
    </label>

    <div v-if="imgSrc" style="border: 1px solid #eaeaea; padding: 10px">
      <div style="margin-bottom: 8px; font-weight: 600">裁剪区域</div>
      <Cropper :img="imgSrc" @crop="onCropped" />
    </div>

    <div v-if="cropped" style="margin: 16px">
      <div style="margin-bottom: 8px; font-weight: 600">裁剪结果预览</div>
      <!-- max-width 补一个 100% 上限：只写 320px 时，360px 宽的手机上
           预览图加上外层 margin 会横向顶破容器 -->
      <img :src="cropped" alt="cropped" style="max-width: min(320px, 100%); border: 1px solid #ddd" />
      <div style="margin-top: 8px">
        尺寸:
        <span v-if="croppedWidth !== null">{{ croppedWidth }}x{{ croppedHeight }}</span><span v-else>已生成</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.uploader {
  display: flex;
  flex-direction: column;
}

.upload-button {
  position: relative;
  /* 让内部的 absolute input 可以填满 */
  display: block;
  width: 80px;
  /* 正方形尺寸，可自由调整 */
  height: 80px;
  border-radius: 8px;
  /* 圆角正方形，够圆润 */
  background-color: var(--theme-color-softer);
  /* 主题色最浅的底色 */
  border: 1px solid var(--border-color);
  /* 使用纯CSS渐变绘制“加号”：两个垂直的矩形背景，居中，不重复 */
  background-image:
    linear-gradient(var(--text-muted), var(--text-muted)),
    /* 水平条（横） */
    linear-gradient(var(--text-muted), var(--text-muted));
  /* 垂直条（竖） */
  background-repeat: no-repeat;
  background-position: center;
  /* 加号尺寸：横条 48x8，竖条 8x48，在120x120里显得醒目又优雅 */
  background-size:
    32px 2px,
    2px 32px;

  /* 柔和阴影，增加立体感 */
  box-shadow: 0 8px 16px -6px rgba(var(--theme-color-rgb), 0.4);

  /* 过渡效果，用于焦点或悬停时的反馈 */
  transition:
    background-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.1s ease;
  cursor: pointer;
  /* 提示可点击 */


  /* 当按钮被点击（按下）时轻微的缩放感 */
  &:active {
    transform: scale(0.97);
  }

  /* 当内部隐藏的input获得焦点时，给按钮加上发光外圈 — 键盘友好 */
  &:focus-within {
    outline: none;
    box-shadow:
      0 0 0 2px var(--theme-color-soft),
      0 4px 16px -6px var(--theme-color-strong);
    background-color: var(--theme-color-soft);
    /* 稍微深一点的底色，反馈焦点 */
  }

  /* 鼠标悬停时，底色稍微加深，加号颜色也可以微调 —— 这里保留加号颜色不变，改变背景色 */
  &:hover {
    background-color: var(--theme-color-soft);
    /* 稍微明显的悬停色 */
  }

  /* 真正的 input[type=file] 被透明地覆盖在整个按钮上，保证点击区域精准，同时隐藏原生样式 */
  input[type="file"] {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    /* 完全透明，但依然可点击、可聚焦 */
    cursor: pointer;
    /* 明确指针形状 */
    z-index: 2;
    /* 确保它在上层接收点击（背景在下面） */
    margin: 0;
    /* 移除默认边距 */
    padding: 0;
    border: none;
    /* 以下为兼容屏幕阅读器，保留元素尺寸且可聚焦 */
    font-size: 0;
    /* 避免极少数浏览器出现文本节点 */
  }
}
</style>
