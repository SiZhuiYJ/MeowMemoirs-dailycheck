<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { useCheckinsStore, type CheckinDetail } from '@/stores/checkins';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { getApiBase } from '@/libs/http/apiBase';
import http from '@/libs/http/config';
import { notifyError } from '@/utils/notification';
import MmNavBar from '@/components/MmNavBar.vue';

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
            return getApiBase() + url;
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
    <!-- 毛玻璃顶栏：根容器 padding-top = 16px（--page-pad），作为内容与顶栏之间的间距 -->
    <MmNavBar title="打卡详情" />
    <NotificationSystem />

    <!-- 头部：日期 -->
    <view class="header">
      <text class="date-label">日期：{{ dateStr }}</text>
    </view>

    <view v-if="loading" class="loading-state">
      <text>加载中...</text>
    </view>

    <view v-else-if="detail && detail.length > 0" class="detail-content">
      <view v-for="(item, index) in detail" :key="index" class="card">
        <!-- 状态标签：成功 / 补签 / 漏签 语义色 -->
        <view class="card-header">
           <view v-if="item.status === 1" class="status-badge is-success">
             <text class="status-text">正常打卡</text>
           </view>
           <view v-else-if="item.status === 2" class="status-badge is-retro">
             <text class="status-text">补签</text>
           </view>
           <view v-else class="status-badge is-missed">
             <text class="status-text">错过</text>
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
/* 页面容器：浅灰底 + 16px 内容边距，底部预留安全区 */
.container {
  min-height: 100vh;
  box-sizing: border-box;
  padding: var(--page-pad);
  padding-bottom: calc(var(--page-pad) + var(--safe-bottom));
  background-color: var(--bg-color);
  color: var(--text-color);
}

/* 头部卡片 */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding: 16px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

.date-label {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-color);
}

/* 详情卡片 */
.card {
  padding: 16px;
  margin-bottom: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

/* 卡片头部：状态标签 + 时段标签，下方分割线 */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--divider-color);
}

/* 状态标签：语义色 + 对应 -soft 浅底 */
.status-badge {
  display: flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
}

.status-badge.is-success {
  background-color: var(--color-success-soft);
  border-color: var(--color-success);
}

.status-badge.is-retro {
  background-color: var(--color-warning-soft);
  border-color: var(--color-warning);
}

.status-badge.is-missed {
  background-color: var(--color-danger-soft);
  border-color: var(--color-danger);
}

.status-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.status-badge.is-success .status-text {
  color: var(--color-success-text);
}

.status-badge.is-retro .status-text {
  color: var(--color-warning-text);
}

.status-badge.is-missed .status-text {
  color: var(--color-danger-text);
}

/* 时段标签：次级底 + 常规描边 */
.time-slot-tag {
  padding: 3px 10px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  border-radius: 999px;
}

.time-slot-text {
  font-size: 12px;
  color: var(--text-muted);
}

.loading-state {
  margin-top: 40px;
  text-align: center;
  color: var(--text-muted);
}

/* 信息行：用 --divider-color 分割 */
.section {
  padding: 12px 0;
  border-bottom: 1px solid var(--divider-color);
}

.section:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}

/* 备注块：次级底 + 10 圆角，不抢卡片视觉 */
.note-box {
  padding: 12px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  border-radius: 10px;
}

.note-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-color);
}

.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* 图片容器：白底 + 描边 + 10 圆角 */
.detail-image {
  width: 100px;
  height: 100px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 10px;
}

.empty-text {
  font-size: 13px;
  color: var(--text-muted);
}

/* 空态：Muted 文字，不抢眼 */
.empty-state {
  display: flex;
  justify-content: center;
  padding: 40px 16px;
  font-size: 14px;
  color: var(--text-muted);
}
</style>
