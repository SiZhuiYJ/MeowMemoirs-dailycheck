<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { useCheckinsStore } from '@/stores/checkins';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { usePlansStore } from '@/stores/plans';
import { API_BASE_URL } from '@/config';
import { compressImageToWebP } from '@/utils/image';
import MmNavBar from '@/components/MmNavBar.vue';

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

/**
 * 是否为补签场景（日期已过，或当天但所选时段已结束）。
 * 仅用于顶部提示条展示，不参与提交流程判断（提交逻辑保持不变）。
 */
const retroHint = computed(() => {
    if (!dateStr.value) return false;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;
    if (dateStr.value < today) return true;
    if (dateStr.value === today && selectedTimeSlotId.value) {
        const slot = currentPlan.value?.timeSlots?.find(s => s.id === selectedTimeSlotId.value);
        if (slot) {
            const nowTimeStr = now.toTimeString().split(' ')[0] ?? '';
            return nowTimeStr > slot.endTime;
        }
    }
    return false;
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

    // 拉取计划数据：顶栏标题（打卡 / 补卡）与补签提示由 retroHint 计算属性自动推导
    await plansStore.fetchMyPlans();
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
    <!-- 毛玻璃顶栏：根容器 padding-top = 16px（--page-pad），作为内容与顶栏之间的间距 -->
    <MmNavBar :title="retroHint ? '补卡' : '打卡'" />
    <NotificationSystem />

    <!-- 头部：日期 + 补签提示（提示条仅做展示，不改提交逻辑） -->
    <view class="header">
      <text class="date-label">日期：{{ dateStr }}</text>
      <view v-if="retroHint" class="retro-hint">
        <text class="retro-hint-text">补签模式：该时段已结束，提交后将记为补签</text>
      </view>
    </view>

    <view class="card">
      <view class="form-group" v-if="currentPlan && currentPlan.timeSlots && currentPlan.timeSlots.length > 0">
        <text class="label">当前打卡时间段</text>
        <view class="slots-grid">
            <template v-for="slot in currentPlan.timeSlots" :key="slot.id">
                <view
                    v-if="selectedTimeSlotId === slot.id"
                    class="slot-item active"
                    hover-class="mm-hover"
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
                    hover-class="mm-hover"
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
            <view class="remove-btn" hover-class="mm-hover" @click.stop="handleRemoveImage(index)">×</view>
          </view>
          <view v-if="images.length < 3" class="add-btn" hover-class="mm-hover" @click="handleChooseImage">
            <text>+</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 底部提交栏：预留 iOS / 小程序底部安全区 -->
    <view class="submit-bar">
      <button class="submit-btn" :disabled="loading" @click="handleSubmit">提交</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* 页面容器：浅灰底 + 16px 内容边距，底部再预留安全区 */
.container {
  min-height: 100vh;
  box-sizing: border-box;
  padding: var(--page-pad);
  padding-bottom: calc(var(--page-pad) + var(--safe-bottom));
  background-color: var(--bg-color);
  color: var(--text-color);
}

/* 头部卡片（白底 + 常规描边 + 卡片阴影） */
.header {
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

/* 补签提示：主题浅底 + 强调色文字 */
.retro-hint {
  margin-top: 10px;
  padding: 8px 12px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  border-radius: 8px;
}

.retro-hint-text {
  font-size: 12px;
  color: var(--theme-color-strong);
  line-height: 1.5;
}

/* 表单卡片 */
.card {
  padding: 16px;
  margin-bottom: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

.form-group {
  margin-bottom: 20px;
}

.form-group:last-child {
  margin-bottom: 0;
}

/* 区块小标题：13px 灰色 */
.label {
  display: block;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}

.slots-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* 时段选项：次级底 + 描边 + 10 圆角，最小 44px 点击热区 */
.slot-item {
  width: calc(50% - 5px);
  min-height: var(--control-h);
  padding: 10px 12px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  transition: opacity 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
}

/* 选中态：主题浅底 + 强调描边 */
.slot-item.active {
  background-color: var(--theme-color-soft);
  border-color: var(--theme-color-muted);
}

.slot-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 2px;
}

.slot-item.active .slot-name {
  color: var(--theme-color-strong);
}

.slot-time {
  font-size: 12px;
  color: var(--text-muted);
}

.slot-item.active .slot-time {
  color: var(--theme-color-strong);
}

/* 备注输入：最小 44px 热区、10 圆角、白底描边 */
.textarea {
  width: 100%;
  min-height: var(--control-h);
  box-sizing: border-box;
  padding: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-color);
}

.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* 已选图片：白底 + 描边 + 10 圆角 */
.image-item {
  position: relative;
  width: 80px;
  height: 80px;
  overflow: hidden;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  border-radius: 10px;
}

.image {
  width: 100%;
  height: 100%;
}

/* 删除按钮：danger 语义色，圆形小热区 */
.remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-danger);
  color: #ffffff;
  font-size: 14px;
  line-height: 1;
  border-radius: 50%;
}

/* 添加入口：--surface-soft 底 + 虚线 --border-strong 描边 + 10 圆角 */
.add-btn {
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--surface-soft);
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
}

.add-btn text {
  font-size: 30px;
  font-weight: 300;
  line-height: 1;
  color: var(--text-faint);
}

/* 底部提交栏：padding-bottom 叠加 --safe-bottom（即 env(safe-area-inset-bottom)） */
.submit-bar {
  margin-top: 20px;
  padding-bottom: calc(12px + var(--safe-bottom));
}

/* 主提交按钮：主题渐变 + 44px 高 + 10 圆角 */
.submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: var(--control-h);
  background: var(--theme-gradient);
  color: var(--theme-action-contrast);
  font-size: 15px;
  font-weight: 600;
  border-radius: 10px;
  box-shadow: var(--theme-outer-glow-lighter);
  transition: opacity 0.2s ease;
}

.submit-btn[disabled] {
  opacity: 0.55;
}

.submit-btn::after {
  border: none;
}
</style>
