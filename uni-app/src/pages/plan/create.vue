<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { usePlansStore, type TimeSlotDto } from '@/stores/plans';
import { useThemeStore } from '@/stores/theme';
import { notifyError, notifySuccess, notifyWarning } from '@/utils/notification';

const plansStore = usePlansStore();
const themeStore = useThemeStore();

const isEdit = ref(false);

onShow(() => {
  themeStore.updateNavBarColor();
});
const planId = ref<number | null>(null);
const title = ref('');
const description = ref('');
const startDate = ref('');
const endDate = ref('');
const isActive = ref(true);
const enableTimeSlots = ref(false);
const timeSlots = ref<TimeSlotDto[]>([]);

const today = new Date().toISOString().split('T')[0];

onLoad((options: any) => {
  if (options && options.id) {
    isEdit.value = true;
    planId.value = Number(options.id);
    const plan = plansStore.items.find(x => x.id === planId.value);
    if (plan) {
      title.value = plan.title;
      description.value = plan.description;
      startDate.value = plan.startDate;
      endDate.value = plan.endDate || '';
      isActive.value = plan.isActive;
      if (plan.timeSlots && plan.timeSlots.length > 0) {
        enableTimeSlots.value = true;
        timeSlots.value = JSON.parse(JSON.stringify(plan.timeSlots));
      }
      uni.setNavigationBarTitle({ title: '编辑计划' });
    }
  }
});

function handleStartDateChange(e: any) {
  startDate.value = e.detail.value;
}

function handleEndDateChange(e: any) {
  endDate.value = e.detail.value;
}

function handleIsActiveChange(e: any) {
  isActive.value = e.detail.value;
}

function handleEnableTimeSlotsChange(e: any) {
  enableTimeSlots.value = e.detail.value;
  if (enableTimeSlots.value && timeSlots.value.length === 0) {
    addTimeSlot();
  }
}

function addTimeSlot() {
  timeSlots.value.push({
    startTime: '09:00:00',
    endTime: '10:00:00',
    slotName: '',
    isActive: true,
  });
}

function removeTimeSlot(index: number) {
  timeSlots.value.splice(index, 1);
}

function handleTimeChange(index: number, field: 'startTime' | 'endTime', e: any) {
  timeSlots.value[index][field] = e.detail.value + ':00'; // uni-app picker returns HH:mm, backend needs HH:mm:ss
}

async function handleDelete() {
  if (!planId.value) return;
  uni.showModal({
    title: '确认删除',
    content: '确定要删除这个计划吗？删除后无法恢复。',
    success: async (res) => {
      if (res.confirm) {
        try {
          await plansStore.deletePlan(planId.value!);
          notifySuccess('删除成功');
          uni.$emit('plan-updated');
          uni.$emit('switch-tab', 1); // Switch to "Today's Check-in"
          setTimeout(() => {
            const pages = getCurrentPages();
            if (pages.length > 1) {
              // If previous page is plan detail, we should skip it because plan is deleted
              const prevPage = pages[pages.length - 2];
              if (prevPage.route === 'pages/plan/detail') {
                // Check if we have enough history to go back 2 steps
                if (pages.length > 2) {
                  uni.navigateBack({ delta: 2 });
                } else {
                  // If detail was the first page (unlikely but possible with deep link), relaunch
                  uni.reLaunch({ url: '/pages/main/index?tab=1' });
                }
              } else {
                uni.navigateBack();
              }
            } else {
              uni.reLaunch({ url: '/pages/main/index?tab=1' });
            }
          }, 1500);
        } catch (e) {
          notifyError('删除失败');
        }
      }
    }
  });
}

async function handleSubmit() {
  if (!title.value.trim()) {
    notifyWarning('请输入计划标题');
    return;
  }

  if (startDate.value && endDate.value && new Date(endDate.value) < new Date(startDate.value)) {
    notifyWarning('结束日期不能早于开始日期');
    return;
  }

  // Time slots validation
  if (enableTimeSlots.value) {
    if (timeSlots.value.length === 0) {
      notifyWarning('请至少添加一个打卡时间段');
      return;
    }
    for (const slot of timeSlots.value) {
      if (!slot.startTime || !slot.endTime) {
        notifyWarning('请填写完整的时间段信息');
        return;
      }
      if (slot.startTime >= slot.endTime) {
        notifyWarning(`时间段 ${slot.slotName || ''} 开始时间必须早于结束时间`);
        return;
      }
    }
    // Check overlaps
    const sorted = [...timeSlots.value].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].endTime > sorted[i + 1].startTime) {
        notifyWarning('时间段存在重叠，请检查设置');
        return;
      }
    }
  }

  const payloadTimeSlots = enableTimeSlots.value
    ? timeSlots.value.map((ts, index) => ({
      ...ts,
      orderNum: index + 1,
      isActive: true,
    }))
    : undefined;

  try {
    if (isEdit.value && planId.value) {
      await plansStore.updatePlan({
        id: planId.value,
        title: title.value.trim(),
        description: description.value || undefined,
        startDate: startDate.value || null,
        endDate: endDate.value || null,
        isActive: isActive.value,
        timeSlots: payloadTimeSlots,
      });
      notifySuccess('更新成功');
    } else {
      await plansStore.createPlan({
        title: title.value.trim(),
        description: description.value || undefined,
        startDate: startDate.value || null,
        endDate: endDate.value || null,
        timeSlots: payloadTimeSlots,
      });
      notifySuccess('创建成功');
    }

    uni.$emit('plan-updated');
    uni.$emit('switch-tab', 1); // Switch to "Today's Check-in"
    setTimeout(() => {
      // Switch to tabbar page index
      if (getCurrentPages().length > 1) {
        uni.navigateBack();
      } else {
        uni.reLaunch({ url: '/pages/main/index?tab=1' });
      }
    }, 1500);
  } catch (e) {
    notifyError(isEdit.value ? '更新失败' : '创建失败');
  }
}
</script>

<template>
  <view class="container" :style="themeStore.themeStyle">
    <NotificationSystem />
    <view class="card">
      <view class="form-group">
        <view class="label">计划标题</view>
        <input class="input" v-model="title" placeholder="请输入标题" />
      </view>

      <view class="form-group">
        <view class="label">计划描述</view>
        <textarea class="textarea" v-model="description" placeholder="请输入描述" auto-height />
      </view>

      <view class="form-group">
        <view class="label">开始日期（默认今天）</view>
        <picker mode="date" :value="startDate" :start="today" @change="handleStartDateChange">
          <view class="picker-view">
            <text v-if="startDate">{{ startDate }}</text>
            <text v-else class="placeholder">点击选择</text>
          </view>
        </picker>
      </view>

      <view class="form-group">
        <view class="label">结束日期（可选）</view>
        <picker mode="date" :value="endDate" :start="startDate || today" @change="handleEndDateChange">
          <view class="picker-view">
            <text v-if="endDate">{{ endDate }}</text>
            <text v-else class="placeholder">点击选择</text>
          </view>
        </picker>
      </view>

      <view class="form-group">
        <view class="label-row">
          <view class="label">开启分时段打卡</view>
          <switch :checked="enableTimeSlots" @change="handleEnableTimeSlotsChange" color="var(--accent-color)" />
        </view>

        <view v-if="enableTimeSlots" class="time-slots-list">
          <view v-for="(slot, index) in timeSlots" :key="index" class="time-slot-item">
            <view class="slot-header">
              <text>时间段 {{ index + 1 }}</text>
              <text class="delete-text" @click="removeTimeSlot(index)">删除</text>
            </view>
            <view class="slot-content">
              <input class="input slot-name" v-model="slot.slotName" placeholder="名称 (如: 早晨)" />
              <view class="time-range">
                <picker mode="time" :value="slot.startTime.substring(0, 5)"
                  @change="(e) => handleTimeChange(index, 'startTime', e)">
                  <view class="time-picker">{{ slot.startTime.substring(0, 5) }}</view>
                </picker>
                <text class="separator">至</text>
                <picker mode="time" :value="slot.endTime.substring(0, 5)"
                  @change="(e) => handleTimeChange(index, 'endTime', e)">
                  <view class="time-picker">{{ slot.endTime.substring(0, 5) }}</view>
                </picker>
              </view>
            </view>
          </view>
          <view class="add-slot-btn" @click="addTimeSlot">
            <text>+ 添加打卡时间段</text>
          </view>
        </view>
      </view>

      <view class="form-group" v-if="isEdit">
        <view class="label">是否启用</view>
        <switch :checked="isActive" @change="handleIsActiveChange" color="var(--accent-color)" />
      </view>
    </view>

    <button class="submit-btn" @click="handleSubmit">{{ isEdit ? '保存修改' : '创建计划' }}</button>
    <button v-if="isEdit" class="delete-btn" @click="handleDelete">删除计划</button>
  </view>
</template>

<style scoped lang="scss">
.container {
  padding: var(--uni-container-padding);
  background-color: var(--bg-color);
  min-height: 100vh;
  box-sizing: border-box;
}

.card {
  background-color: var(--bg-elevated);
  border-radius: var(--uni-card-border-radius);
  padding: var(--uni-card-padding);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  margin-bottom: var(--uni-card-margin-bottom);
}

.form-group {
  margin-bottom: 20px;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;

  .label {
    margin-bottom: 0;
  }
}

.time-slots-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 10px;
}

.time-slot-item {
  background-color: var(--bg-color);
  border-radius: 8px;
  padding: 12px;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.slot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.delete-text {
  color: #ff4d4f;
  padding: 4px;
}

.slot-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.slot-name {
  font-size: 14px;
  background-color: var(--bg-elevated);
}

.time-range {
  display: flex;
  align-items: center;
  gap: 10px;
}

.time-picker {
  background-color: var(--bg-elevated);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 14px;
  color: var(--text-primary);
  border: 1px solid rgba(0, 0, 0, 0.1);
  min-width: 80px;
  text-align: center;
}

.separator {
  color: var(--text-secondary);
  font-size: 12px;
}

.add-slot-btn {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 14px;

  &:active {
    background-color: rgba(0, 0, 0, 0.02);
  }
}

.form-group:last-child {
  margin-bottom: 0;
}


.label {
  font-size: 14px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.input,
.textarea,
.picker-view {
  background-color: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px;
  color: var(--text-color);
  font-size: 14px;
  width: 100%;
  box-sizing: border-box;
  /* Ensure padding doesn't affect width */
}

.input {
  height: 44px;
  line-height: 24px;
  /* content height */
}

.textarea {
  min-height: 80px;
  line-height: 1.5;
}

/* 解决H5下uni-input选中问题 */
:deep(input),
:deep(textarea) {
  user-select: text !important;
  -webkit-user-select: text !important;
}

.picker-view {
  min-height: 40px;
  display: flex;
  align-items: center;
}

.placeholder {
  color: var(--text-muted);
}

.submit-btn {
  background-color: var(--theme-primary);
  color: #fff;
  border-radius: 999px;
  border: none;
  font-weight: 600;
  margin-bottom: var(--uni-card-margin-bottom);
}


.delete-btn {
  background-color: #ef4444;
  color: white;
  border-radius: 999px;
  border: none;
  font-weight: 600;
}
</style>
