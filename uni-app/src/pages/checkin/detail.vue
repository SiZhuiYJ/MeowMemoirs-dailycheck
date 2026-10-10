<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { useCheckinsStore, type CheckinDetail } from '@/stores/checkins';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { API_BASE_URL } from '@/config';
import http from '@/libs/http/config';
import { notifyError } from '@/utils/notification';

const checkinsStore = useCheckinsStore();
const themeStore = useThemeStore();

const planId = ref<number | null>(null);
const dateStr = ref('');
const detail = ref<CheckinDetail[]>([]);
const loading = ref(true);
const imageBlobMap = ref<Record<string, string>>({});

onLoad(async (options) => {
  if (options) {
    planId.value = Number(options.planId);
    dateStr.value = options.date;
    await fetchDetail();
  }
});

onShow(() => {
  themeStore.updateNavBarColor();
});

onUnmounted(() => {
  // Cleanup blob URLs
  // #ifndef MP-WEIXIN
  Object.values(imageBlobMap.value).forEach(url => URL.revokeObjectURL(url));
  // #endif
});

async function loadImage(url: string) {
  if (imageBlobMap.value[url]) return;

  // #ifdef MP-WEIXIN
  const authStore = useAuthStore();
  uni.downloadFile({
    url: url,
    header: {
      'Authorization': `Bearer ${authStore.accessToken}`
    },
    success: (res) => {
      if (res.statusCode === 200) {
        imageBlobMap.value[url] = res.tempFilePath;
      }
    },
    fail: (err) => {
      console.error('Download failed', err);
    }
  });
  // #endif

  // #ifndef MP-WEIXIN
  try {
    // Fetch image as arraybuffer with token
    const authStore = useAuthStore();
    const res = await http.get<ArrayBuffer>(url, { 
      responseType: 'arraybuffer',
      header: {
        'Authorization': `Bearer ${authStore.accessToken}`
      }
    });
    // In UniApp H5, res.data is ArrayBuffer
    const blob = new Blob([res.data]);
    const blobUrl = URL.createObjectURL(blob);
    imageBlobMap.value[url] = blobUrl;
  } catch (e) {
    console.error('Failed to load image', url, e);
  }
  // #endif
}

async function fetchDetail() {
  if (!planId.value || !dateStr.value) return;
  loading.value = true;
  try {
    const res = await checkinsStore.getCheckinDetail(planId.value, dateStr.value);
    
    // Process results
    const processedDetails = res.map(item => {
        const processedUrls = item.imageUrls.map(url => {
            if (url.startsWith('http')) return url;
            return API_BASE_URL + url;
        });
        return {
            ...item,
            imageUrls: processedUrls
        };
    });

    detail.value = processedDetails;

    // Load images
    processedDetails.forEach(item => {
        item.imageUrls.forEach(url => loadImage(url));
    });

  } catch (e) {
    notifyError('加载失败');
  } finally {
    loading.value = false;
  }
}

function handlePreviewImage(originalUrl: string) {
  if (!detail.value.length) return;
  
  // Collect all images from all details for the preview
  const allImages = detail.value.flatMap(d => d.imageUrls);
  const urls = allImages.map(url => imageBlobMap.value[url] || url);
  const current = imageBlobMap.value[originalUrl] || originalUrl;

  uni.previewImage({
    current,
    urls,
  });
}
</script>

<template>
  <view class="container" :style="themeStore.themeStyle">
    <NotificationSystem />
    <view class="header">
      <text class="date-label">日期：{{ dateStr }}</text>
    </view>

    <view v-if="loading" class="loading-state">
      <text>加载中...</text>
    </view>

    <view v-else-if="detail && detail.length > 0" class="detail-content">
      <view v-for="(item, index) in detail" :key="index" class="card">
        <view class="card-header">
           <view class="status-badge">
            <text v-if="item.status === 1" class="status-text success">正常打卡</text>
            <text v-else-if="item.status === 2" class="status-text retro">补签</text>
            <text v-else class="status-text missed">错过</text>
           </view>
           <view v-if="item.timeSlotId" class="time-slot-tag">
             <text class="time-slot-text">时段 {{ item.timeSlotId }}</text>
           </view>
        </view>
      
        <view class="section">
          <text class="label">备注</text>
          <view class="note-box">
            <text class="note-text">{{ item.note || '无备注' }}</text>
          </view>
        </view>

        <view class="section">
          <text class="label">图片</text>
          <view class="image-grid" v-if="item.imageUrls && item.imageUrls.length > 0">
            <image v-for="(url, imgIndex) in item.imageUrls" :key="imgIndex" :src="imageBlobMap[url]" mode="aspectFill"
              class="detail-image" @click="handlePreviewImage(url)" />
          </view>
          <text v-else class="empty-text">无图片</text>
        </view>
      </view>
    </view>
    <view v-else class="empty-state">
        <text>暂无打卡记录</text>
    </view>

  </view>
</template>

<style scoped lang="scss">
@use "@/styles/status-colors.scss";

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}
.time-slot-tag {
    background-color: var(--primary-color-light, #e0f2fe);
    padding: 2px 8px;
    border-radius: 4px;
}
.time-slot-text {
    font-size: 12px;
    color: var(--primary-color, #0284c7);
}
.empty-state {
    display: flex;
    justify-content: center;
    padding: 40px;
    color: var(--text-secondary);
}
.container {
  padding: var(--uni-container-padding);
  background-color: var(--bg-color);
  min-height: 100vh;
  box-sizing: border-box;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--uni-header-margin-bottom);
  padding: var(--uni-header-padding);
  background-color: var(--bg-elevated);
  border-radius: var(--uni-header-border-radius);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.date-label {
  font-size: 18px;
  font-weight: bold;
  color: var(--text-color);
}

.status-badge {
  padding: 4px 12px;
  border-radius: 999px;
  background-color: var(--bg-color);
}

.status-text {
  font-size: 14px;
  font-weight: 500;
}

.loading-state {
  text-align: center;
  color: var(--text-muted);
  margin-top: 40px;
}

.card {
  background-color: var(--bg-elevated);
  border-radius: var(--uni-card-border-radius);
  padding: var(--uni-card-padding);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  margin-bottom: var(--uni-card-margin-bottom);
}

.section {
  margin-bottom: 24px;
}

.section:last-child {
  margin-bottom: 0;
}

.label {
  font-size: 14px;
  color: var(--text-muted);
  margin-bottom: 8px;
  display: block;
}

.note-box {
  background-color: var(--bg-color);
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.note-text {
  font-size: 15px;
  color: var(--text-color);
  line-height: 1.5;
}

.image-grid {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.detail-image {
  width: 100px;
  height: 100px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.empty-text {
  color: var(--text-muted);
  font-size: 14px;
}
</style>
