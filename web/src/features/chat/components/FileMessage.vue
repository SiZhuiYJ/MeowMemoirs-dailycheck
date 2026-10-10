<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { CircleCloseFilled, Loading, WarningFilled } from '@element-plus/icons-vue';
import SvgIcon from '@/components/SvgIcon/index.vue';
import { Download } from "@element-plus/icons-vue"
import { notifyError } from '@/utils/notification';
import { useFileDownloader } from '../composables/useFileDownloader';
import type { FileExtra, MessageSummary, PendingUpload } from '../types';
import { formatFileSize, getDocumentIconType, getFilePreviewType, getFileTypeLabel, isPreviewableFileType, parseMessageExtra } from '../utils/fileMeta';

const props = defineProps<{
  message?: MessageSummary | null;
  pendingUpload?: PendingUpload | null;
  showDownload?: boolean;
  src: string;
  isNewMessage?: boolean;
  allowInlineMediaLoad?: boolean;
}>();

const emit = defineEmits<{
  mediaSettled: [payload: { messageId: number; ready: boolean }];
}>();

interface GalleryFile {
  name: string;
  url: string;
  type: string;
  path?: string;
  messageId?: number;
}

const gallery = inject<{
  register: (file: GalleryFile) => void;
  open: (url?: string) => void;
}>('gallery');

const PREVIEW_SIZE_LIMIT = 15 * 1024 * 1024;

const fileExtra = computed<FileExtra | null>(() =>
  props.pendingUpload?.fileExtra ?? parseMessageExtra(props.message?.extra),
);
const category = computed(() => getFilePreviewType(fileExtra.value));
const documentIconName = computed(() => `document-${getDocumentIconType(category.value, fileExtra.value)}`);
const displayType = computed(() => getFileTypeLabel(category.value));
const isPreviewable = computed(() => isPreviewableFileType(category.value));
const isLargeForPreview = computed(() => (fileExtra.value?.fileSize ?? 0) > PREVIEW_SIZE_LIMIT);
const isUploading = computed(() => props.pendingUpload?.status === 'uploading');
const isFailed = computed(() => props.pendingUpload?.status === 'failed');
const uploadProgress = computed(() => Math.max(0, Math.min(100, props.pendingUpload?.progress ?? 0)));

const previewUrl = ref('');
const thumbnailUrl = ref('');
const previewLoading = ref(false);
const thumbnailLoading = ref(false);
const hasError = ref(false);
const loadProgress = ref(0);
const loadStatus = ref<'idle' | 'loading' | 'error'>('idle');
const isPrepared = ref(false);
const settledMessageId = ref<number | null>(null);

const { requestBlobUrl, requestDownload, downloadAndSaveFile } = useFileDownloader();

const imageDisplayUrl = computed(() => {
  const localPreviewUrl = fileExtra.value?.localPreviewUrl;
  if (localPreviewUrl) return localPreviewUrl;

  if (previewUrl.value) return previewUrl.value;

  const fileUrl = fileExtra.value?.fileUrl;
  if (fileUrl && (fileUrl.startsWith('blob:') || fileUrl.startsWith('data:'))) {
    return fileUrl;
  }

  return '';
});
const videoCoverUrl = computed(() =>
  fileExtra.value?.localThumbnailUrl || thumbnailUrl.value || '',
);
const uploadMaskStyle = computed(() => ({
  '--upload-progress': `${uploadProgress.value}%`,
}));
const documentProgressStyle = computed(() => ({
  width: `${uploadProgress.value}%`,
}));

watch(
  () => ({
    fileKey: fileExtra.value?.fileKey,
    thumbnailKey: fileExtra.value?.thumbnailUrl,
    category: category.value,
    localPreviewUrl: fileExtra.value?.localPreviewUrl,
    localThumbnailUrl: fileExtra.value?.localThumbnailUrl,
    uploading: isUploading.value,
    allowInlineMediaLoad: props.allowInlineMediaLoad,
  }),
  () => {
    previewUrl.value = '';
    thumbnailUrl.value = '';
    previewLoading.value = false;
    thumbnailLoading.value = false;
    hasError.value = false;
    loadProgress.value = 0;
    loadStatus.value = 'idle';
    isPrepared.value = false;
    settledMessageId.value = null;
    loadInlineMedia();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  loadStatus.value = 'idle';
});

function beginLoadStatus() {
  loadProgress.value = 0;
  loadStatus.value = 'loading';
}

function updateLoadProgress(progress: number) {
  if (loadStatus.value !== 'loading') return;
  loadProgress.value = Math.min(progress, 99);
}

function markPrepared() {
  loadProgress.value = 100;
  loadStatus.value = 'idle';
  isPrepared.value = true;
}

function notifyMediaSettled(ready: boolean) {
  const messageId = props.message?.id;
  if (!messageId || props.pendingUpload) return;
  if (category.value !== 'image' && category.value !== 'video') return;
  if (settledMessageId.value === messageId) return;
  settledMessageId.value = messageId;
  emit('mediaSettled', { messageId, ready });
}

function registerToGlobalGallery(url: string) {
  if (!gallery || !fileExtra.value || props.pendingUpload) return;
  gallery.register({
    name: fileExtra.value.fileName,
    url,
    type: category.value,
    path: category.value === 'image' ? url : videoCoverUrl.value || props.src,
    messageId: props.message?.id,
  });
}

function openGlobalPreview(url = previewUrl.value) {
  if (!url || props.pendingUpload) return;
  gallery?.open(url);
}

function openCachedPreview() {
  if (!previewUrl.value) return false;
  isPrepared.value = true;
  registerToGlobalGallery(previewUrl.value);
  openGlobalPreview(previewUrl.value);
  return true;
}

function setPreviewUrl(blobUrl: string) {
  markPrepared();
  previewUrl.value = blobUrl;
  registerToGlobalGallery(blobUrl);
  openGlobalPreview(blobUrl);
}

function loadInlineMedia() {
  const currentFile = fileExtra.value;
  if (!currentFile?.fileKey || isUploading.value || props.pendingUpload) return;

  if (props.allowInlineMediaLoad === false && (category.value === 'image' || category.value === 'video')) {
    return;
  }

  if (category.value === 'image') {
    const fileKey = currentFile.fileKey;
    previewLoading.value = true;
    requestBlobUrl(fileKey, {
      isNew: props.isNewMessage ?? false,
      priorityId: props.message?.id,
      onComplete: (blobUrl: string) => {
        if (fileExtra.value?.fileKey !== fileKey) return;
        previewUrl.value = blobUrl;
        previewLoading.value = false;
        isPrepared.value = true;
        registerToGlobalGallery(blobUrl);
        notifyMediaSettled(true);
      },
      onError: (error: Error) => {
        if (fileExtra.value?.fileKey !== fileKey) return;
        handlePreviewError(error);
        notifyMediaSettled(false);
      },
    });
    return;
  }

  if (category.value === 'video' && currentFile.thumbnailUrl) {
    const thumbnailKey = currentFile.thumbnailUrl;
    thumbnailLoading.value = true;
    requestBlobUrl(thumbnailKey, {
      isNew: props.isNewMessage ?? false,
      priorityId: props.message?.id,
      onComplete: (blobUrl: string) => {
        if (fileExtra.value?.thumbnailUrl !== thumbnailKey) return;
        thumbnailUrl.value = blobUrl;
        thumbnailLoading.value = false;
        notifyMediaSettled(true);
      },
      onError: (error: Error) => {
        if (fileExtra.value?.thumbnailUrl !== thumbnailKey) return;
        console.error('FileMessage thumbnail failed:', error);
        thumbnailLoading.value = false;
        notifyMediaSettled(false);
      },
    });
  }
}

function handlePreviewError(error: Error) {
  console.error('FileMessage preview failed:', error);
  previewLoading.value = false;
  hasError.value = true;
  loadStatus.value = 'error';
  notifyError('文件加载失败，请稍后重试');
}

async function triggerPreview() {
  if (!fileExtra.value?.fileKey || previewLoading.value || isUploading.value || isFailed.value || props.pendingUpload) {
    return;
  }

  if (!isPreviewable.value) {
    previewLoading.value = true;
    hasError.value = false;
    beginLoadStatus();
    requestDownload({
      fileKey: fileExtra.value.fileKey,
      category: category.value,
      priorityId: props.message?.id,
      onProgress: (progress: number) => {
        updateLoadProgress(progress);
      },
      onComplete: () => {
        previewLoading.value = false;
        markPrepared();
        void handleDownload();
      },
      onError: handlePreviewError,
    }, props.isNewMessage ?? true);
    return;
  }

  if (isLargeForPreview.value) {
    notifyError('文件过大，请下载后查看');
    return;
  }

  if (openCachedPreview()) return;

  previewLoading.value = true;
  hasError.value = false;
  beginLoadStatus();

  requestDownload({
    fileKey: fileExtra.value.fileKey,
    category: category.value,
    priorityId: props.message?.id,
    thumbnailUrl: category.value === 'video' ? fileExtra.value.thumbnailUrl : undefined,
    onComplete: (blobUrl: string) => {
      previewLoading.value = false;
      setPreviewUrl(blobUrl);
    },
    onThumbnailComplete: (blobUrl: string) => {
      thumbnailUrl.value = blobUrl;
    },
    onProgress: (progress: number) => {
      updateLoadProgress(progress);
    },
    onError: handlePreviewError,
  }, props.isNewMessage ?? true);
}

async function handleDownload() {
  if (!fileExtra.value?.fileKey || isUploading.value || props.pendingUpload) return;
  await downloadAndSaveFile(fileExtra.value.fileKey, fileExtra.value.fileName);
}

function handleClick() {
  if (!fileExtra.value || isUploading.value || props.pendingUpload) return;
  void triggerPreview();
}

const imageStyle = computed(() => {
  if (!fileExtra.value) return {};
  const maxWidth = 300;
  const maxHeight = 300;
  if (fileExtra.value.width && fileExtra.value.height) {
    const ratio = Math.min(maxWidth / fileExtra.value.width, maxHeight / fileExtra.value.height, 1);
    return { width: `${fileExtra.value.width * ratio}px`, height: `${fileExtra.value.height * ratio}px` };
  }
  return { maxWidth: `${maxWidth}px`, maxHeight: `${maxHeight}px` };
});

function handleImageError(event: Event) {
  hasError.value = true;
  const img = event.target as HTMLImageElement;
  img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999"%3Eerror%3C/text%3E%3C/svg%3E';
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
</script>

<template>
  <div class="file-message" :class="{ uploading: isUploading, failed: isFailed }" @click="handleClick">
    <template v-if="fileExtra">
      <div class="file-item-wrap">
        <div v-if="category === 'image'" class="image-message">
          <img v-if="imageDisplayUrl && !hasError" :src="imageDisplayUrl" :alt="fileExtra.fileName" :style="imageStyle"
            @error="handleImageError" loading="lazy" />
          <div v-else-if="previewLoading" class="image-loading">
            <el-icon class="is-loading">
              <Loading />
            </el-icon>
            <span>加载中...</span>
          </div>
          <div v-else-if="hasError" class="image-error-placeholder">
            <el-icon>
              <WarningFilled />
            </el-icon>
            <span>图片加载失败</span>
          </div>
          <div v-else class="image-placeholder">
            <svg-icon icon-class="document-png" size="48px" />
            <span>{{ fileExtra.fileName }}</span>
            <span>{{ formatFileSize(fileExtra.fileSize) }}</span>
          </div>

          <div v-if="isUploading && imageDisplayUrl" class="upload-visual-overlay" :style="uploadMaskStyle">
            <div class="upload-progress-badge">{{ uploadProgress }}%</div>
          </div>

          <div v-else-if="showDownload && previewUrl && !hasError" class="image-overlay">
            <el-button size="small" circle @click.stop="handleDownload">
              <el-icon>
                <Download />
              </el-icon>
            </el-button>
          </div>
        </div>

        <div v-else-if="category === 'video'" class="video-message">
          <div v-if="videoCoverUrl" class="video-cover">
            <img :src="videoCoverUrl" :alt="fileExtra.fileName" loading="lazy" />
            <div v-if="isUploading" class="upload-visual-overlay" :style="uploadMaskStyle">
              <div class="upload-progress-badge">{{ uploadProgress }}%</div>
            </div>
            <div v-else class="video-cover-overlay">
              <el-icon v-if="previewLoading" class="is-loading" :size="28">
                <Loading />
              </el-icon>
              <svg-icon v-else icon-class="general-play" size="32px" />
            </div>
          </div>
          <div v-else-if="isUploading" class="media-loading uploading-placeholder">
            <el-icon class="is-loading">
              <Loading />
            </el-icon>
            <span>提取封面中 {{ uploadProgress }}%</span>
            <div class="upload-progress-badge">{{ uploadProgress }}%</div>
          </div>
          <div v-else-if="thumbnailLoading" class="media-loading">
            <el-icon class="is-loading">
              <Loading />
            </el-icon>
            <span>加载封面中...</span>
          </div>
          <div v-else-if="hasError" class="media-error-placeholder">
            <el-icon>
              <WarningFilled />
            </el-icon>
            <span>视频加载失败</span>
          </div>
          <div v-else class="media-placeholder">
            <svg-icon icon-class="document-video" size="48px" />
            <span>{{ previewLoading ? '加载视频中...' : '点击加载视频' }}</span>
          </div>
          <div class="file-info">
            <div class="file-name">{{ fileExtra.fileName }}</div>
            <div class="file-meta">
              <span>{{ formatFileSize(fileExtra.fileSize) }}</span>
              <span v-if="fileExtra.duration">{{ formatDuration(fileExtra.duration) }}</span>
              <span v-if="isUploading" class="status-text uploading">上传 {{ uploadProgress }}%</span>
              <span v-else-if="isFailed" class="status-text error">上传失败</span>
              <span v-else-if="loadStatus !== 'idle' || isPrepared" class="status-text"
                :class="{ ready: isPrepared, error: loadStatus === 'error' }">
                {{ isPrepared ? '可预览' : loadStatus === 'error' ? '加载失败' : `加载中 ${loadProgress}%` }}
              </span>
            </div>
          </div>
        </div>

        <div v-else-if="category === 'audio'" class="audio-message">
          <div class="audio-icon">
            <el-icon v-if="previewLoading || isUploading" class="is-loading" :size="24">
              <Loading />
            </el-icon>
            <el-icon v-else-if="hasError || isFailed" :size="24">
              <WarningFilled />
            </el-icon>
            <svg-icon v-else icon-class="document-voice" size="48px" />
          </div>
          <div class="audio-content">
            <div class="file-name">{{ fileExtra.fileName }}</div>
            <div class="file-meta">
              <span>{{ formatFileSize(fileExtra.fileSize) }}</span>
              <span v-if="fileExtra.duration">{{ formatDuration(fileExtra.duration) }}</span>
              <span v-if="isUploading" class="status-text uploading">上传 {{ uploadProgress }}%</span>
              <span v-else-if="isFailed" class="status-text error">上传失败</span>
              <span v-else-if="loadStatus !== 'idle' || isPrepared" class="status-text"
                :class="{ ready: isPrepared, error: loadStatus === 'error' }">
                {{ isPrepared ? '可预览' : loadStatus === 'error' ? '加载失败' : `加载中 ${loadProgress}%` }}
              </span>
            </div>
          </div>

          <el-button v-if="showDownload && !isUploading" size="small" circle class="download-btn"
            @click.stop="handleDownload">
            <el-icon>
              <Download />
            </el-icon>
          </el-button>
        </div>

        <div v-else class="document-message">
          <div class="document-icon" :class="category">
            <svg-icon :icon-class="documentIconName" size="48px" />
          </div>
          <div class="document-info">
            <div class="file-name" :title="fileExtra.fileName">{{ fileExtra.fileName }}</div>
            <div class="file-meta">
              <span>{{ formatFileSize(fileExtra.fileSize) }}</span>
              <span class="file-type">{{ displayType }}</span>
              <span v-if="isUploading" class="status-text uploading">上传 {{ uploadProgress }}%</span>
              <span v-else-if="isFailed" class="status-text error">上传失败</span>
              <span v-else-if="loadStatus !== 'idle' || isPrepared" class="status-text"
                :class="{ ready: isPrepared, error: loadStatus === 'error' }">
                {{ isPrepared ? '已就绪' : loadStatus === 'error' ? '加载失败' : `加载中 ${loadProgress}%` }}
              </span>
            </div>
            <div v-if="isUploading" class="document-upload-progress">
              <div class="document-upload-progress-bar" :style="documentProgressStyle"></div>
            </div>
          </div>
          <el-button v-if="showDownload && !isUploading" size="small" circle class="download-btn"
            @click.stop="handleDownload">
            <el-icon>
              <Download />
            </el-icon>
          </el-button>
        </div>

        <transition name="status-fade">
          <div v-if="!isUploading && !props.pendingUpload && (loadStatus === 'loading' || loadStatus === 'error')"
            class="file-load-status" :class="{ loading: loadStatus === 'loading', error: loadStatus === 'error' }">
            <el-icon v-if="loadStatus === 'loading'" class="status-icon is-loading">
              <Loading />
            </el-icon>
            <el-icon v-else class="status-icon">
              <CircleCloseFilled />
            </el-icon>

            <div class="status-text">
              {{ loadStatus === 'loading' ? `正在加载 ${Math.round(loadProgress)}%` : '加载失败，请重试' }}
            </div>
            <el-progress v-if="loadStatus === 'loading'" :percentage="loadProgress" :stroke-width="6" :show-text="false"
              color="#409eff" />
          </div>
        </transition>
      </div>
    </template>

    <div v-else class="file-error">
      <el-icon :size="24">
        <WarningFilled />
      </el-icon>
      <span>文件信息无效</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.file-message {
  max-width: 300px;
  cursor: pointer;
  user-select: none;

  &.uploading {
    cursor: default;
  }
}

.file-item-wrap {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  position: relative;
}

.file-load-status {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 20px);
  padding: 10px 12px;
  border-radius: 10px;
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.2);
  z-index: 3;
  pointer-events: none;
  color: #ffffff;

  &.loading {
    background: linear-gradient(120deg, rgba(59, 130, 246, 0.88), rgba(14, 116, 144, 0.84));
  }

  &.error {
    background: linear-gradient(120deg, rgba(244, 63, 94, 0.88), rgba(185, 28, 28, 0.84));
  }

  .status-icon {
    margin-right: 6px;
    vertical-align: middle;
    font-size: 14px;
  }

  .status-text {
    display: inline-flex;
    align-items: center;
    margin-bottom: 6px;
    font-size: 12px;
    line-height: 1.3;
    font-weight: 500;
  }
}

.status-fade-enter-active,
.status-fade-leave-active {
  transition: all 0.25s ease;
}

.status-fade-enter-from,
.status-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -6px);
}

.image-message {
  position: relative;
  display: inline-block;
  border-radius: 8px;
  overflow: hidden;

  img {
    display: block;
    border-radius: 8px;
    transition: transform 0.2s;
  }

  &:hover .image-overlay {
    opacity: 1;
  }
}

.image-loading,
.media-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  color: #999;
  font-size: 13px;
}

.image-placeholder,
.media-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 180px;
  min-height: 120px;
  padding: 20px;
  color: #777;
  font-size: 13px;
  background: #f5f5f5;
  border-radius: 8px;
  box-sizing: border-box;

  span {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.image-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  background: rgba(0, 0, 0, 0.3);
  transition: opacity 0.2s;
}

.upload-visual-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  pointer-events: none;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.82);
    -webkit-mask-image: radial-gradient(circle at center,
        transparent 0,
        transparent var(--upload-progress),
        #000 calc(var(--upload-progress) + 1%));
    mask-image: radial-gradient(circle at center,
        transparent 0,
        transparent var(--upload-progress),
        #000 calc(var(--upload-progress) + 1%));
  }
}

.upload-progress-badge {
  position: relative;
  z-index: 1;
  min-width: 58px;
  padding: 6px 12px;
  border-radius: 999px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  background: rgba(17, 24, 39, 0.74);
  backdrop-filter: blur(8px);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.24);
}

.image-error-placeholder,
.media-error-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  color: #999;
  font-size: 13px;
  background: #f5f5f5;
  border-radius: 8px;
}

.video-message {
  max-width: 200px;
  border-radius: 8px;
  overflow: hidden;
  background: #f5f5f5;

  .video-cover {
    position: relative;
    aspect-ratio: 16 / 9;
    background: #e5e7eb;

    img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
    }
  }

  .video-cover-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.22);
  }

  .file-info {
    padding: 8px 12px;

    .file-name {
      overflow: hidden;
      margin-bottom: 4px;
      color: #333;
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: #999;
      font-size: 12px;
    }
  }
}

.audio-message {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 300px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;

  .audio-icon {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .audio-content {
    flex: 1;
    min-width: 0;

    .file-name {
      overflow: hidden;
      color: #333;
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: #999;
      font-size: 12px;
    }
  }
}

.document-message {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 300px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
  transition: background-color 0.2s;

  &:hover {
    background: #e8e8e8;
  }

  .document-icon {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;

    &.document {
      background: #e3f2fd;
    }

    &.archive {
      background: #fff3e0;
    }

    &.unknown {
      background: #f5f5f5;
    }
  }

  .document-info {
    flex: 1;
    min-width: 0;
  }

  .file-name {
    overflow: hidden;
    margin-bottom: 4px;
    color: #333;
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    color: #999;
    font-size: 12px;
  }

  .file-type {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    background: #e0e0e0;
  }

  .download-btn {
    flex-shrink: 0;
  }
}

.document-upload-progress {
  height: 6px;
  margin-top: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.28);
}

.document-upload-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #111827, #475569);
  transition: width 0.16s linear;
}

.file-meta .status-text {
  display: inline-block;
  font-size: 12px;
  color: #909399;

  &.ready {
    color: #67c23a;
  }

  &.uploading {
    color: #2563eb;
  }

  &.error {
    color: #f56c6c;
  }
}

.file-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: #f56c6c;
  background: #fef0f0;
  border-radius: 8px;
}
</style>
