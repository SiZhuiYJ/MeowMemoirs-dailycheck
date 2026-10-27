<script setup lang="ts">
import { ref, watch } from "vue";
import { convertToWebP } from "@/utils/convertToWebP";
import { isHeicFile } from "@/utils/heic";
import { notifyError } from "@/utils/notification";
import Cropper from "./Cropper.vue";

const emit = defineEmits<{
  (e: "crop", data: string): void;
}>();

const imgSrc = ref<string>("");
const cropped = ref<string>("");
const croppedWidth = ref<number | null>(null);
const croppedHeight = ref<number | null>(null);

/** 连续选图时只认最后一次，避免慢速 HEIC 解码覆盖新选择的图。 */
let loadToken = 0;

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

async function handleFilesChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // 立刻清空，保证同一个文件再选一次也会触发 change
  input.value = "";
  if (!file) return;

  const token = ++loadToken;
  cropped.value = "";

  // 浏览器不能直接解码 HEIC；先转成 WebP/DataURL 再交给裁剪器。
  if (isHeicFile(file)) {
    try {
      const dataUrl = (await convertToWebP(file, {
        quality: 0.95,
        maxWidth: 2048,
        maxHeight: 2048,
        output: "dataURL",
      })) as string;
      if (token === loadToken) imgSrc.value = dataUrl;
    } catch {
      if (token === loadToken) {
        imgSrc.value = "";
        notifyError("HEIC 图片解析失败，请改用 JPG/PNG 格式");
      }
    }
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    if (token !== loadToken) return;
    imgSrc.value = reader.result as string;
  };
  reader.onerror = () => {
    if (token === loadToken) notifyError("图片读取失败");
  };
  reader.readAsDataURL(file);
}
</script>

<template>
  <div class="uploader">
    <label style="margin-bottom: 12px" class="upload-button" aria-label="上传文件按钮">
      <input type="file" id="realFileInput" name="uploadFile" aria-label="选择文件" accept="image/*,.heic,.heif,.hif"
        @change="handleFilesChange" />
    </label>

    <div v-if="imgSrc" class="upload-panel">
      <div class="upload-panel-title">裁剪区域</div>
      <Cropper :img="imgSrc" @crop="onCropped" />
    </div>

    <div v-if="cropped" class="upload-result">
      <div class="upload-panel-title">裁剪结果预览</div>
      <!-- max-width 补一个 100% 上限：只写 320px 时，360px 宽的手机上
           预览图加上外层 margin 会横向顶破容器 -->
      <img :src="cropped" alt="cropped" class="upload-result-image" />
      <div class="upload-result-meta">
        尺寸:
        <span v-if="croppedWidth !== null">{{ croppedWidth }}x{{ croppedHeight }}</span><span v-else>已生成</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.uploader {
  display: flex;
  flex-direction: column;
  align-items: center;
  // 不写宽度时，作为 .avatar-main（align-items: center）的 flex 子项会被压到
  // 只有「加号按钮」那么宽，裁剪框也跟着缩成一百多像素；这里给一个上限，
  // 窄屏再跟容器收缩。
  width: min(360px, 100%);
}

// 裁剪区 / 预览区也跟随聊天页的 --chat-* 皮肤（设置页头像、打卡上传共用）。
.upload-panel {
  width: 100%;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid var(--chat-border);
  border-radius: 10px;
  background: var(--chat-surface-solid);
}

.upload-panel-title {
  margin-bottom: 8px;
  color: var(--chat-text);
  font-size: 12px;
  font-weight: 600;
}

.upload-result {
  width: 100%;
  margin-top: 16px;
}

.upload-result-image {
  display: block;
  max-width: min(320px, 100%);
  margin: 0 auto;
  border: 1px solid var(--chat-border);
  border-radius: 8px;
}

.upload-result-meta {
  margin-top: 8px;
  color: var(--chat-muted);
  font-size: 12px;
  text-align: center;
}
</style>
