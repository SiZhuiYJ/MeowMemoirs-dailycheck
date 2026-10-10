<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { usePlansStore } from '@/stores/plans';
import { useCheckinsStore, type CheckinDetail } from '@/stores/checkins';
import { useThemeStore } from '@/stores/theme';
import { notifyWarning } from '@/utils/notification';
import { toLocalDateOnlyString, parseDateOnly, getMonthDays } from '@/utils/date';

const plansStore = usePlansStore();
const checkinsStore = useCheckinsStore();
const themeStore = useThemeStore();

const planId = ref<number | null>(null);
const currentYear = ref(new Date().getFullYear());
const currentMonth = ref(new Date().getMonth() + 1);
const selectedDate = ref<Date>(new Date());
const selectedCheckins = ref<CheckinDetail[]>([]);

onLoad((options: any) => {
  if (options && options.id) {
    planId.value = Number(options.id);
  }
});

const currentPlan = computed(() => {
  return plansStore.items.find((x) => x.id === planId.value);
});

onShow(async () => {
  themeStore.updateNavBarColor();
  if (planId.value) {
    await fetchCalendar();
    await updateSelectedDateDetails();
  }
});

function handleEdit() {
  if (planId.value) {
    uni.navigateTo({
      url: `/pages/plan/create?id=${planId.value}`
    });
  }
}

async function fetchCalendar() {
  if (!planId.value) return;
  await checkinsStore.loadCalendar(planId.value, currentYear.value, currentMonth.value);
}

async function updateSelectedDateDetails() {
  if (!planId.value) return;
  try {
    const dateStr = toLocalDateOnlyString(selectedDate.value);
    selectedCheckins.value = await checkinsStore.getCheckinDetail(planId.value, dateStr);
  } catch {
    selectedCheckins.value = [];
  }
}

function prevMonth() {
  if (currentMonth.value === 1) {
    currentMonth.value = 12;
    currentYear.value -= 1;
  } else {
    currentMonth.value -= 1;
  }
  fetchCalendar();
}

function nextMonth() {
  if (currentMonth.value === 12) {
    currentMonth.value = 1;
    currentYear.value += 1;
  } else {
    currentMonth.value += 1;
  }
  fetchCalendar();
}

const monthDays = computed(() => {
  return getMonthDays(currentYear.value, currentMonth.value);
});

const calendarCells = computed(() => {
  const source = monthDays.value;
  if (source.length === 0) return [] as Array<Date | null>;
  const cells: Array<Date | null> = [];
  const firstDay = source[0];
  // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const weekday = firstDay ? firstDay.getDay() : 1;
  // Convert to Monday-based index: 0 = Monday, ..., 6 = Sunday
  // If Sunday (0), we want offset 6.
  // If Monday (1), we want offset 0.
  const offset = weekday === 0 ? 6 : weekday - 1;

  for (let i = 0; i < offset; i += 1) {
    cells.push(null);
  }
  for (const d of source) {
    cells.push(d);
  }
  return cells;
});

function isInPlanRange(date: Date): boolean {
  if (!currentPlan.value) return false;
  const plan = currentPlan.value;
  const cellDate = parseDateOnly(toLocalDateOnlyString(date));
  const startDate = parseDateOnly(plan.startDate);
  const endDate = plan.endDate ? parseDateOnly(plan.endDate) : null;
  if (cellDate < startDate) return false;
  if (endDate && cellDate > endDate) return false;
  return true;
}

function getStatusCode(date: Date): number | undefined {
  if (!planId.value) return undefined;
  const list = checkinsStore.calendarByPlan[planId.value] ?? [];
  const key = toLocalDateOnlyString(date);
  const found = list.find((item) => item.date === key);

  if (found) return found.status;

  // Check for missed status (0)
  const cellDate = parseDateOnly(toLocalDateOnlyString(date));
  const now = new Date();
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const inPlan = isInPlanRange(date);
  const isPastDay = cellDate < todayOnly;

  if (inPlan && isPastDay) {
    return 0;
  }

  return undefined;
}

function getDayStatusClass(date: Date): string {
  const status = getStatusCode(date);
  if (status === 1) return 'day success';
  if (status === 2) return 'day retro';
  if (status === 0) return 'day missed';

  return 'day';
}

function getCellClass(cell: Date | null): string[] {
  if (!cell) return ['mini-day', 'mini-day-empty'];

  const classes = ['mini-day', getDayStatusClass(cell)];

  // Check for selected
  const targetOnly = new Date(cell.getFullYear(), cell.getMonth(), cell.getDate());
  const selectedOnly = new Date(selectedDate.value.getFullYear(), selectedDate.value.getMonth(), selectedDate.value.getDate());

  if (targetOnly.getTime() === selectedOnly.getTime()) {
    classes.push('mini-day-today'); // Reuse the 'today' style for selected
  }

  return classes;
}

function handleDateClick(date: Date) {
  if (!isInPlanRange(date)) return;

  selectedDate.value = date;
  updateSelectedDateDetails();
}

// Slot logic
interface SlotStatus {
  id: number;
  name: string;
  timeRange: string;
  status: 'done' | 'pending' | 'missed' | 'future' | 'not_started' | 'ended';
  canCheckin: boolean;
  canRetro: boolean;
  checkinStatus?: number; // 1 or 2
}

const slotStatuses = computed(() => {
  if (!currentPlan.value?.timeSlots?.length) return [];

  const now = new Date();
  const todayStr = toLocalDateOnlyString(now);
  const selectedStr = toLocalDateOnlyString(selectedDate.value);
  const isToday = todayStr === selectedStr;
  const isPast = selectedStr < todayStr;
  const isFuture = selectedStr > todayStr;

  const plan = currentPlan.value;
  const cellDate = parseDateOnly(selectedStr);
  const startDate = parseDateOnly(plan.startDate);
  const endDate = plan.endDate ? parseDateOnly(plan.endDate) : null;

  // Current time in HH:mm:ss
  const nowTimeStr = now.toTimeString().split(' ')[0];

  return currentPlan.value.timeSlots.map(slot => {
    const checkin = selectedCheckins.value.find(c => c.timeSlotId === slot.id);

    let status: SlotStatus['status'] = 'future';
    let canCheckin = false;
    let canRetro = false;

    if (checkin) {
      status = 'done';
    } else if (cellDate < startDate) {
      status = 'not_started';
    } else if (endDate && cellDate > endDate) {
      status = 'ended';
    } else if (isFuture) {
      status = 'future';
    } else if (isPast) {
      status = 'missed';
      canRetro = true;
    } else {
      // Today
      if (nowTimeStr < slot.startTime) {
        status = 'future';
      } else if (nowTimeStr > slot.endTime) {
        status = 'missed';
        canRetro = true;
      } else {
        status = 'pending';
        canCheckin = true;
      }
    }

    return {
      id: slot.id!,
      name: slot.slotName || '',
      timeRange: `${slot.startTime.slice(0, 5)} - ${slot.endTime.slice(0, 5)}`,
      status,
      canCheckin,
      canRetro,
      checkinStatus: checkin?.status
    } as SlotStatus;
  });
});

const simpleTodayStatus = computed(() => {
  if (!currentPlan.value) return 'pending';

  const plan = currentPlan.value;
  const selectedStr = toLocalDateOnlyString(selectedDate.value);
  const cellDate = parseDateOnly(selectedStr);
  const startDate = parseDateOnly(plan.startDate);
  const endDate = plan.endDate ? parseDateOnly(plan.endDate) : null;

  if (cellDate < startDate) return 'not_started';
  if (endDate && cellDate > endDate) return 'ended';

  // Fallback for plans without time slots
  const status = getStatusCode(selectedDate.value);
  if (status === 1) return 'checked';
  if (status === 2) return 'retro';

  // Also check if it's future
  const now = new Date();
  const todayStr = toLocalDateOnlyString(now);
  if (selectedStr > todayStr) return 'future';

  return 'pending';
});

function handleCheckinAction(slot?: SlotStatus) {
  if (simpleTodayStatus.value === 'not_started') {
    notifyWarning('计划尚未开始');
    return;
  }
  if (simpleTodayStatus.value === 'ended') {
    notifyWarning('计划已结束');
    return;
  }

  const dateStr = toLocalDateOnlyString(selectedDate.value);
  let url = `/pages/checkin/form?planId=${planId.value}&date=${dateStr}`;

  // Check if future
  const now = new Date();
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetOnly = new Date(selectedDate.value.getFullYear(), selectedDate.value.getMonth(), selectedDate.value.getDate());

  if (targetOnly > todayOnly) {
    notifyWarning('未来日期不可打卡');
    return;
  }

  if (slot) {
    // Time slot logic
    // If done, show detail? 
    if (slot.status === 'done') {
      uni.navigateTo({
        url: `/pages/checkin/detail?planId=${planId.value}&date=${dateStr}`
      });
      return;
    }

    if (slot.status === 'not_started' || slot.status === 'ended') {
      notifyWarning(slot.status === 'not_started' ? '计划尚未开始' : '计划已结束');
      return;
    }

    // If pending/missed, go to form with slotId
    url += `&slotId=${slot.id}`;

    uni.navigateTo({ url });
  } else {
    // Simple plan logic
    if (simpleTodayStatus.value === 'checked' || simpleTodayStatus.value === 'retro') {
      uni.navigateTo({
        url: `/pages/checkin/detail?planId=${planId.value}&date=${dateStr}`
      });
    } else {
      uni.navigateTo({
        url
      });
    }
  }
}

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
</script>

<template>
  <view class="container" :style="themeStore.themeStyle">
    <NotificationSystem />

    <!-- Card 1: Title Bar -->
    <view class="title-card">
      <view class="title-row">
        <text class="title">{{ currentPlan?.title }}</text>
        <text class="edit-icon" @click="handleEdit">✎</text>
      </view>
    </view>

    <!-- Card 2: Calendar Bar -->
    <view class="calendar-card">
      <view class="month-selector">
        <image class="arrow-icon is-left" src="/static/svg/turn-left.svg" mode="aspectFit" @click="prevMonth" />
        <text class="month-label">{{ currentYear }}年{{ currentMonth }}月</text>
        <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" @click="nextMonth" />
      </view>

      <view class="weekdays">
        <text v-for="w in weekdays" :key="w" class="weekday">{{ w }}</text>
      </view>

      <view class="mini-calendar">
        <view v-for="(cell, index) in calendarCells" :key="index" :class="getCellClass(cell)"
          @click="cell ? handleDateClick(cell) : null">
          <text v-if="cell" class="mini-day-text">{{ cell.getDate() }}</text>
        </view>
      </view>
    </view>

    <view class="checkin-action-area">
      <!-- Time Slot List -->
      <view v-if="slotStatuses.length > 0" class="slot-list">
        <view v-for="slot in slotStatuses" :key="slot.id" class="slot-row">
          <view class="slot-info">
            <text class="slot-name">{{ slot.name }}</text>
            <text class="slot-time">{{ slot.timeRange }}</text>
          </view>

          <view class="slot-action">
            <template v-if="slot.status === 'done'">
              <view class="status-tag" :class="slot.checkinStatus === 2 ? 'retro' : 'success'"
                @click="handleCheckinAction(slot)">
                {{ slot.checkinStatus === 2 ? '已补签' : '已打卡' }}
              </view>
            </template>
            <template v-else-if="slot.status === 'not_started'">
              <text class="status-text muted">计划未开始</text>
            </template>
            <template v-else-if="slot.status === 'ended'">
              <text class="status-text muted">计划已结束</text>
            </template>
            <template v-else-if="slot.status === 'future'">
              <text class="status-text">未开始</text>
            </template>
            <template v-else-if="slot.status === 'missed'">
              <button class="action-btn retro" @click="handleCheckinAction(slot)">补签</button>
            </template>
            <template v-else>
              <button class="action-btn primary" @click="handleCheckinAction(slot)">打卡</button>
            </template>
          </view>
        </view>
      </view>

      <!-- Fallback Single Button -->
      <button v-else class="checkin-btn" :class="simpleTodayStatus" @click="handleCheckinAction()">
        <text class="checkin-btn-text">
          {{
            simpleTodayStatus === 'checked' ? '已打卡' :
              (simpleTodayStatus === 'retro' ? '已补签' :
                (simpleTodayStatus === 'not_started' ? '计划未开始' :
                  (simpleTodayStatus === 'ended' ? '计划已结束' :
                    (simpleTodayStatus === 'future' ? '未到时间' : '今日打卡'))))
          }}
        </text>
      </button>
    </view>

    <view class="legend">
      <view class="legend-item">
        <view class="dot success"></view>
        <text>正常打卡</text>
      </view>
      <view class="legend-item">
        <view class="dot retro"></view>
        <text>补签</text>
      </view>
      <view class="legend-item">
        <view class="dot missed"></view>
        <text>错过</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
@use "@/styles/status-colors.scss";

.container {
  padding: var(--uni-container-padding);
  background-color: var(--bg-color);
  min-height: 100%;
  box-sizing: border-box;
}

/* Card 1: Title Card */
.title-card {
  margin-bottom: var(--uni-header-margin-bottom);
  padding: var(--uni-header-padding);
  background-color: var(--bg-elevated);
  border-radius: var(--uni-header-border-radius);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.title {
  font-size: 20px;
  font-weight: bold;
  color: var(--text-color);
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.edit-icon {
  font-size: 20px;
  color: var(--text-muted);
}

/* Card 2: Calendar Card */
.calendar-card {
  background-color: var(--bg-elevated);
  border-radius: var(--uni-card-border-radius);
  padding: 16px;

}

.month-selector {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--surface-soft);
  padding: 8px 16px;
  border-radius: 20px;
  margin-bottom: 16px;
}

.arrow-icon {
  width: 24px;
  height: 24px;
  padding: 8px;
  opacity: 0.6;
}

.arrow-icon.is-left {
  transform: rotate(180deg);
}

.month-label {
  font-size: 16px;
  font-weight: 600;
}

.weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 8px;
}

.weekday {
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}

/* Grid & Cells matching index.vue style */
.mini-calendar {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}

.mini-day {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background-color: transparent;
  border: 1px solid transparent;
}

.mini-day-text {
  font-size: 14px;
  /* Kept 14px for detail view readability, though index uses 12px */
  color: var(--text-color);
  font-weight: 500;
}

.mini-day-today {
  border: 1px solid var(--theme-primary) !important;
  font-weight: bold;
}

/* Legend & Action Area */
.legend {
  margin-top: 20px;
  display: flex;
  gap: 16px;
  justify-content: center;
}

/* Action Area */
.checkin-action-area {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}

.checkin-btn {
  width: 140px;
  height: 140px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
  transition: transform 0.2s;
  border: none;
}

.checkin-btn:active {
  transform: scale(0.95);
}

.checkin-btn.checked {
  background: linear-gradient(135deg, #10b981, #059669);
  box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3);
}

.checkin-btn.retro {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  box-shadow: 0 4px 12px rgba(217, 119, 6, 0.3);
}

.checkin-btn-text {
  font-size: 18px;
  font-weight: bold;
  color: white;
}

.slot-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.slot-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--bg-elevated);
  padding: 12px 16px;
  border-radius: var(--uni-card-border-radius);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.slot-info {
  display: flex;
  flex-direction: column;
}

.slot-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
}

.slot-time {
  font-size: 12px;
  color: var(--text-muted);
}

.slot-action {
  display: flex;
  align-items: center;
}

.status-tag {
  padding: 4px 8px;
  border-radius: var(--uni-card-border-radius);
  font-size: 12px;
  color: white;
}

.status-text {
  font-size: 14px;
  color: var(--text-muted);
}

.action-btn {
  font-size: 14px;
  padding: 4px 8px;
  line-height: normal;
  border-radius: var(--uni-card-border-radius);
  color: white;
  background-color: #3b82f6;
  border: none;
}

.action-btn.retro {
  background-color: #f59e0b;
}

.action-btn.primary {
  background-color: #3b82f6;
}

/* Removed duplicate checkin-action-area styles */


// 动画波动
@keyframes shake-pending {

  0%,
  100% {
    box-shadow: 0 0 12px 0px rgba(239, 68, 68, 0.25);
  }

  25% {
    box-shadow: 0 0 12px 10px rgba(239, 68, 68, 0.25);
  }

  50% {
    box-shadow: 0 0 12px 15px rgba(239, 68, 68, 0.25);
  }

  75% {
    box-shadow: 0 0 12px 10px rgba(239, 68, 68, 0.25);
  }
}

@keyframes shake-checked {

  0%,
  100% {
    box-shadow: 0 0 12px 0px var(--theme-primary);
  }

  25% {
    box-shadow: 0 0 12px 10px var(--theme-primary);
  }

  50% {
    box-shadow: 0 0 12px 15px var(--theme-primary);
  }

  75% {
    box-shadow: 0 0 12px 10px var(--theme-primary);
  }
}

@keyframes shake-retro {

  0%,
  100% {
    box-shadow: 0 0 12px 0px rgba(234, 179, 8, .25);
  }

  25% {
    box-shadow: 0 0 12px 10px rgba(234, 179, 8, .25);
  }

  50% {
    box-shadow: 0 0 12px 15px rgba(234, 179, 8, .25);
  }

  75% {
    box-shadow: 0 0 12px 10px rgba(234, 179, 8, .25);
  }
}


.checkin-btn::after {
  border: none;
}

.checkin-btn.pending {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white;
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.6);
}

.checkin-btn.checked {
  background: linear-gradient(135deg, var(--theme-primary), var(--theme-secondary));
  color: white;
}

.checkin-btn.retro {
  background: linear-gradient(135deg, #eab308, #ca8a04);
  color: white;
}

.checkin-btn.future {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}

.checkin-btn.not_started,
.checkin-btn.ended {
  background: linear-gradient(135deg, #9ca3af, #6b7280);
  box-shadow: 0 4px 12px rgba(107, 114, 128, 0.3);
}

.checkin-btn-text {
  font-size: 18px;
  font-weight: bold;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-text.muted {
  color: var(--text-muted);
  opacity: 0.8;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
</style>
