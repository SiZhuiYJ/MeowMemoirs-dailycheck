<template>
  <view class="container">
    <!-- navigation=false because pages.json has navigationStyle: custom -->
    <qf-image-cropper 
      v-if="src" 
      :src="src" 
      :width="500" 
      :height="500" 
      :radius="0" 
      :navigation="false"
      @crop="handleCrop" 
    />
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import QfImageCropper from '@/components/qf-image-cropper/qf-image-cropper.vue';

const src = ref('');

onLoad((options: any) => {
  if (options.src) {
    src.value = options.src;
  }
});

function handleCrop(e: { tempFilePath: string }) {
  // Return result to opener
  const eventChannel = (getCurrentPages().pop() as any).getOpenerEventChannel();
  eventChannel.emit('cropSuccess', { tempFilePath: e.tempFilePath });
  uni.navigateBack();
}
</script>

<style>
page {
  background: #000;
  width: 100%;
  height: 100%;
}
.container {
  width: 100%;
  height: 100%;
}
</style>
