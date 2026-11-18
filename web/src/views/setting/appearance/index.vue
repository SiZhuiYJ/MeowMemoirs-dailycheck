<script setup lang="ts">
import { storeToRefs } from "pinia";
import ProgressiveAvatar from "@/components/ProgressiveAvatar/index.vue";
import ImageUploader from "@/features/file/components/ImageUploader.vue";
import { dataURLToFile } from "@/features/setting/composables/useImage";
import { SettingApi } from "@/features/setting/api";
import { useAuthStore } from "@/stores";
import { notifyError, notifySuccess } from "@/utils/notification";
import { getUserAvatarSources } from "@/utils/avatar";

const authStore = useAuthStore();
const { user } = storeToRefs(authStore);

/** 是否已设置自定义背景（决定「恢复默认背景」是否可用）。 */
const hasCustomBackground = computed(() => Boolean(user.value?.profileBackgroundKey));

/**
 * 头像卡背景：优先自定义背景，未设置时回退头像图。
 * 原图用于最终展示，缩略图先铺底避免大图加载前的空白。
 */
const background = computed(() =>
  getUserAvatarSources(
    user.value?.userId,
    user.value?.profileBackgroundKey || user.value?.avatarKey,
  ),
);

/** 头像卡上的小头像。 */
const avatar = computed(() =>
  getUserAvatarSources(user.value?.userId, user.value?.avatarKey),
);

const displayName = computed(
  () => user.value?.nickName || user.value?.userAccount || "喵咪用户",
);

const accountText = computed(() => {
  if (user.value?.userAccount) return `@${user.value.userAccount}`;
  return user.value?.email || "";
});

const fallbackText = computed(() =>
  (displayName.value || "U").slice(0, 1).toUpperCase(),
);

/** 大图加载完成后淡入（缩略图先铺底）。 */
const backgroundLoaded = ref(false);

watch(
  () => background.value.src,
  () => {
    backgroundLoaded.value = false;
  },
);

// —— 更换背景（1:1 裁剪 → 上传）——

/** 裁剪区是否展开。 */
const showUploader = ref(false);
/** 裁剪结果 dataURL。 */
const croppedData = ref<string>();
/** 上传中 / 恢复默认中。 */
const uploading = ref(false);
const resetting = ref(false);

function toggleUploader() {
  showUploader.value = !showUploader.value;
  if (!showUploader.value) croppedData.value = undefined;
}

function onCropped(data: string) {
  croppedData.value = data;
}

async function saveBackground() {
  if (!croppedData.value || uploading.value) return;

  const file = dataURLToFile(croppedData.value, "profile-background.png");
  if (!file) {
    notifyError("裁剪结果无效，请重新选择图片");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  uploading.value = true;
  try {
    const res = await SettingApi.UploadProfileBackground(formData);
    const key = res.data?.key;
    if (!key) {
      notifyError("背景图上传失败");
      return;
    }

    authStore.updateUser({ profileBackgroundKey: key });
    notifySuccess("背景图上传成功");
    croppedData.value = undefined;
    showUploader.value = false;
  } catch (error) {
    console.error("[setting/appearance] 背景图上传失败", error);
    notifyError("背景图上传失败");
  } finally {
    uploading.value = false;
  }
}

/** 恢复默认背景：删除自定义背景，回退到用头像图作背景。 */
async function restoreDefault() {
  if (resetting.value || !hasCustomBackground.value) return;

  resetting.value = true;
  try {
    await SettingApi.DeleteProfileBackground();
    authStore.updateUser({ profileBackgroundKey: null });
    notifySuccess("已恢复默认背景");
  } catch (error) {
    console.error("[setting/appearance] 恢复默认背景失败", error);
    notifyError("恢复默认背景失败");
  } finally {
    resetting.value = false;
  }
}
</script>

<template>
  <div class="setting-subpage">
    <!-- 预览：模拟个人主页头像卡 -->
    <div class="setting-card">
      <div class="setting-header">
        <h3 class="setting-title">头像背景</h3>
        <p class="setting-subtitle">
          自定义个人主页头像卡的背景图，未设置时自动使用头像图作背景。
        </p>
      </div>

      <div class="appearance-preview" :class="{ 'is-empty': !background.src }">
        <template v-if="background.src">
          <img v-if="background.thumbnailSrc" class="appearance-bg appearance-bg-thumb" :src="background.thumbnailSrc"
            alt="" aria-hidden="true" />
          <img class="appearance-bg appearance-bg-full" :class="{ 'is-loaded': backgroundLoaded }" :src="background.src"
            alt="个人主页头像卡背景预览" @load="backgroundLoaded = true" />
          <div class="appearance-fade" aria-hidden="true"></div>

          <div class="appearance-identity">
            <ProgressiveAvatar class="appearance-avatar" :src="avatar.src" :thumbnail-src="avatar.thumbnailSrc"
              :size="56" shape="circle" alt="头像">
              <span class="appearance-avatar-fallback">{{ fallbackText }}</span>
            </ProgressiveAvatar>
            <div class="appearance-user">
              <span class="appearance-name">{{ displayName }}</span>
              <span v-if="accountText" class="appearance-account">{{ accountText }}</span>
            </div>
          </div>

          <span class="appearance-tip">
            {{ hasCustomBackground ? "当前为自定义背景" : "当前使用头像图作背景" }}
          </span>
        </template>

        <div v-else class="appearance-placeholder">
          <span class="appearance-placeholder-title">暂无可预览的背景</span>
          <span class="appearance-placeholder-desc">上传头像或设置自定义背景后会在这里预览。</span>
        </div>
      </div>

      <p class="setting-desc">这就是个人主页顶部头像卡的背景效果，上传后立即生效。</p>

      <div class="appearance-actions">
        <el-button type="primary" @click="toggleUploader">
          {{ showUploader ? "收起裁剪" : "更换背景" }}
        </el-button>
        <el-button :disabled="!hasCustomBackground" :loading="resetting" @click="restoreDefault">
          恢复默认背景
        </el-button>
      </div>
    </div>

    <!-- 1:1 裁剪上传 -->
    <div v-if="showUploader" class="setting-card">
      <div class="setting-header">
        <h3 class="setting-title">裁剪并上传</h3>
        <p class="setting-subtitle">按 1:1 裁剪出想要展示的区域，保存后立即应用到头像卡。</p>
      </div>

      <div class="appearance-uploader">
        <ImageUploader @crop="onCropped" />
        <el-button v-if="croppedData" type="primary" :loading="uploading" @click="saveBackground">
          保存背景
        </el-button>
      </div>
    </div>

    <div class="setting-card">
      <div class="setting-header">
        <h3 class="setting-title">关于背景图</h3>
      </div>
      <p class="setting-desc">
        支持 JPG / PNG / WebP / HEIC 等常见图片格式，服务端会统一转成 WebP 并压缩到最长边 1600px，同时生成缩略占位图。
      </p>
      <p class="setting-desc">
        未设置自定义背景时，头像卡使用头像图作背景；恢复默认不会删除已上传的图片文件。
      </p>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 页面骨架（.setting-subpage / .setting-card / 标题 / 副标题）见
// features/setting/style/index.scss，这里只写本页独有的预览与上传布局。

.appearance-preview {
  position: relative;
  width: min(480px, 100%);
  margin: 0 auto;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px solid var(--chat-border);
  border-radius: 12px;
  background: var(--chat-inset);
}

.appearance-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.appearance-bg-thumb {
  // 缩略图先铺底，快速给出色彩轮廓
  filter: blur(6px);
  transform: scale(1.04);
}

.appearance-bg-full {
  opacity: 0;
  transition: opacity 0.32s ease;

  &.is-loaded {
    opacity: 1;
  }
}

// 底部渐变让头像 / 昵称在任何背景上都可读；颜色只走主题 surface token，
// 日间是浅色收尾、夜间是深色收尾，文字继续用 --chat-* 文本色。
.appearance-fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg,
      transparent 42%,
      color-mix(in srgb, var(--chat-surface-solid) 88%, transparent) 100%);
}

.appearance-identity {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
}

.appearance-avatar {
  flex-shrink: 0;
  border: 2px solid var(--chat-surface-solid);
  background: var(--avatar-fallback-bg);
}

.appearance-avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--chat-muted);
  font-size: 22px;
  font-weight: 600;
}

.appearance-user {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.appearance-name {
  overflow: hidden;
  color: var(--chat-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.appearance-account {
  overflow: hidden;
  color: var(--chat-muted);
  font-size: 11px;
  line-height: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// 右上角状态小胶囊：「当前为自定义背景 / 使用头像图」
.appearance-tip {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 2px 8px;
  border: 1px solid var(--chat-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--chat-surface-solid) 82%, transparent);
  color: var(--chat-muted);
  font-size: 11px;
  line-height: 16px;
  backdrop-filter: blur(6px);
}

.appearance-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 100%;
  padding: 0 16px;
  text-align: center;
}

.appearance-placeholder-title {
  color: var(--chat-text);
  font-size: 13px;
  font-weight: 600;
}

.appearance-placeholder-desc {
  color: var(--chat-muted);
  font-size: 11px;
  line-height: 17px;
}

.appearance-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.appearance-uploader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

@media (max-width: 480px) {
  .appearance-preview {
    aspect-ratio: 1 / 1;
  }
}
</style>
