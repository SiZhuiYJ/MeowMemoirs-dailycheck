<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { usePlansStore, type TimeSlotDto } from '@/stores/plans';
import { useThemeStore } from '@/stores/theme';
import { notifyError, notifySuccess, notifyWarning } from '@/utils/notification';
import MmNavBar from '@/components/MmNavBar.vue';

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
    <MmNavBar :title="isEdit ? '编辑计划' : '新建计划'" />
    <NotificationSystem />
    <view class="card">
      <view class="form-group">
        <view class="label">计划标题</view>
        <input class="input" v-model="title" placeholder="请输入标题" placeholder-class="input-placeholder" />
      </view>

      <view class="form-group">
        <view class="label">计划描述</view>
        <textarea class="textarea" v-model="description" placeholder="请输入描述" auto-height
          placeholder-class="input-placeholder" />
      </view>

      <view class="form-group">
        <view class="label">开始日期（默认今天）</view>
        <picker mode="date" :value="startDate" :start="today" @change="handleStartDateChange">
          <view class="picker-view" hover-class="mm-hover">
            <text v-if="startDate">{{ startDate }}</text>
            <text v-else class="placeholder">点击选择</text>
          </view>
        </picker>
      </view>

      <view class="form-group">
        <view class="label">结束日期（可选）</view>
        <picker mode="date" :value="endDate" :start="startDate || today" @change="handleEndDateChange">
          <view class="picker-view" hover-class="mm-hover">
            <text v-if="endDate">{{ endDate }}</text>
            <text v-else class="placeholder">点击选择</text>
          </view>
        </picker>
      </view>

      <view class="form-group">
        <view class="label-row">
          <view class="label">开启分时段打卡</view>
          <!-- 小程序 switch 的 color 需要真实色值，直接取当前主题的 --theme-primary -->
          <switch :checked="enableTimeSlots" @change="handleEnableTimeSlotsChange"
            :color="themeStore.themeStyle['--theme-primary']" />
        </view>

        <view v-if="enableTimeSlots" class="time-slots-list">
          <view v-for="(slot, index) in timeSlots" :key="index" class="time-slot-item">
            <view class="slot-header">
              <text>时间段 {{ index + 1 }}</text>
              <view class="delete-text" hover-class="mm-hover" @click="removeTimeSlot(index)">删除</view>
            </view>
            <view class="slot-content">
              <input class="input slot-name" v-model="slot.slotName" placeholder="名称 (如: 早晨)"
                placeholder-class="input-placeholder" />
              <view class="time-range">
                <picker mode="time" :value="slot.startTime.substring(0, 5)"
                  @change="(e: any) => handleTimeChange(index, 'startTime', e)">
                  <view class="time-picker" hover-class="mm-hover">{{ slot.startTime.substring(0, 5) }}</view>
                </picker>
                <text class="separator">至</text>
                <picker mode="time" :value="slot.endTime.substring(0, 5)"
                  @change="(e: any) => handleTimeChange(index, 'endTime', e)">
                  <view class="time-picker" hover-class="mm-hover">{{ slot.endTime.substring(0, 5) }}</view>
                </picker>
              </view>
            </view>
          </view>
          <view class="add-slot-btn" hover-class="mm-hover" @click="addTimeSlot">
            <text>+ 添加打卡时间段</text>
          </view>
        </view>
      </view>

      <view class="form-group" v-if="isEdit">
        <view class="label">是否启用</view>
        <switch :checked="isActive" @change="handleIsActiveChange" :color="themeStore.themeStyle['--theme-primary']" />
      </view>
    </view>

    <!-- 底部操作栏：主按钮渐变，删除按钮使用 danger token，底部留出手势条安全区 -->
    <view class="action-bar">
      <button class="submit-btn" @click="handleSubmit">{{ isEdit ? '保存修改' : '创建计划' }}</button>
      <button v-if="isEdit" class="delete-btn" @click="handleDelete">删除计划</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* 计划新建 / 编辑：单色卡片表单（中性灰 + 单一强调色，与 web 端表单一致） */
.container {
  min-height: 100vh;
  padding: var(--page-pad) var(--page-pad) 0;
  background-color: var(--bg-color);
  box-sizing: border-box;
}

/* 表单卡片：白底 + 细描边 + 主题微光阴影 */
.card {
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 16px;
  margin-bottom: 12px;
  box-sizing: border-box;
}

.form-group {
  margin-bottom: 16px;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;

  .label {
    margin-bottom: 0;
  }
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 8px;
}

/* 输入框 / 文本域 / 日期选择：统一 token 化控件，输入框 44px 高 */
.input,
.textarea,
.picker-view {
  width: 100%;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0 12px;
  color: var(--text-color);
  font-size: 14px;
  box-sizing: border-box;
}

.input {
  height: var(--control-h);
}

.textarea {
  min-height: 88px;
  padding: 10px 12px;
  line-height: 1.5;
}

:deep(.input-placeholder) {
  color: var(--text-faint);
}

/* 解决 H5 下 uni-input 选中问题 */
:deep(input),
:deep(textarea) {
  user-select: text !important;
  -webkit-user-select: text !important;
}

.picker-view {
  min-height: var(--control-h);
  display: flex;
  align-items: center;
}

.placeholder {
  color: var(--text-faint);
}

/* 分时段打卡：次级底卡片 + 主题色时间 chip */
.time-slots-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.time-slot-item {
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 12px;
}

.slot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 44px;
  margin-bottom: 4px;
  font-size: 13px;
  color: var(--text-muted);
}

/* 删除时间段：危险操作用 danger token */
.delete-text {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  background-color: var(--color-danger-soft);
  color: var(--color-danger-text);
  font-size: 12px;
}

.slot-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.slot-name {
  background-color: var(--bg-elevated);
}

.time-range {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 时间 chip 选中态 = 主题浅底 + 主题色字 + 主题色描边 */
.time-picker {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 88px;
  height: 40px;
  padding: 0 12px;
  border-radius: 999px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
  font-size: 14px;
  font-weight: 500;
  box-sizing: border-box;
}

.separator {
  color: var(--text-faint);
  font-size: 12px;
}

.add-slot-btn {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: var(--control-h);
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  color: var(--theme-color-strong);
  font-size: 14px;
  transition: opacity 0.2s ease;
}

.form-group:last-child {
  margin-bottom: 0;
}

/* 底部操作栏：主按钮主题渐变；删除计划用 danger token；底部安全区适配 */
.action-bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: calc(12px + var(--safe-bottom));
}

.submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: var(--control-h);
  border: none;
  border-radius: 10px;
  background: var(--theme-gradient);
  color: var(--theme-action-contrast);
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
}

.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: var(--control-h);
  border: 1px solid var(--color-danger);
  border-radius: 10px;
  background-color: var(--color-danger-soft);
  color: var(--color-danger-text);
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
}
</style>
