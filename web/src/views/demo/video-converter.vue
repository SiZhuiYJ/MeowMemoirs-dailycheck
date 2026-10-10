<template>
  <div class="video-converter-page">
    <section class="hero-card">
      <div class="hero-header">
        <div>
          <h1>前端视频转 WebM + 封面提取</h1>
          <p>使用 ffmpeg.wasm 在浏览器内完成转码，并对比原视频与转换后视频的核心元数据。</p>
        </div>
        <el-tag :type="canConvert ? 'success' : 'danger'" effect="dark" round>
          {{ converterModeText }}
        </el-tag>
      </div>

      <div
        class="upload-panel"
        :class="{ dragging }"
        @click="openFilePicker"
        @dragenter.prevent="dragging = true"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="handleDrop"
      >
        <input
          ref="fileInputRef"
          class="file-input"
          type="file"
          accept="video/*"
          @change="handleFileInputChange"
        />
        <el-icon class="upload-icon">
          <UploadFilled />
        </el-icon>
        <div class="upload-text">
          <strong>拖拽视频到这里</strong>
          <span>或点击选择一个本地视频文件</span>
        </div>
      </div>

      <div v-if="sourceMetadata" class="info-grid">
        <div class="info-item">
          <label>原始文件</label>
          <span>{{ sourceMetadata.fileName }}</span>
        </div>
        <div class="info-item">
          <label>原始大小</label>
          <span>{{ formatSize(sourceMetadata.size) }}</span>
        </div>
        <div class="info-item">
          <label>原始时长</label>
          <span>{{ formatDuration(sourceMetadata.duration) }}</span>
        </div>
      </div>

      <div class="actions">
        <el-button type="primary" :loading="converting" :disabled="!sourceFile || !canConvert" @click="startConvert">
          转换为 WebM
        </el-button>
        <el-button :disabled="!convertedFile" @click="downloadConvertedFile">
          下载 WebM
        </el-button>
        <el-button :disabled="!coverFile" @click="downloadCoverFile">
          下载封面 WebP
        </el-button>
        <div class="sync-switch">
          <span>独立播放</span>
          <el-switch v-model="independentPlayback" />
          <span>{{ independentPlayback ? "互不联动" : "原视频主控同步" }}</span>
        </div>
      </div>

      <el-progress
        v-if="converting || progress > 0"
        class="progress-bar"
        :percentage="progress"
        :status="progress === 100 ? 'success' : undefined"
      />
      <p v-if="converting && isMultiThreadMode" class="pending-tip">
        当前是多线程转码模式，DevTools 里 `ffmpeg-core.worker.js` 长时间显示待处理属于正常现象。
      </p>

      <p v-if="lastErrorMessage" class="error-message">{{ lastErrorMessage }}</p>
      <p v-else-if="durationDeltaWarning" class="warning-message">{{ durationDeltaWarning }}</p>
    </section>

    <section v-if="sourceMetadata" class="comparison-card">
      <div class="section-title">
        <h2>原视频 / 转换后元数据对比</h2>
      </div>

      <div class="comparison-table">
        <div class="table-row table-head">
          <div>项目</div>
          <div>原视频</div>
          <div>转换后 WebM</div>
        </div>
        <div v-for="row in comparisonRows" :key="row.label" class="table-row">
          <div>{{ row.label }}</div>
          <div>{{ row.source }}</div>
          <div>{{ row.converted }}</div>
        </div>
      </div>
    </section>

    <section v-if="sourcePreviewUrl || convertedPreviewUrl" class="preview-card">
      <div class="section-title">
        <h2>视频预览对比</h2>
      </div>

      <div class="preview-grid">
        <article v-if="sourcePreviewUrl" class="preview-panel">
          <header>
            <h3>原视频</h3>
            <span>{{ formatDuration(sourceMetadata?.duration ?? null) }}</span>
          </header>
          <video
            ref="sourceVideoRef"
            :src="sourcePreviewUrl"
            controls
            playsinline
            preload="metadata"
            @play="syncFromSource('play')"
            @pause="syncFromSource('pause')"
            @seeking="syncFromSource('seek')"
            @seeked="syncFromSource('seek')"
            @ratechange="syncFromSource('rate')"
            @ended="syncFromSource('ended')"
          />
        </article>

        <article v-if="convertedPreviewUrl" class="preview-panel">
          <header>
            <h3>转换后 WebM</h3>
            <span>{{ formatDuration(convertedMetadata?.duration ?? null) }}</span>
          </header>
          <video
            ref="convertedVideoRef"
            :src="convertedPreviewUrl"
            controls
            playsinline
            preload="metadata"
          />
        </article>
      </div>
    </section>

    <section v-if="coverPreviewUrl" class="cover-card">
      <div class="section-title">
        <h2>封面预览</h2>
      </div>
      <img class="cover-image" :src="coverPreviewUrl" alt="提取的 WebP 封面" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { UploadFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { computed, onBeforeUnmount, ref } from "vue";
import { extractVideoFrameToWebP } from "@/utils/convertToWebP";
import {
  canConvertVideoToWebM,
  convertVideoToWebM,
  getVideoConverterModeDescription,
} from "@/utils/videoConverter";
import { getVideoFileMetadata, type VideoFileMetadata } from "@/utils/videoMetadata";
import { formatFileSize } from "@/features/chat/utils/fileMeta";

type SyncAction = "play" | "pause" | "seek" | "rate" | "ended";

const MAX_OUTPUT_SIZE_BYTES = 100 * 1024 * 1024;

const canConvert = canConvertVideoToWebM();
const converterModeText = ref(getVideoConverterModeDescription());
const dragging = ref(false);
const converting = ref(false);
const progress = ref(0);
const independentPlayback = ref(false);
const lastErrorMessage = ref("");

const fileInputRef = ref<HTMLInputElement | null>(null);
const sourceVideoRef = ref<HTMLVideoElement | null>(null);
const convertedVideoRef = ref<HTMLVideoElement | null>(null);

const sourceFile = ref<File | null>(null);
const convertedFile = ref<File | null>(null);
const coverFile = ref<File | null>(null);

const sourcePreviewUrl = ref("");
const convertedPreviewUrl = ref("");
const coverPreviewUrl = ref("");

const sourceMetadata = ref<VideoFileMetadata | null>(null);
const convertedMetadata = ref<VideoFileMetadata | null>(null);

let syncing = false;

const isMultiThreadMode = computed(() => converterModeText.value.includes("多线程"));

function formatSize(size: number | null | undefined): string {
  if (typeof size !== "number") return "--";
  return formatFileSize(size);
}

function formatDuration(duration: number | null | undefined): string {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return "无法识别";
  const totalMilliseconds = Math.round(duration * 1000);
  const minutes = Math.floor(totalMilliseconds / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const centiseconds = Math.floor((totalMilliseconds % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function formatResolution(metadata: VideoFileMetadata | null): string {
  if (!metadata?.width || !metadata.height) return "--";
  return `${metadata.width} × ${metadata.height}`;
}

function formatBitrate(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value) || value <= 0) return "--";
  return `${(value / 1_000_000).toFixed(2)} Mbps`;
}

function formatDurationDelta(): string {
  if (!sourceMetadata.value?.duration || !convertedMetadata.value?.duration) return "--";
  const delta = convertedMetadata.value.duration - sourceMetadata.value.duration;
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${delta.toFixed(2)} 秒`;
}

function formatSizeDelta(): string {
  if (!sourceMetadata.value || !convertedMetadata.value) return "--";
  const delta = convertedMetadata.value.size - sourceMetadata.value.size;
  const prefix = delta > 0 ? "+" : "";
  const percent = sourceMetadata.value.size > 0
    ? `${prefix}${((delta / sourceMetadata.value.size) * 100).toFixed(2)}%`
    : "--";
  return `${prefix}${formatFileSize(Math.abs(delta))} / ${percent}`;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const maybeMessage = Reflect.get(error, "message");
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;
    try {
      return JSON.stringify(error);
    } catch {
      return "视频转换失败";
    }
  }
  return "视频转换失败";
}

function revokeUrl(url: string) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}

function resetConvertedAssets() {
  convertedFile.value = null;
  coverFile.value = null;
  convertedMetadata.value = null;
  revokeUrl(convertedPreviewUrl.value);
  revokeUrl(coverPreviewUrl.value);
  convertedPreviewUrl.value = "";
  coverPreviewUrl.value = "";
}

function resetAllAssets() {
  resetConvertedAssets();
  sourceFile.value = null;
  sourceMetadata.value = null;
  revokeUrl(sourcePreviewUrl.value);
  sourcePreviewUrl.value = "";
  progress.value = 0;
  lastErrorMessage.value = "";
}

async function updateSourceFile(file: File) {
  resetAllAssets();
  sourceFile.value = file;
  sourcePreviewUrl.value = URL.createObjectURL(file);
  sourceMetadata.value = await getVideoFileMetadata(file);
  converterModeText.value = getVideoConverterModeDescription();
}

function openFilePicker() {
  fileInputRef.value?.click();
}

async function handleSelectedFile(file: File | null | undefined) {
  if (!file) return;
  if (!file.type.startsWith("video/")) {
    ElMessage.error("请选择视频文件。");
    return;
  }

  try {
    await updateSourceFile(file);
  } catch (error) {
    const message = normalizeErrorMessage(error);
    lastErrorMessage.value = message;
    ElMessage.error(message);
  }
}

async function handleFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  await handleSelectedFile(file);
  input.value = "";
}

async function handleDrop(event: DragEvent) {
  dragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  await handleSelectedFile(file);
}

function downloadBlob(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadConvertedFile() {
  if (convertedFile.value) {
    downloadBlob(convertedFile.value);
  }
}

function downloadCoverFile() {
  if (coverFile.value) {
    downloadBlob(coverFile.value);
  }
}

function syncFromSource(action: SyncAction) {
  if (independentPlayback.value || syncing) return;

  const source = sourceVideoRef.value;
  const converted = convertedVideoRef.value;
  if (!source || !converted || !convertedPreviewUrl.value) return;

  syncing = true;
  converted.playbackRate = source.playbackRate || 1;

  if (Number.isFinite(source.currentTime)) {
    const targetTime = Number.isFinite(converted.duration)
      ? Math.min(source.currentTime, converted.duration || source.currentTime)
      : source.currentTime;
    converted.currentTime = targetTime;
  }

  if (action === "play") {
    void converted.play().catch(() => undefined);
  }

  if (action === "pause" || action === "ended") {
    converted.pause();
  }

  window.setTimeout(() => {
    syncing = false;
  }, 0);
}

async function startConvert() {
  if (!sourceFile.value) {
    ElMessage.warning("请先选择一个视频文件。");
    return;
  }

  if (!canConvert) {
    ElMessage.error("当前浏览器环境不支持 ffmpeg.wasm 转码。");
    return;
  }

  converting.value = true;
  progress.value = 1;
  lastErrorMessage.value = "";
  resetConvertedAssets();

  try {
    const webm = await convertVideoToWebM(sourceFile.value, {
      maxOutputSizeBytes: MAX_OUTPUT_SIZE_BYTES,
      onProgress: (value) => {
        progress.value = Math.max(progress.value, Math.round((value / 100) * 90));
      },
    });

    convertedFile.value = webm;
    convertedPreviewUrl.value = URL.createObjectURL(webm);
    convertedMetadata.value = await getVideoFileMetadata(webm);
    converterModeText.value = getVideoConverterModeDescription();
    progress.value = Math.max(progress.value, 92);

    try {
      const cover = await extractVideoFrameToWebP(webm, {
        fileName: `${webm.name.replace(/\.[^.]+$/, "")}-cover.webp`,
        maxWidth: 1280,
        maxHeight: 1280,
        onProgress: (value) => {
          progress.value = Math.max(progress.value, 90 + Math.round((value / 100) * 10));
        },
      });
      coverFile.value = cover;
      coverPreviewUrl.value = URL.createObjectURL(cover);
    } catch (coverError) {
      const message = `WebP 封面提取失败: ${normalizeErrorMessage(coverError)}`;
      console.error(message, coverError);
      ElMessage.warning(message);
    }

    progress.value = 100;
    ElMessage.success("视频已转换为 WebM。");
  } catch (error) {
    console.error("Video conversion failed:", error);
    const message = normalizeErrorMessage(error);
    lastErrorMessage.value = message;
    progress.value = 0;
    ElMessage.error(message);
  } finally {
    converting.value = false;
  }
}

const comparisonRows = computed(() => [
  {
    label: "文件名",
    source: sourceMetadata.value?.fileName ?? "--",
    converted: convertedMetadata.value?.fileName ?? "--",
  },
  {
    label: "格式",
    source: sourceMetadata.value ? `${sourceMetadata.value.extension.toUpperCase()} / ${sourceMetadata.value.mimeType}` : "--",
    converted: convertedMetadata.value ? `${convertedMetadata.value.extension.toUpperCase()} / ${convertedMetadata.value.mimeType}` : "--",
  },
  {
    label: "文件大小",
    source: formatSize(sourceMetadata.value?.size),
    converted: formatSize(convertedMetadata.value?.size),
  },
  {
    label: "视频时长",
    source: formatDuration(sourceMetadata.value?.duration),
    converted: formatDuration(convertedMetadata.value?.duration),
  },
  {
    label: "分辨率",
    source: formatResolution(sourceMetadata.value),
    converted: formatResolution(convertedMetadata.value),
  },
  {
    label: "平均码率",
    source: formatBitrate(sourceMetadata.value?.averageBitrate),
    converted: formatBitrate(convertedMetadata.value?.averageBitrate),
  },
  {
    label: "时长偏差",
    source: "--",
    converted: formatDurationDelta(),
  },
  {
    label: "体积变化",
    source: "--",
    converted: formatSizeDelta(),
  },
]);

const durationDeltaWarning = computed(() => {
  if (!sourceMetadata.value?.duration || !convertedMetadata.value?.duration) return "";
  const delta = Math.abs(convertedMetadata.value.duration - sourceMetadata.value.duration);
  if (delta <= 0.3) return "";
  return `当前转换结果与原视频存在 ${delta.toFixed(2)} 秒的时长偏差，建议继续检查编码参数。`;
});

onBeforeUnmount(() => {
  revokeUrl(sourcePreviewUrl.value);
  revokeUrl(convertedPreviewUrl.value);
  revokeUrl(coverPreviewUrl.value);
});
</script>

<style scoped>
.video-converter-page {
  --page-bg: linear-gradient(180deg, #f5f7fb 0%, #eef3f8 100%);
  --card-bg: rgba(255, 255, 255, 0.92);
  --card-border: rgba(15, 23, 42, 0.08);
  --text-main: #1f2937;
  --text-muted: #6b7280;
  --accent: #2563eb;
  --accent-soft: rgba(37, 99, 235, 0.12);
  --danger: #dc2626;
  --warning: #b45309;
  min-height: 100%;
  padding: 24px;
  background: var(--page-bg);
  color: var(--text-main);
}

.hero-card,
.comparison-card,
.preview-card,
.cover-card {
  max-width: 1200px;
  margin: 0 auto 20px;
  padding: 24px;
  border: 1px solid var(--card-border);
  border-radius: 24px;
  background: var(--card-bg);
  box-shadow: 0 20px 45px rgba(148, 163, 184, 0.16);
  backdrop-filter: blur(16px);
}

.hero-header,
.section-title,
.actions,
.sync-switch,
.upload-text,
.info-item,
.preview-panel header {
  display: flex;
}

.hero-header,
.section-title,
.actions,
.preview-panel header {
  justify-content: space-between;
  align-items: center;
}

.hero-header {
  gap: 16px;
  margin-bottom: 20px;
}

.hero-header h1,
.section-title h2,
.preview-panel h3 {
  margin: 0;
}

.hero-header p {
  margin: 8px 0 0;
  color: var(--text-muted);
}

.upload-panel {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 240px;
  padding: 24px;
  border: 1.5px dashed rgba(37, 99, 235, 0.25);
  border-radius: 20px;
  background:
    radial-gradient(circle at top, rgba(37, 99, 235, 0.12), transparent 35%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(241, 245, 249, 0.94));
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
  cursor: pointer;
}

.upload-panel.dragging,
.upload-panel:hover {
  border-color: rgba(37, 99, 235, 0.6);
  transform: translateY(-1px);
  box-shadow: 0 18px 30px rgba(37, 99, 235, 0.12);
}

.file-input {
  display: none;
}

.upload-icon {
  margin-bottom: 14px;
  font-size: 72px;
  color: var(--accent);
}

.upload-text {
  flex-direction: column;
  gap: 8px;
  text-align: center;
  color: var(--text-muted);
}

.upload-text strong {
  color: var(--text-main);
  font-size: 20px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 20px;
}

.info-item {
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(248, 250, 252, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.info-item label {
  font-size: 13px;
  color: var(--text-muted);
}

.info-item span {
  font-size: 18px;
  font-weight: 600;
  word-break: break-all;
}

.actions {
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}

.sync-switch {
  align-items: center;
  gap: 10px;
  margin-left: auto;
  color: var(--text-muted);
}

.progress-bar {
  margin-top: 18px;
}

.error-message,
.warning-message,
.pending-tip {
  margin: 14px 0 0;
  padding: 12px 14px;
  border-radius: 14px;
  white-space: pre-wrap;
  word-break: break-word;
}

.error-message {
  color: var(--danger);
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.16);
}

.warning-message {
  color: var(--warning);
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.16);
}

.pending-tip {
  color: var(--text-muted);
  background: rgba(37, 99, 235, 0.06);
  border: 1px solid rgba(37, 99, 235, 0.12);
}

.comparison-table {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 20px;
  overflow: hidden;
}

.table-row {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr) minmax(0, 1fr);
}

.table-row > div {
  padding: 16px 18px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  word-break: break-word;
}

.table-row:last-child > div {
  border-bottom: none;
}

.table-head {
  background: rgba(15, 23, 42, 0.04);
  font-weight: 700;
}

.table-row > div:not(:last-child) {
  border-right: 1px solid rgba(148, 163, 184, 0.14);
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.preview-panel {
  padding: 18px;
  border-radius: 20px;
  background: rgba(248, 250, 252, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.preview-panel header {
  margin-bottom: 12px;
}

.preview-panel span {
  color: var(--text-muted);
}

.preview-panel video {
  width: 100%;
  border-radius: 14px;
  background: #000;
}

.cover-image {
  display: block;
  width: min(100%, 720px);
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.16);
}

@media (max-width: 900px) {
  .video-converter-page {
    padding: 16px;
  }

  .hero-card,
  .comparison-card,
  .preview-card,
  .cover-card {
    padding: 18px;
    border-radius: 20px;
  }

  .hero-header,
  .actions {
    flex-direction: column;
    align-items: stretch;
  }

  .sync-switch {
    margin-left: 0;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .info-grid,
  .preview-grid {
    grid-template-columns: 1fr;
  }

  .table-row {
    grid-template-columns: 140px minmax(0, 1fr) minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .table-row {
    grid-template-columns: 120px minmax(0, 1fr) minmax(0, 1fr);
    font-size: 14px;
  }

  .table-row > div {
    padding: 14px 12px;
  }
}
</style>
