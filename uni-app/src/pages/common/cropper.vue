<template>
  <view class="cropper-page" :style="themeStore.themeStyle">
    <!-- 裁剪页是全屏沉浸式页面（无标题栏），用一枚毛玻璃返回按钮避免无法退出；
         不占布局高度，不会干扰裁剪画布的坐标计算 -->
    <view class="cropper-back" hover-class="mm-hover" @click="goBack">
      <view class="cropper-back-icon"></view>
    </view>

    <!-- navigation=false because pages.json has navigationStyle: custom -->
    <!-- 裁剪尺寸/格式可由调用方用 query 指定（width/height/filetype/quality），默认 500x500 png；
         个人主页背景图传 width=1200&height=1200&filetype=jpg，避免 500px 铺满卡片时发虚 -->
    <qf-image-cropper 
      v-if="src" 
      :src="src" 
      :width="cropWidth" 
      :height="cropHeight" 
      :file-type="fileType"
      :quality="quality"
      :radius="0" 
      :navigation="false"
      @crop="handleCrop" 
    />
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useThemeStore } from '@/stores/theme';
import QfImageCropper from '@/components/qf-image-cropper/qf-image-cropper.vue';

// 页面根节点绑定主题变量，裁剪器内部的强调色/描边随之继承
const themeStore = useThemeStore();

const src = ref('');

// 裁剪输出尺寸（px）。默认 500x500（头像等小图）；背景这类整卡铺满的图需要更大分辨率。
const cropWidth = ref(500);
const cropHeight = ref(500);
// 输出格式与 jpg 质量：背景图用 jpg 控制体积，默认沿用 png。
const fileType = ref<'png' | 'jpg'>('png');
const quality = ref(92);

const CROP_SIZE_MIN = 100;
const CROP_SIZE_MAX = 1440;

function parseCropSize(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, CROP_SIZE_MIN), CROP_SIZE_MAX);
}

onLoad((options: any) => {
  if (options.src) {
    src.value = options.src;
  }
  cropWidth.value = parseCropSize(options.width, 500);
  cropHeight.value = parseCropSize(options.height, 500);
  if (options.filetype === 'jpg' || options.filetype === 'jpeg') {
    fileType.value = 'jpg';
  }
  const q = Number(options.quality);
  if (Number.isFinite(q) && q > 0 && q <= 100) {
    quality.value = q;
  }
});

function goBack() {
  try {
    if (getCurrentPages().length > 1) uni.navigateBack({ delta: 1 });
    else uni.reLaunch({ url: '/pages/main/index' });
  } catch (err) {
    uni.reLaunch({ url: '/pages/main/index' });
  }
}

function handleCrop(e: { tempFilePath: string }) {
  // Return result to opener
  const eventChannel = (getCurrentPages().pop() as any).getOpenerEventChannel();
  eventChannel.emit('cropSuccess', { tempFilePath: e.tempFilePath });
  uni.navigateBack();
}
</script>

<style>
/* 裁剪页底色跟随主题 token；裁剪器自身使用固定深色画布保证图片对比 */
page {
  width: 100%;
  height: 100%;
  background-color: var(--bg-color);
}
.cropper-page {
  width: 100%;
  height: 100%;
  background-color: var(--bg-color);
}

/* 毛玻璃返回按钮：与全站顶栏同一套半透明 + 背景模糊语言 */
.cropper-back {
  position: fixed;
  top: calc(var(--status-bar-height, 0px) + 10px);
  left: 12px;
  z-index: 1200;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 50%;
  background-color: var(--header-bg-fallback);
  border: 1px solid var(--header-border);
}

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .cropper-back {
    background-color: var(--header-bg);
    -webkit-backdrop-filter: blur(18px) saturate(180%);
    backdrop-filter: blur(18px) saturate(180%);
  }
}

/* 朝左的 chevron（仓库 turn-left.svg 实际朝右，这里用 CSS 绘制保证方向正确） */
.cropper-back-icon {
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border-style: solid;
  border-color: var(--text-color);
  border-width: 0 2px 2px 0;
  transform: rotate(135deg);
  margin-left: 3px;
}
</style>
