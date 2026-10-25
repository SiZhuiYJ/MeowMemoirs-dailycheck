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

</style>
