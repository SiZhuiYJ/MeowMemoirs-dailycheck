<script setup lang="ts">
import { ref } from 'vue';
import type { FileData } from '@ffmpeg/ffmpeg';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();
const progress = ref(0);
const isLoaded = ref(false);
const videoUrl = ref('');
const toBlobPart = (data: FileData): BlobPart =>
  typeof data === 'string' ? data : new Uint8Array(data);

// 1. 加载 FFmpeg 核心库
const loadFFmpeg = async () => {
  // const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  const baseURL = '/ffmpeg';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  isLoaded.value = true;
};

// 2. 转换视频格式
const convertToWebm = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  if (!isLoaded.value) await loadFFmpeg();

  // 监听进度
  ffmpeg.on('log', ({ message }) => console.log(message));
  ffmpeg.on('progress', ({ progress: p }) => {
    progress.value = Math.round(p * 100);
  });
  try {
    await ffmpeg.writeFile('input_video', await fetchFile(file));

    // 1. 使用较轻量的 VP8 编码器
    // 2. 移除不支持的 autorotate
    // 3. 确保分辨率为偶数
    await ffmpeg.exec([
      '-i', 'input_video',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libvpx',
      '-b:v', '1M',      // 指定码率可以减少内存波动
      '-c:a', 'libvorbis',
      'output.webm'
    ]);
    // 读取生成的文件
    const data = await ffmpeg.readFile('output.webm');

    const blob = new Blob([toBlobPart(data)], { type: 'video/webm' });
    videoUrl.value = URL.createObjectURL(blob);
    // 转换完成后清理虚拟文件
    await ffmpeg.deleteFile('input_video');
    await ffmpeg.deleteFile('output.webm');
  }
  catch (error) {
    console.error("转换失败，可能是内存不足或指令错误:", error);
  }
}
</script>

<template>
  <div>
    <h3>视频转 WebM (Vue + TS)</h3>
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
