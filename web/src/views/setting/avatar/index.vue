<script setup lang="ts">
import { storeToRefs } from "pinia";
import ProgressiveAvatar from "@/components/ProgressiveAvatar/index.vue";
import ImageUploader from "@/features/file/components/ImageUploader.vue";
import { uploadFile, dataURLToFile } from "@/features/setting/composables/useImage";
import { useAuthStore } from "@/stores";
import { notifySuccess } from "@/utils/notification";
import { getUserAvatarSources } from "@/utils/avatar";

const image = ref<string>();
const isUploadDisabled = ref(true);
const loading = ref(false);

const { user } = storeToRefs(useAuthStore());
const avatar = computed(() =>
  getUserAvatarSources(user.value?.userId, user.value?.avatarKey),
);

function getFallbackText() {
  return (
    user.value?.nickName ||
    user.value?.userAccount ||
    user.value?.email ||
    "U"
  )
    .slice(0, 1)
    .toUpperCase();
}

function onCropped(data: string) {
  image.value = data;
  isUploadDisabled.value = !data;
  notifySuccess("裁剪完成");
}

async function uploadImage() {
  if (!image.value) return;

  const imageFile = dataURLToFile(image.value, "avatar-cropped.png");
  if (!imageFile) return;

  await uploadFile(imageFile, loading);
  image.value = undefined;
  isUploadDisabled.value = true;
}
</script>

<template>
  <div class="setting-subpage">
    <div class="setting-card">
      <div class="setting-header">
        <h3 class="setting-title">头像修改</h3>
        <p class="setting-subtitle">
          裁剪后会自动生成缩略图并一并上传，展示时会先加载缩略图再淡入原图。
        </p>
      </div>

      <div class="avatar-main">
        <ProgressiveAvatar class="avatar-preview" :src="avatar.src" :thumbnail-src="avatar.thumbnailSrc"
          :is-preview="true" width="100%" :height="0" shape="square">
          <span class="avatar-text-large">
            {{ getFallbackText() }}
          </span>
        </ProgressiveAvatar>

        <ImageUploader @crop="onCropped" />

        <el-button type="primary" :disabled="isUploadDisabled" :loading="loading" @click="uploadImage">
          更新头像
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.setting-subpage {
  width: min(760px, 92vw);
  margin: 24px auto;
}

.setting-card {
  background-color: var(--bg-elevated);
  border-radius: 16px;
  padding: 24px;
  border: 1px solid var(--border-color);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.04);
}

.setting-header {
  margin-bottom: 16px;
}

.setting-title {
  margin: 0;
  font-size: 18px;
  color: var(--text-color);
}

.setting-subtitle {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.avatar-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
}

.avatar-preview {
  padding-bottom: 100%;
  border-radius: 16px;
}

.avatar-text-large {
  width: 120px;
  height: 120px;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  background-color: var(--accent-alt);
  border-radius: 16px;
  font-size: 36px;
  color: #fff;
}
</style>
