<!-- <script setup lang="ts">
import { ref } from 'vue';
import type { FileData, ProgressEvent } from '@ffmpeg/ffmpeg';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();
const progress = ref(0);
const isLoaded = ref(false);
const videoUrl = ref('');

const toBlobPart = (data: FileData): BlobPart =>
  typeof data === 'string' ? data : new Uint8Array(data);

// 加载 FFmpeg 核心库（多线程版）
const loadFFmpeg = async () => {
  if (isLoaded.value) return;

  const baseURL = '/ffmpeg'; // 自行部署 FFmpeg 核心文件
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'), // Worker 文件
  });

  // 监听进度
  ffmpeg.on('progress', (event: ProgressEvent) => {
    progress.value = Math.min(Math.round(event.progress * 100), 100);
  });

  ffmpeg.on('log', ({ message }: { message: string }) => console.log('[FFmpeg LOG]', message));

  isLoaded.value = true;
};

// 转换视频到 WebM
const convertToWebm = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  try {
    if (!isLoaded.value) await loadFFmpeg();

    // 写入输入文件
    await ffmpeg.writeFile('input_video', await fetchFile(file));

    // FFmpeg 指令，多线程 + 稳定配置
    await ffmpeg.exec([
      '-i', 'input_video',
      '-c:v', 'libvpx',       // VP9 视频编码libvpx-vp9
      '-threads', '32',        // 指定线程数，可根据设备调整
      // '-crf', '0',
      // '-b:v', '1M',           // 视频码率
      // '-c:a', 'copy',          // 音频复制, 可选  // 音频编码
      'output.webm'
    ]);

    // 读取输出文件
    const data = await ffmpeg.readFile('output.webm');
    const blob = new Blob([toBlobPart(data)], { type: 'video/webm' });
    videoUrl.value = URL.createObjectURL(blob);

    // 清理临时文件
    await ffmpeg.deleteFile('input_video');
    await ffmpeg.deleteFile('output.webm');

  } catch (error) {
    console.error('转换失败:', error);
  }
};
</script>

<template>
  <div class="video-converter-page">
    <h3>视频转 WebM (多线程 Vue + TS)</h3>
    <input type="file" @change="convertToWebm" accept="video/*" />

    <div v-if="progress > 0 && progress < 100">
      转换进度: {{ progress }}%
    </div>

    <div v-if="videoUrl">
      <p>预览转换结果：</p>
      <video :src="videoUrl" controls width="400"></video>
      <br />
      <a :href="videoUrl" download="video.webm">下载 WebM</a>
    </div>
  </div>
</template>
<style lang="scss" scoped>
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
  /* 100vw 含纵向滚动条宽度会横向溢出；100vh 在移动端超出可视区。 */
  width: 100%;
  height: var(--app-h);
  overflow-x: auto;
  padding: 24px;
  background: var(--page-bg);
  color: var(--text-main);
}
</style> -->
<template>
  <VideoConverter />
</template>
<script setup lang="ts">
import VideoConverter from '@/components/ToWebM/index.vue'
</script>