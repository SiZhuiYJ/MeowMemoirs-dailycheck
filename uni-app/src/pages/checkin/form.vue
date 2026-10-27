<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { useCheckinsStore } from '@/stores/checkins';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { usePlansStore } from '@/stores/plans';
import { API_BASE_URL } from '@/config';
import { compressImageToWebP } from '@/utils/image';

const checkinsStore = useCheckinsStore();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const plansStore = usePlansStore();

onShow(() => {
  themeStore.updateNavBarColor();
});

const planId = ref<number | null>(null);
const dateStr = ref('');
const note = ref('');
const images = ref<{ path: string; url?: string }[]>([]);
const loading = ref(false);
const selectedTimeSlotId = ref<number | null>(null);

const currentPlan = computed(() => {
    return plansStore.items.find(p => p.id === planId.value);
});

const isSlotLocked = ref(false);

onLoad(async (options: any) => {
  if (options) {
    planId.value = Number(options.planId);
    dateStr.value = options.date;
    if (options.slotId) {
        selectedTimeSlotId.value = Number(options.slotId);
        isSlotLocked.value = true;
    }

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;
    const isRetro = dateStr.value < today;

    // Wait for plans to be loaded
    await plansStore.fetchMyPlans();

    // Re-evaluate retro status if needed based on slot time
    if (dateStr.value === today && selectedTimeSlotId.value) {
         const slot = currentPlan.value?.timeSlots?.find(s => s.id === selectedTimeSlotId.value);
         if (slot) {
              const now = new Date();
              const nowTimeStr = now.toTimeString().split(' ')[0];
              if (nowTimeStr > slot.endTime) {
                  uni.setNavigationBarTitle({ title: '补卡' });
              } else {
                  uni.setNavigationBarTitle({ title: '打卡' });
              }
         } else {
             uni.setNavigationBarTitle({ title: isRetro ? '补卡' : '打卡' });
         }
    } else {
        uni.setNavigationBarTitle({ title: isRetro ? '补卡' : '打卡' });
    }
  }
});

function handleChooseImage() {
  uni.chooseImage({
    count: 3 - images.value.length,
    success: (res) => {
      // res.tempFilePaths can be string or string[] in some typings, but in success callback it's usually string[]
      // We force cast it to string[] to satisfy typescript or handle it safely
      const paths = Array.isArray(res.tempFilePaths) ? res.tempFilePaths : [res.tempFilePaths as string];
      const newImages = paths.map((path) => ({ path }));
      images.value.push(...newImages);
    },
  });
}

function handleRemoveImage(index: number) {
  images.value.splice(index, 1);
}

function handlePreviewImage(current: string) {
  uni.previewImage({
    current,
    urls: images.value.map((img) => img.path),
  });
}

// HEIC/HEIF 不在小程序端转码：原文件直接上传，服务端会解码并统一转成 WebP
async function uploadFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${API_BASE_URL}/mm/Files/images`,
      filePath: filePath,
      name: 'file',
      header: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      success: (uploadFileRes) => {
        if (uploadFileRes.statusCode === 200) {
          const data = JSON.parse(uploadFileRes.data);
          resolve(data.url);
        } else {
          reject(new Error('Upload failed'));
        }
      },
      fail: (err) => {
        reject(err);
      },
    });
  });
}

async function handleSubmit() {
  if (!planId.value || !dateStr.value) return;

  // Validate time slot if required
  if (currentPlan.value?.timeSlots && currentPlan.value.timeSlots.length > 0 && !selectedTimeSlotId.value) {
    uni.showToast({ title: '请选择打卡时间段', icon: 'none' });
    return;
  }

  if (images.value.length === 0) {
    uni.showToast({ title: '请至少上传一张图片', icon: 'none' });
    return;
  }

  loading.value = true;
  uni.showLoading({ title: '提交中' });

  try {
    // Upload images
    const uploadedUrls: string[] = [];
    for (const img of images.value) {
      if (img.url) {
        uploadedUrls.push(img.url);
      } else {
        const url = await uploadFile(img.path);
        uploadedUrls.push(url);
      }
    }

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;
    const isRetro = dateStr.value < today;

    // Additional Logic: If it's today but user selected a slot that is "missed" (past end time), use retro
    let forceRetro = false;
    if (dateStr.value === today && selectedTimeSlotId.value && currentPlan.value?.timeSlots) {
        const slot = currentPlan.value.timeSlots.find(s => s.id === selectedTimeSlotId.value);
        if (slot) {
            const now = new Date();
            const nowTimeStr = now.toTimeString().split(' ')[0];
            // Compare HH:mm:ss strings
            if (nowTimeStr > slot.endTime) {
                forceRetro = true;
            }
        }
    }

    // Force retro if title says so (fallback)
    // Actually, title is set by same logic, so redundant but safe
    
    if (isRetro || forceRetro) {
      await checkinsStore.retroCheckin({
        planId: planId.value,
        date: dateStr.value,
        imageUrls: uploadedUrls,
        note: note.value || undefined,
        timeSlotId: selectedTimeSlotId.value || undefined
      });
      uni.hideLoading();
      uni.showToast({ title: '补签成功' });
    } else {
      await checkinsStore.dailyCheckin({
        planId: planId.value,
        imageUrls: uploadedUrls,
        note: note.value || undefined,
        timeSlotId: selectedTimeSlotId.value || undefined
      });
      uni.hideLoading();
      uni.showToast({ title: '打卡成功' });
    }

    setTimeout(() => {
      uni.navigateBack();
    }, 1500);
  } catch (error) {
    uni.hideLoading();
    uni.showToast({ title: '提交失败', icon: 'none' });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <view class="container" :style="themeStore.themeStyle">
    <NotificationSystem />
    <view class="header">
      <text class="date-label">日期：{{ dateStr }}</text>
    </view>

    <view class="card">
      <view class="form-group" v-if="currentPlan && currentPlan.timeSlots && currentPlan.timeSlots.length > 0">
        <text class="label">当前打卡时间段</text>
        <view class="slots-grid">
            <template v-for="slot in currentPlan.timeSlots" :key="slot.id">
                <view
                    v-if="selectedTimeSlotId === slot.id"
                    class="slot-item active"
                    @click="isSlotLocked ? null : (selectedTimeSlotId = slot.id || null)"
                    :style="{ 
                        opacity: 1,
                        pointerEvents: isSlotLocked ? 'none' : 'auto'
                    }"
                >
                    <text class="slot-name">{{ slot.slotName }}</text>
                    <text class="slot-time">{{ slot.startTime.slice(0, 5) }} - {{ slot.endTime.slice(0, 5) }}</text>
                </view>
                <!-- If not locked, we could show others, but user request "don't show others" -->
                <!-- However, if user came without slotId (isSlotLocked=false), they need to see options -->
                <view
                    v-else-if="!isSlotLocked"
                    class="slot-item"
                    :class="{ active: selectedTimeSlotId === slot.id }"
                    @click="selectedTimeSlotId = slot.id || null"
                >
                    <text class="slot-name">{{ slot.slotName }}</text>
                    <text class="slot-time">{{ slot.startTime.slice(0, 5) }} - {{ slot.endTime.slice(0, 5) }}</text>
                </view>
            </template>
        </view>
      </view>

      <view class="form-group">
        <text class="label">备注</text>
        <textarea class="textarea" v-model="note" placeholder="写点什么..." auto-height />
      </view>

      <view class="form-group">
        <text class="label">图片（{{ images.length }}/3）</text>
        <view class="image-grid">
          <view v-for="(img, index) in images" :key="index" class="image-item">
            <image :src="img.path" mode="aspectFill" class="image" @click="handlePreviewImage(img.path)" />
            <view class="remove-btn" @click.stop="handleRemoveImage(index)">×</view>
          </view>
          <view v-if="images.length < 3" class="add-btn" @click="handleChooseImage">
            <text>+</text>
          </view>
        </view>
      </view>
    </view>

    <button class="submit-btn" :disabled="loading" @click="handleSubmit">提交</button>
  </view>
</template>

<style scoped lang="scss">
.container {
  padding: var(--uni-container-padding);
  background-color: var(--bg-color);
  min-height: 100vh;
  box-sizing: border-box;
}

.header {
  margin-bottom: var(--uni-header-margin-bottom);
  padding: var(--uni-header-padding);
  background-color: var(--bg-elevated);
  border-radius: var(--uni-header-border-radius);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.date-label {
  font-size: 16px;
  font-weight: bold;
  color: var(--text-color);
}

.card {
  background-color: var(--bg-elevated);
  border-radius: var(--uni-card-border-radius);
  padding: var(--uni-card-padding);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  margin-bottom: var(--uni-card-margin-bottom);
}

.form-group {
  margin-bottom: 24px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.slots-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}

.slot-item {
  width: calc(50% - 5px);
  background-color: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.slot-item.active {
  background-color: var(--primary-color-light, #e0f2fe);
  border-color: var(--primary-color, #0284c7);
}

.slot-name {
  font-size: 14px;
  font-weight: bold;
  color: var(--text-color);
  margin-bottom: 4px;
}

.slot-item.active .slot-name {
  color: var(--primary-color, #0284c7);
}

.slot-time {
  font-size: 12px;
  color: var(--text-secondary);
}

.slot-item.active .slot-time {
  color: var(--primary-color, #0284c7);
}

.label {
  display: block;
  font-size: 14px;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.textarea {
  width: 100%;
  min-height: 100px;
  background-color: var(--bg-color); /* Slightly different from elevated if possible, or just transparent/grey */
  border-radius: 8px;
  padding: 12px;
  font-size: 16px;
  color: var(--text-color);
  box-sizing: border-box;
}

.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.image-item {
  width: 80px;
  height: 80px;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
}

.image {
  width: 100%;
  height: 100%;
}

.remove-btn {
  position: absolute;
  top: 0;
  right: 0;
  width: 20px;
  height: 20px;
  background-color: rgba(0, 0, 0, 0.5);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  border-bottom-left-radius: 8px;
}

.add-btn {
  width: 80px;
  height: 80px;
  background-color: var(--bg-color);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.add-btn text {
  font-size: 32px;
  color: var(--text-muted);
  font-weight: 300;
}

.submit-btn {
  background-color: var(--theme-primary);
  color: #fff;
  border-radius: 24px;
  height: 48px;
  line-height: 48px;
  font-size: 16px;
  font-weight: bold;
  margin-top: 32px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.submit-btn[disabled] {
  opacity: 0.7;
}

.submit-btn::after {
  border: none;
}
</style>
