<script setup lang="ts">
import { storeToRefs } from "pinia";
import AppDialog from "@/components/AppDialog.vue";
import ProgressiveAvatar from "@/components/ProgressiveAvatar/index.vue";
import ImageUploader from "@/features/file/components/ImageUploader.vue";
import { SettingApi } from "@/features/setting/api";
import { uploadFile, dataURLToFile } from "@/features/setting/composables/useImage";
import { useAuthStore } from "@/stores";
import { notifySuccess, notifyError } from "@/utils/notification";
import { getUserAvatarSources } from "@/utils/avatar";

const image = ref<string>();
const isUploadDisabled = ref(true);
const loading = ref(false);

const authStore = useAuthStore();
const { user } = storeToRefs(authStore);
const avatar = computed(() =>
  getUserAvatarSources(user.value?.userId, user.value?.avatarKey),
);

/** 是否有可用的「上次头像」；上传新头像后由 store 更新，按钮会自动出现。 */
const hasPreviousAvatar = computed(() => Boolean(user.value?.previousAvatarKey));

/** 对话框打开时读 store 的最新值（上传新头像后无需刷新页面）。 */
const previousAvatar = computed(() =>
  getUserAvatarSources(user.value?.userId, user.value?.previousAvatarKey),
);

const previousAvatarVisible = ref(false);
const switchingPreviousAvatar = ref(false);

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

function openPreviousAvatarDialog() {
  if (!hasPreviousAvatar.value) return;
  previousAvatarVisible.value = true;
}

async function usePreviousAvatar() {
  if (switchingPreviousAvatar.value) return;

  switchingPreviousAvatar.value = true;
  try {
    const response = await SettingApi.UsePreviousAvatar();
    const data = response.data;
    if (!data?.key) {
      notifyError("切换头像失败: 返回数据无效");
      return;
    }

    // previousKey 为 undefined（老后端）时 updateUser 会保持原值。
    authStore.updateUser({
      avatarKey: data.key,
      previousAvatarKey: data.previousKey,
    });
    previousAvatarVisible.value = false;
    notifySuccess("已切换为上次头像");
  } catch (error) {
    // 请求已关闭 http 层的全局提示，这里按状态码给唯一一条提示。
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 400) {
      notifyError("暂无可用的上次头像");
    } else if (status === 404) {
      notifyError("用户不存在，请重新登录");
    } else {
      notifyError("切换头像失败，请稍后重试");
    }
    console.error("切换上次头像失败:", error);
  } finally {
    switchingPreviousAvatar.value = false;
  }
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
        <div class="avatar-frame">
          <ProgressiveAvatar class="avatar-preview" :src="avatar.src" :thumbnail-src="avatar.thumbnailSrc"
            :is-preview="true" width="100%" :height="0" shape="square">
            <span class="avatar-text-large">
              {{ getFallbackText() }}
            </span>
          </ProgressiveAvatar>
        </div>

        <ImageUploader @crop="onCropped" />

        <el-button type="primary" :disabled="isUploadDisabled" :loading="loading" @click="uploadImage">
          更新头像
        </el-button>

        <!-- 入口始终展示：没有上次头像时禁用并说明，避免用户以为功能没上线 -->
        <el-tooltip :disabled="hasPreviousAvatar" content="更换一次头像后，可在这里切回上次使用的头像" placement="top">
          <span class="previous-avatar-entry">
            <el-button plain :disabled="!hasPreviousAvatar" @click="openPreviousAvatarDialog">
              使用上次头像
            </el-button>
          </span>
        </el-tooltip>
      </div>
    </div>

    <AppDialog v-model="previousAvatarVisible" title="上次使用的头像" content-width="380px"
      :closable="!switchingPreviousAvatar" :close-on-click-modal="!switchingPreviousAvatar"
      :close-on-press-escape="!switchingPreviousAvatar" :show-close="!switchingPreviousAvatar">
      <div class="previous-avatar-dialog">
        <div class="previous-avatar-frame">
          <ProgressiveAvatar :src="previousAvatar.src" :thumbnail-src="previousAvatar.thumbnailSrc"
            :width="200" :height="200" shape="square" alt="上次使用的头像">
            <span class="avatar-text-large">
              {{ getFallbackText() }}
            </span>
          </ProgressiveAvatar>
        </div>
        <p class="previous-avatar-tip">
          切换后当前头像会与上次头像互换，可再次切换回来。
        </p>
      </div>

      <template #footer>
        <el-button :disabled="switchingPreviousAvatar" @click="previousAvatarVisible = false">
          取消
        </el-button>
        <el-button type="primary" :loading="switchingPreviousAvatar" @click="usePreviousAvatar">
          使用该头像
        </el-button>
      </template>
    </AppDialog>
  </div>
</template>

<style scoped lang="scss">
// 页面骨架见 features/setting/style/index.scss。
.avatar-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
}

// 外层定宽：padding-bottom: 100% 的百分比是相对**包含块**的宽度，
// 所以方形预览必须由这个固定宽度的容器来撑，不能直接给头像设 width: 240px。
.avatar-frame {
  width: min(240px, 100%);
}

.avatar-preview {
  padding-bottom: 100%;
  border-radius: 12px;
}

.avatar-text-large {
  width: 120px;
  height: 120px;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  background-color: var(--theme-primary-bg);
  border-radius: 12px;
  font-size: 36px;
  color: var(--theme-color-contrast);
}

.previous-avatar-dialog {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.previous-avatar-frame {
  width: 200px;
  height: 200px;
}

.previous-avatar-tip {
  margin: 0;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

/* 包一层 span：el-tooltip 在 disabled 按钮上需要可触发事件的外层元素 */
.previous-avatar-entry {
  display: inline-flex;
}
</style>
