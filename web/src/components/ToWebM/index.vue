<!-- components/VideoConverter.vue -->
<script setup lang="ts">
console.log('VideoEncoder available:', typeof VideoEncoder !== 'undefined');
import { ref, watch } from 'vue';  // 移除未使用的 computed
import { extractMetadata, type VideoMetadata } from './useVideoMetadata';
import { convertVideo } from './useVideoConverter';

const selectedFile = ref<File | null>(null);
const isDragOver = ref(false);
const isConverting = ref(false);
const progress = ref(0);
const progressHint = ref('');

const originalMetadata = ref<VideoMetadata | null>(null);
const convertedMetadata = ref<VideoMetadata | null>(null);
const convertedBlob = ref<Blob | null>(null);
const qualityOption = ref<'lossless' | 'high' | 'medium' | 'low'>('lossless');

const originalVideoUrl = ref('');
const convertedVideoUrl = ref('');

// 添加 fileInput 模板引用类型声明
const fileInput = ref<HTMLInputElement | null>(null);

function resolveSourceHasAudio(metadata: VideoMetadata | null): boolean | undefined {
    if (!metadata) return undefined;

    if (metadata.audioChannels > 0 || metadata.audioSampleRate > 0) {
        return true;
    }

    const normalizedAudioCodec = metadata.audioCodec.trim().toLowerCase();
    if (normalizedAudioCodec && normalizedAudioCodec !== 'unknown') {
        return true;
    }

    const metadataLooksIncomplete =
        metadata.codec === 'Unknown'
        && metadata.container === 'Unknown'
        && metadata.frameRate === 0;

    if (metadataLooksIncomplete) {
        return undefined;
    }

    return false;
}

async function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) await processFile(file);
}

async function handleDrop(event: DragEvent) {
    isDragOver.value = false;
    const file = event.dataTransfer?.files[0];
    if (file) await processFile(file);
}

async function processFile(file: File) {
    selectedFile.value = file;
    originalVideoUrl.value = URL.createObjectURL(file);

    progressHint.value = '正在提取视频元数据...';
    originalMetadata.value = await extractMetadata(file);
    progressHint.value = '';

    convertedMetadata.value = null;
    convertedBlob.value = null;
    progress.value = 0;
}

async function startConversion() {
    if (!selectedFile.value) return;

    isConverting.value = true;
    progressHint.value = '正在转换视频，请稍候...';

    try {
        const blob = await convertVideo(selectedFile.value, {
            quality: qualityOption.value,
            sourceHasAudio: resolveSourceHasAudio(originalMetadata.value),
            sourceBitRate: originalMetadata.value?.bitRate || undefined,
            sourceDuration: originalMetadata.value?.duration || undefined,
            onProgress: (p: number) => {
                progress.value = p;
                if (p < 30) progressHint.value = '正在初始化转换器...';
                else if (p < 60) progressHint.value = '正在编码视频帧...';
                else if (p < 90) progressHint.value = '正在编码音频...';
                else progressHint.value = '正在封装文件...';
            },
        });

        convertedBlob.value = blob;
        convertedVideoUrl.value = URL.createObjectURL(blob);

        progressHint.value = '正在分析转换结果...';
        const newFile = new File([blob], 'converted.webm', { type: 'video/webm' });
        convertedMetadata.value = await extractMetadata(newFile);

        progressHint.value = '转换完成！';
    } catch (error) {
        console.error('转换失败:', error);
        progressHint.value = '转换失败，请重试';
    } finally {
        isConverting.value = false;
    }
}

function downloadVideo() {
    if (!convertedBlob.value || !selectedFile.value) return;

    const url = URL.createObjectURL(convertedBlob.value);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedFile.value.name.replace(/\.[^.]+$/, '') + '.webm';
    a.click();
    URL.revokeObjectURL(url);
}

function resetConverter() {
    selectedFile.value = null;
    originalMetadata.value = null;
    convertedMetadata.value = null;
    convertedBlob.value = null;
    originalVideoUrl.value = '';
    convertedVideoUrl.value = '';
    progress.value = 0;
}

// 格式化函数
function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds: number | undefined): string {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatBitRate(bps: number | undefined): string {
    if (!bps) return '-';
    return (bps / 1000000).toFixed(2) + ' Mbps';
}

// 元数据变化计算（处理可能为 undefined 的情况）
function getResolutionChange(): string {
    if (!convertedMetadata.value || !originalMetadata.value) return '-';
    const o = originalMetadata.value;
    const c = convertedMetadata.value;
    if (o.width === c.width && o.height === c.height) return '保持不变';
    return `${o.width}×${o.height} → ${c.width}×${c.height}`;
}

function getFrameRateChange(): string {
    if (!convertedMetadata.value || !originalMetadata.value) return '-';
    const o = originalMetadata.value.frameRate;
    const c = convertedMetadata.value.frameRate;
    if (Math.abs((o ?? 0) - (c ?? 0)) < 0.1) return '保持不变';
    return `${(o ?? 0).toFixed(2)} → ${(c ?? 0).toFixed(2)} fps`;
}

function getCodecChange(): string {
    return '→ VP9 (WebM)';
}

function getBitRateChange(): string {
    if (!convertedMetadata.value || !originalMetadata.value?.bitRate) return '-';
    const o = originalMetadata.value.bitRate;
    const c = convertedMetadata.value.bitRate ?? 0;
    const percent = ((c - o) / o * 100).toFixed(1);
    return percent.startsWith('-') ? `${percent}%` : `+${percent}%`;
}

function getSizeChange(): string {
    if (!convertedMetadata.value || !originalMetadata.value) return '-';
    const o = originalMetadata.value.fileSize;
    const c = convertedMetadata.value.fileSize;
    const percent = ((c - o) / o * 100).toFixed(1);
    return percent.startsWith('-') ? `${percent}%` : `+${percent}%`;
}

function getSizeChangeClass(): string {
    if (!convertedMetadata.value || !originalMetadata.value) return '';
    const o = originalMetadata.value.fileSize;
    const c = convertedMetadata.value.fileSize;
    return c < o ? 'size-reduced' : 'size-increased';
}

watch(qualityOption, (val: string) => {
    const hints: Record<string, string> = {
        lossless: '视觉无损压缩，保持原画质，文件体积可能较大',
        high: '高质量转换，画质损失极小，适合高质量存档',
        medium: '中等质量，平衡画质与体积，适合在线分享',
        low: '较低质量，体积最小，适合快速预览',
    };
    progressHint.value = hints[val] ?? '';
});
</script>


<template>
    <div class="video-converter">
        <!-- 文件选择区域 -->
        <div class="drop-zone" :class="{ 'drag-over': isDragOver }" @drop.prevent="handleDrop"
            @dragover.prevent="isDragOver = true" @dragleave.prevent="isDragOver = false">
            <input ref="fileInput" type="file" accept="video/*" @change="handleFileSelect" style="display: none" />
            <button @click="fileInput?.click()" :disabled="isConverting">
                {{ selectedFile ? selectedFile.name : '选择视频文件' }}
            </button>
            <p v-if="!selectedFile">或拖拽视频文件到此处</p>
            <p v-if="selectedFile" class="file-size">
                {{ formatFileSize(selectedFile.size) }}
            </p>
        </div>

        <!-- 元数据对比显示 -->
        <div v-if="originalMetadata" class="metadata-comparison">
            <h3>视频元数据对比</h3>
            <table>
                <thead>
                    <tr>
                        <th>属性</th>
                        <th>原始视频</th>
                        <th>转换后</th>
                        <th>变化</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>分辨率</td>
                        <td>{{ originalMetadata.width }} × {{ originalMetadata.height }}</td>
                        <td>{{ convertedMetadata?.width || '-' }} × {{ convertedMetadata?.height || '-' }}</td>
                        <td>{{ getResolutionChange() }}</td>
                    </tr>
                    <tr>
                        <td>帧率</td>
                        <td>{{ originalMetadata.frameRate?.toFixed(2) }} fps</td>
                        <td>{{ convertedMetadata?.frameRate?.toFixed(2) || '-' }} fps</td>
                        <td>{{ getFrameRateChange() }}</td>
                    </tr>
                    <tr>
                        <td>编码格式</td>
                        <td>{{ originalMetadata.codec }}</td>
                        <td>{{ convertedMetadata?.codec || '-' }}</td>
                        <td>{{ getCodecChange() }}</td>
                    </tr>
                    <tr>
                        <td>码率</td>
                        <td>{{ formatBitRate(originalMetadata.bitRate) }}</td>
                        <td>{{ formatBitRate(convertedMetadata?.bitRate) }}</td>
                        <td>{{ getBitRateChange() }}</td>
                    </tr>
                    <tr>
                        <td>文件大小</td>
                        <td>{{ formatFileSize(originalMetadata.fileSize) }}</td>
                        <td>{{ formatFileSize(convertedMetadata?.fileSize ?? 0) }}</td>
                        <td :class="getSizeChangeClass()">
                            {{ getSizeChange() }}
                        </td>
                    </tr>
                    <tr>
                        <td>时长</td>
                        <td>{{ formatDuration(originalMetadata.duration) }}</td>
                        <td>{{ formatDuration(convertedMetadata?.duration) }}</td>
                        <td>-</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- 转换控制 -->
        <div v-if="selectedFile && !convertedBlob" class="conversion-controls">
            <label>
                画质选项：
                <select v-model="qualityOption">
                    <option value="lossless">视觉无损（推荐）</option>
                    <option value="high">高质量</option>
                    <option value="medium">中等质量</option>
                    <option value="low">低质量（体积最小）</option>
                </select>
            </label>

            <button @click="startConversion" :disabled="isConverting" class="convert-btn">
                {{ isConverting ? '转换中...' : '开始转换' }}
            </button>
        </div>

        <!-- 进度条 -->
        <div v-if="isConverting" class="progress-section">
            <div class="progress-bar">
                <div class="progress-fill" :style="{ width: progress + '%' }"></div>
            </div>
            <span>{{ progress }}%</span>
            <p class="progress-hint">
                {{ progressHint }}
            </p>
        </div>

        <!-- 转换完成后的预览和下载 -->
        <div v-if="convertedBlob" class="result-section">
            <h3>转换完成</h3>

            <!-- 视频预览对比 -->
            <div class="preview-comparison">
                <div class="preview-item">
                    <h4>原始视频</h4>
                    <video :src="originalVideoUrl" controls width="100%"></video>
                </div>
                <div class="preview-item">
                    <h4>转换后（WebM）</h4>
                    <video :src="convertedVideoUrl" controls width="100%"></video>
                </div>
            </div>

            <button @click="downloadVideo" class="download-btn">
                下载转换后的视频
            </button>
            <button @click="resetConverter" class="reset-btn">
                重新转换
            </button>
        </div>
    </div>
</template>

<style scoped>
.video-converter {
    width: 100vw;
    height: 100vh;
    overflow-x: auto;
    padding: 20px;
}

.drop-zone {
    border: 2px dashed #ccc;
    border-radius: 8px;
    padding: 40px;
    text-align: center;
    transition: all 0.3s;
}

.drop-zone.drag-over {
    border-color: #4CAF50;
    background: #f0fff0;
}

.metadata-comparison {
    margin-top: 24px;
}

.metadata-comparison table {
    width: 100%;
    border-collapse: collapse;
}

.metadata-comparison th,
.metadata-comparison td {
    padding: 12px;
    text-align: left;
    border-bottom: 1px solid #eee;
}

.metadata-comparison th {
    background: #f5f5f5;
    font-weight: 600;
}

.conversion-controls {
    margin-top: 24px;
    display: flex;
    gap: 16px;
    align-items: center;
}

.progress-section {
    margin-top: 24px;
}

.progress-bar {
    width: 100%;
    height: 20px;
    background: #eee;
    border-radius: 10px;
    overflow: hidden;
}

.progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4CAF50, #8BC34A);
    transition: width 0.3s ease;
}

.progress-hint {
    color: #666;
    font-size: 14px;
    margin-top: 8px;
}

.preview-comparison {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin: 20px 0;
}

.preview-item {
    background: #f9f9f9;
    padding: 16px;
    border-radius: 8px;
}

.preview-item h4 {
    margin: 0 0 12px 0;
}

.convert-btn,
.download-btn,
.reset-btn {
    padding: 12px 24px;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    cursor: pointer;
    transition: all 0.3s;
}

.convert-btn {
    background: #4CAF50;
    color: white;
}

.convert-btn:disabled {
    background: #ccc;
    cursor: not-allowed;
}

.download-btn {
    background: #2196F3;
    color: white;
    margin-right: 12px;
}

.reset-btn {
    background: #f44336;
    color: white;
}

.size-reduced {
    color: #4CAF50;
    font-weight: bold;
}

.size-increased {
    color: #ff9800;
}

.file-size {
    color: #666;
    font-size: 14px;
    margin-top: 8px;
}
</style>
