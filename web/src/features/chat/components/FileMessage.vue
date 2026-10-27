<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { CircleCloseFilled, Loading, WarningFilled } from '@element-plus/icons-vue';
import SvgIcon from '@/components/SvgIcon/index.vue';
import { notifyError } from '@/utils/notification';
import { useFileDownloader } from '../composables/useFileDownloader';
import type { FileExtra, MessageSummary, PendingUpload } from '../types';
import {
  formatFileSize,
  getDocumentIconType,
  getFilePreviewType,
  getFileTypeLabel,
  getFileTypeText,
  isPreviewableFileType,
  parseMessageExtra,
} from '../utils/fileMeta';
import FileMessageDetail from './FileMessageDetail.vue';

const props = defineProps<{
  message?: MessageSummary | null;
  pendingUpload?: PendingUpload | null;
  src: string;
  isNewMessage?: boolean;
  allowInlineMediaLoad?: boolean;
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

/**
 * 媒体（图片 / 视频）：气泡贴合媒体自身尺寸，不像卡片那样撑满可用宽度。
 * 宽度链的另一半在 features/chat/style/index.scss 的 .msg-item.has-media。
 */
const isMedia = computed(() => category.value === 'image' || category.value === 'video');

/**
 * 「文件类」消息（音频 / 文档 / 压缩包…）点开走详情面板；
 * 图片和视频点开仍是直接预览（它们没有详情面板，也不应该有：
 * 图片看的就是图本身，视频看的就是片子本身）。
 */
const hasDetailPanel = computed(() => !isMedia.value);

const detailTypeLabel = computed(() => getFileTypeText(category.value));
/** 详情面板里的缩略图 icon，与卡片上的一致；音频单独给 voice 图标（卡片就是这么用的）。 */
const detailIconName = computed(() =>
  category.value === 'audio' ? 'document-voice' : documentIconName.value,
);
/** 发送时间：本地待发消息用 pendingUpload 的时间，已确认消息用消息时间。 */
const sentAt = computed(() => props.pendingUpload?.createdAt ?? props.message?.createdAt ?? '');
/** 预览不可用的原因（为空表示可预览）。 */
const previewHint = computed(() => {
  if (!isPreviewable.value) return '该类型暂不支持在线预览，请下载后查看';
  if (isLargeForPreview.value) return '文件较大，请下载后查看';
  return '';
});
const detailPreviewDisabled = computed(() => previewHint.value !== '');

/**
 * 面板要等第一次点开才挂载：一条会话里可能有几十个文件消息，
 * 每个都预先塞一个抽屉/对话框节点没必要，而且它们都 append-to-body。
 */
const detailMounted = ref(false);
const detailVisible = ref(false);

const previewUrl = ref('');
const thumbnailUrl = ref('');
const previewLoading = ref(false);
const thumbnailLoading = ref(false);
const hasError = ref(false);
const loadProgress = ref(0);
const loadStatus = ref<'idle' | 'loading' | 'error'>('idle');
const isPrepared = ref(false);
/**
 * 视频封面的自然尺寸（老消息的 extra 里没有宽高时，等封面图 `@load` 补上）。
 * ⚠️ 必须和上面这批 ref 一起声明：下面那个 `immediate: true` 的 watcher 在 setup
 * 期间就会执行并重置它，声明晚了会直接 TDZ 报错。
 */
const coverSize = ref<{ width: number; height: number } | null>(null);
const coverImageRef = ref<HTMLImageElement | null>(null);

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
    coverSize.value = null;
    void nextTick(syncCoverSizeFromImage);
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
      },
      onError: (error: Error) => {
        if (fileExtra.value?.fileKey !== fileKey) return;
        handlePreviewError(error);
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
      },
      onError: (error: Error) => {
        if (fileExtra.value?.thumbnailUrl !== thumbnailKey) return;
        console.error('FileMessage thumbnail failed:', error);
        thumbnailLoading.value = false;
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

/**
 * 详情面板里的「预览」：先把面板收起来再走预览。
 *
 * 必须收起来 —— 预览浮层的 z-index 是 9999，抽屉/对话框的 overlay 在 2000 档，
 * 但浮层被抽屉压住的这段时间里，用户看到的是「点了一下什么都没发生」。
 */
function handleDetailPreview() {
  detailVisible.value = false;
  void triggerPreview();
}

function handleClick() {
  if (!fileExtra.value || isUploading.value || props.pendingUpload) return;

  if (hasDetailPanel.value) {
    // 文件类消息：先看详情，预览和下载都在面板里点
    detailMounted.value = true;
    detailVisible.value = true;
    return;
  }

  void triggerPreview();
}

/**
 * 图片消息的尺寸上限，与卡片型的 300px 保持一致。
 * 下限 100px 由 `.image-message` 的 `min-width: min(100px, 100%)` 负责
 * （不在这里给 img 设 min-width：那会把小图放大成糊的）。
 */
const IMAGE_MAX_SIZE = 300;

const imageStyle = computed(() => {
  if (!fileExtra.value) return {};
  const width = fileExtra.value.width;
  const height = fileExtra.value.height;
  if (width && height) {
    const ratio = Math.min(IMAGE_MAX_SIZE / width, IMAGE_MAX_SIZE / height, 1);
    return {
      width: `${Math.round(width * ratio)}px`,
      // 不再写死 height：宽度被 max-width 夹小时的等比例缩小要靠 aspect-ratio，
      // 写死 height 的话只会把图片拉扁。
      height: 'auto',
      aspectRatio: `${width} / ${height}`,
      maxWidth: '100%',
    };
  }
  // 尺寸未知时按上限约束：min(300px, 100%) 保证窄容器里能缩
  return {
    maxWidth: `min(${IMAGE_MAX_SIZE}px, 100%)`,
    maxHeight: `${IMAGE_MAX_SIZE}px`,
  };
});

/**
 * 视频封面尺寸：优先用 extra 里记录的宽高（上传时从视频元数据取得），
 * 老消息没有这个字段，就等封面图 `@load` 后用它的自然尺寸。
 */
const videoCoverSize = computed(() => {
  const width = fileExtra.value?.width;
  const height = fileExtra.value?.height;
  if (width && height) return { width, height };
  return coverSize.value;
});

/**
 * 封面的显示比例 = 封面自身的比例（不再写死 16:9）。
 *
 * 以前 `.video-cover` 固定 `aspect-ratio: 16 / 9` + `img { object-fit: cover }`，
 * 竖屏视频（比如 720×1280）的封面会被裁成中间一条横条 —— 用户看到的就是「封面被裁了」。
 * 现在比例由封面自己决定，等比缩放到 300px 以内（与图片消息同一套上限）。
 */
const videoCoverStyle = computed(() => {
  const size = videoCoverSize.value;
  if (!size) return {};
  return { aspectRatio: `${size.width} / ${size.height}` };
});

/** 气泡宽度跟着封面走：否则文件名的 min-content 会把气泡顶到 300px，封面再被拉宽。 */
const videoBubbleStyle = computed(() => {
  const size = videoCoverSize.value;
  if (!size) return {};
  const ratio = Math.min(IMAGE_MAX_SIZE / size.width, IMAGE_MAX_SIZE / size.height, 1);
  return { width: `${Math.round(size.width * ratio)}px` };
});

/**
 * 从**已经加载好**的封面图回读尺寸。
 *
 * 为什么不能只靠 `@load`：下面的 watcher 会在「封面地址变化 / 上传状态变化」时清空
 * coverSize 重新取图，但图片若**同一个 src 已经加载完**，浏览器不会再发一次 load ——
 * 尺寸就这么丢了，封面退回 16:9 兜底并一直不纠正（竖屏视频的封面又被裁成横条）。
 * 所以 `@load` 与「每次 reset 后的 nextTick 回读」两条路都要有。
 */
function syncCoverSizeFromImage() {
  if (fileExtra.value?.width && fileExtra.value?.height) return;
  const img = coverImageRef.value;
  if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return;
  coverSize.value = { width: img.naturalWidth, height: img.naturalHeight };
}

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
  <div class="file-message" :class="{ uploading: isUploading, failed: isFailed, media: isMedia }" @click="handleClick">
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
        </div>

        <div v-else-if="category === 'video'" class="video-message" :style="videoBubbleStyle">
          <div v-if="videoCoverUrl" class="video-cover" :style="videoCoverStyle">
            <img ref="coverImageRef" :src="videoCoverUrl" :alt="fileExtra.fileName" loading="lazy"
              @load="syncCoverSizeFromImage" />
            <div v-if="isUploading" class="upload-visual-overlay" :style="uploadMaskStyle">
              <div class="upload-progress-badge">{{ uploadProgress }}%</div>
            </div>
            <!-- 只保留「加载封面」时的转圈：播放图标已按需求移除，
                 不要再加回来（封面本身点击即播放/预览，不需要视觉按钮）。 -->
            <div v-else-if="previewLoading" class="video-cover-overlay">
              <el-icon class="is-loading" :size="28">
                <Loading />
              </el-icon>
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
          <!-- 下载按钮已撤：点卡片弹出的详情面板里才有（见 FileMessageDetail.vue） -->
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
          <!-- 下载按钮已撤：点卡片弹出的详情面板里才有（见 FileMessageDetail.vue） -->
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
              color="var(--chat-accent)" />
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

    <!--
      文件详情面板：手机从底部弹出抽屉，平板/电脑是居中对话框。
      挂在这里而不是提到 MessagePanel：面板要用的东西（fileKey、预览状态、
      下载器）全在本组件里，提上去就得再把状态搬一遍。
      v-if="detailMounted" —— 没点开过的消息不生成弹层节点。
    -->
    <FileMessageDetail v-if="detailMounted && fileExtra" v-model="detailVisible" :file-name="fileExtra.fileName"
      :file-size="fileExtra.fileSize" :type-label="detailTypeLabel" :icon-class="detailIconName" :sent-at="sentAt"
      :preview-disabled="detailPreviewDisabled" :preview-hint="previewHint"
      :download-disabled="!fileExtra.fileKey || isUploading || isFailed" @download="handleDownload"
      @preview="handleDetailPreview" />
  </div>
</template>

<style scoped lang="scss">
////
/// 文件卡片（文档 / 音频）的宽度策略：
///   **最多 300px，容器窄于 300px 时随可用宽度收缩，最小 100px。**
///
/// 关键：宽度链上每一级都必须有**确定宽度**，否则百分比 max-width 会自循环。
/// 链条（见 features/chat/style/index.scss 的 .msg-item.has-file）：
///
///   .msg-item.has-file      width: 100%（再被 max-width: 88%/82% 夹住）
///     └ .content            flex: 1 1 auto; min-width: 0
///         └ .bubble-wrap    width: 100%
///             └ .file-message          width: 100%; max-width: 300px
///                 └ .file-item-wrap    width: 100%
///                     └ 卡片           width: 100%（≤ 上面传下来的宽度）
///
/// 历史教训：以前这里写 `width: 300px; max-width: 100%`，而上面每一级都是
/// fit-content —— `max-width: 100%` 于是相对「自己撑出来的宽度」求百分比，
/// 浏览器只能当 auto 处理，卡片永远 300px，窗口再窄也不缩（图片看着"能缩"，
/// 只是因为它本身只有 200px 宽，不是因为规则生效）。
///
/// min-width: 100px 是需求给的下限：可用宽度不足 100px 时宁可溢出也不低于 100px。
////
@mixin file-card-width {
  width: 100%;
  max-width: 300px;
  min-width: 100px;
  box-sizing: border-box;
  // 自身作为容器，让内部图标/徽标能按**卡片宽度**（而不是视口）自适应
  container-type: inline-size;
  container-name: filecard;
}

////
/// 媒体型（图片 / 视频）的同一套宽度策略：**最多 300px，窄则收缩，最小 100px**。
///
/// 与卡片型的差别只有两点，都是必须的：
///   1. 不给固定 `width`：媒体应贴合自身尺寸（小图不该被撑成 300px 的空框）；
///   2. 不加 `container-type`：`.image-message` 是 `inline-block` 贴合内容，
///      而 `container-type: inline-size` 会带上 `contain: inline-size`，
///      让它不再按内容定宽 —— 那会直接破坏"贴合图片"的行为。
///
/// 下限写成 `min(100px, 100%)` 而不是硬 100px：媒体按 max-width 收缩时，
/// 硬下限会在极窄容器里反而撑破气泡；取两者较小值既保留 100px 的目标下限，
/// 又不会制造新的溢出。
////
@mixin file-media-width {
  // 父级 .file-item-wrap 现在是确定宽度（width: 100%），所以这里可以放心用
  // max-width: 100% 表达「跟可用宽度一起缩」；上限仍是 300px。
  max-width: min(300px, 100%);
  min-width: min(100px, 100%);
  box-sizing: border-box;
}

.file-message {
  // 卡片（音频 / 文档）：占满气泡宽度，再由 max-width 夹到 300px。
  // 气泡（.bubble-wrap）在 .msg-item.has-file 下已是确定宽度，
  // 所以 100% 有确定的参照，不会自循环。
  width: 100%;
  max-width: 300px;
  cursor: pointer;
  user-select: none;

  &.uploading {
    cursor: default;
  }

  // 媒体（图片 / 视频）：**贴合媒体自身尺寸**，不带撑满。
  //
  // 为什么三条都要：
  //   width: fit-content —— 不写就退回上面的 100%，图片又被放进一个撑满的盒子里；
  //   max-width          —— 上限仍是 min(300px, 100%)：窄屏时跟着可用宽度收缩
  //                         （100% 的参照是 .bubble-wrap，它在 .has-media 下是确定宽度）；
  //   min-width: 0       —— flex 子项的 min-width 默认是 auto（= 图片自身的宽度），
  //                         不清零的话图片在窄屏里不肯缩，直接顶破气泡。
  &.media {
    width: fit-content;
    min-width: 0;
    max-width: min(300px, 100%);
  }
}

.file-item-wrap {
  // flex + width: 100%：把 .file-message 的确定宽度继续传给卡片/媒体，
  // 它们是 flex item（align-items: flex-start → 宽度由自身 width 决定）。
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
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
    background: linear-gradient(120deg, rgba(154, 79, 141, 0.9), rgba(122, 58, 111, 0.86));
  }

  &.error {
    background: linear-gradient(120deg, rgba(244, 63, 94, 0.88), rgba(185, 28, 28, 0.84));
  }

  .status-icon {
    margin-right: 6px;
    vertical-align: middle;
    font-size: 13px;
  }

  .status-text {
    display: inline-flex;
    align-items: center;
    margin-bottom: 6px;
    font-size: 11px;
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
  @include file-media-width;
  border-radius: 8px;
  overflow: hidden;

  img {
    display: block;
    // 图片尺寸由 JS 的 imageStyle 给出（含 aspect-ratio），
    // 这里兜住上限：窄气泡里必须能缩，否则会顶破容器
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    transition: transform 0.2s;
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
  color: var(--chat-muted-light);
  font-size: 12px;
}

.image-placeholder,
.media-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  // 占位框与真实媒体用同一套宽度上下限（原来是硬 180px，窄气泡里会顶破）
  @include file-media-width;
  min-height: 120px;
  padding: 20px;
  color: var(--chat-text-secondary);
  font-size: 12px;
  background: var(--chat-card);
  border-radius: 8px;
  box-sizing: border-box;

  span {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.upload-visual-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  pointer-events: none;

  // 灰色蒙层：上传中盖住整张图，随进度**从中心往四周让开**（见下面的 mask）。
  // 用 62% 的蓝灰而不是接近全黑：全黑看起来像「图片坏了」，
  // 灰色只是「还在传」，下面的图片一直看得见。
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.62);
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
  font-size: 11px;
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
  color: var(--chat-muted-light);
  font-size: 12px;
  background: var(--chat-card);
  border-radius: 8px;
}

.video-message {
  // 原来固定 max-width: 200px，与文档/音频的 300px 不一致；统一成同一套上下限
  @include file-media-width;
  border-radius: 8px;
  overflow: hidden;
  background: var(--chat-card);

  .video-cover {
    position: relative;
    // 只是**尺寸未知时的兜底**：拿到封面真实宽高后由内联 aspect-ratio 覆盖
    // （竖屏视频按 16:9 展示会把封面裁成一条横条）。
    aspect-ratio: 16 / 9;
    background: var(--chat-inset);

    img {
      width: 100%;
      height: 100%;
      display: block;
      // 容器比例 = 封面比例，cover 不会裁；留 cover 是因为它比 contain 更抗亚像素误差
      object-fit: cover;
    }
  }

  // 加载封面时的转圈层（播放图标已移除）
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
      color: var(--chat-text);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--chat-muted-light);
      font-size: 11px;
    }
  }
}

.audio-message {
  display: flex;
  align-items: center;
  gap: 12px;
  @include file-card-width;
  padding: 12px;
  background: var(--chat-card);
  border-radius: 8px;
  // 卡片现在整体可点（点开详情面板），hover 给个同样的可点反馈
  transition: background-color 0.2s;

  &:hover {
    background: var(--chat-card-hover);
  }

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
      color: var(--chat-text);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--chat-muted-light);
      font-size: 11px;
    }
  }
}

.document-message {
  display: flex;
  align-items: center;
  gap: 12px;
  @include file-card-width;
  padding: 12px;
  background: var(--chat-card);
  border-radius: 8px;
  transition: background-color 0.2s;

  &:hover {
    background: var(--chat-card-hover);
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
      background: var(--chat-accent-soft);
    }

    &.archive {
      background: var(--chat-warning-soft);
    }

    &.unknown {
      background: var(--chat-inset);
    }
  }

  .document-info {
    flex: 1;
    min-width: 0;
  }

  .file-name {
    overflow: hidden;
    margin-bottom: 4px;
    color: var(--chat-text);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    color: var(--chat-muted-light);
    font-size: 11px;
  }

  .file-type {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    color: var(--chat-text-secondary);
    background: var(--chat-inset);
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
  background: linear-gradient(90deg, var(--chat-accent), var(--theme-color-deep));
  transition: width 0.16s linear;
}

.file-meta .status-text {
  display: inline-block;
  font-size: 11px;
  color: var(--chat-muted-light);

  &.ready {
    color: #67c23a;
  }

  &.uploading {
    color: var(--chat-accent);
  }

  &.error {
    color: var(--chat-danger);
  }
}

.file-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--chat-danger);
  background: var(--chat-danger-soft);
  border-radius: 8px;
}

// ==============================================
// 卡片内部按「卡片宽度」自适应（容器查询）
// ==============================================
// 卡片按需求最窄会到 100px，而图标是 48px、内边距/间距各 12px ——
// 加起来 84px，文字只剩十几像素，等于看不见文件名。所以图标、间距、
// 内边距、徽标都要跟着**卡片实际宽度**收。
//
// 为什么用容器查询而不是媒体查询：同一视口下卡片可能很窄
// （会话列表占位、气泡本身只有 75%~88% 宽），视口宽度反映不出卡片有多宽。
// .document-message / .audio-message 已声明 container-name: filecard。
@container filecard (max-width: 260px) {
  .document-message,
  .audio-message {
    gap: 8px;
    padding: 8px;
  }

  .document-icon,
  .audio-icon {
    width: 36px;
    height: 36px;
    border-radius: 6px;
  }
}

@container filecard (max-width: 180px) {
  .document-message,
  .audio-message {
    gap: 6px;
    padding: 6px;
  }

  .document-icon,
  .audio-icon {
    width: 28px;
    height: 28px;
  }

  // 类型徽标（PDF / DOCX…）在极窄时让位给文件名
  .file-type {
    display: none;
  }

  .file-meta {
    gap: 4px;
    font-size: 10px;
  }
}
</style>
