<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { usePlansStore } from '@/stores/plans';
import { useCheckinsStore, type CheckinDetail } from '@/stores/checkins';
import { useThemeStore } from '@/stores/theme';
import { notifyWarning } from '@/utils/notification';
import { toLocalDateOnlyString, parseDateOnly, getMonthDays } from '@/utils/date';
import MmNavBar from '@/components/MmNavBar.vue';

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
    <MmNavBar title="计划详情" />
    <NotificationSystem />

    <!-- Card 1: Title Bar -->
    <view class="title-card">
      <view class="title-row">
        <text class="title">{{ currentPlan?.title }}</text>
        <view class="edit-icon" hover-class="mm-hover" @click="handleEdit">✎</view>
      </view>
    </view>

    <!-- Card 2: Calendar Bar -->
    <view class="calendar-card">
      <view class="month-selector">
        <view class="arrow-btn" hover-class="mm-hover" @click="prevMonth">
          <image class="arrow-icon is-left" src="/static/svg/turn-left.svg" mode="aspectFit" />
        </view>
        <text class="month-label">{{ currentYear }}年{{ currentMonth }}月</text>
        <view class="arrow-btn" hover-class="mm-hover" @click="nextMonth">
          <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
        </view>
      </view>

      <view class="weekdays">
        <text v-for="w in weekdays" :key="w" class="weekday">{{ w }}</text>
      </view>

      <view class="mini-calendar">
        <view v-for="(cell, index) in calendarCells" :key="index" :class="getCellClass(cell)"
          hover-class="mm-hover" @click="cell ? handleDateClick(cell) : null">
          <text v-if="cell" class="mini-day-text">{{ cell.getDate() }}</text>
        </view>
      </view>
    </view>

    <!-- 无分时段计划时，打卡按钮固定在底部操作栏；有分时段则跟随页面滚动 -->
    <view class="checkin-action-area" :class="{ 'is-fixed': slotStatuses.length === 0 }">
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
                hover-class="mm-hover" @click="handleCheckinAction(slot)">
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

    <!-- 为底部固定操作栏留出滚动空间（含手势条安全区） -->
    <view v-if="slotStatuses.length === 0" class="checkin-fixed-spacer"></view>
  </view>
</template>

<style scoped lang="scss">
@use "@/styles/status-colors.scss";

/* 计划详情：单色卡片 + 语义状态色（成功 / 补签 / 漏签）+ 底部固定打卡操作栏 */
.container {
  min-height: 100vh;
  padding: var(--page-pad) var(--page-pad) calc(12px + var(--safe-bottom));
  background-color: var(--bg-color);
  box-sizing: border-box;
}

/* Card 1: 计划标题卡 */
.title-card {
  margin-bottom: 12px;
  padding: 12px 16px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  box-sizing: border-box;
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color);
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

/* 编辑入口：44px 点击区 + 主题浅底 */
.edit-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background-color: var(--theme-color-soft);
  color: var(--theme-color-strong);
  font-size: 18px;
}

/* Card 2: 日历卡 */
.calendar-card {
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 16px;
  margin-bottom: 12px;
  box-sizing: border-box;
}

.month-selector {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
  padding: 4px 8px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  border-radius: 999px;
}

.arrow-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
}

.arrow-icon {
  width: 20px;
  height: 20px;
  opacity: 0.7;
}

.arrow-icon.is-left {
  transform: rotate(180deg);
}

.month-label {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
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

/* 日历网格：状态色由 status-colors.scss 提供（success / warning / danger） */
.mini-calendar {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.mini-day {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid transparent;
  background-color: transparent;
}

.mini-day-text {
  font-size: 13px;
  color: var(--text-color);
  font-weight: 500;
}

.mini-day-today {
  border: 1px solid var(--theme-primary) !important;
  font-weight: 600;
}

/* 图例：颜色沿用 status-colors.scss 的语义色 */
.legend {
  margin-top: 16px;
  display: flex;
  gap: 16px;
  justify-content: center;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

/* 打卡操作区：有分时段时跟随滚动；无分时段时固定在底部并预留安全区 */
.checkin-action-area {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}

.checkin-action-area.is-fixed {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  margin-top: 0;
  padding: 12px var(--page-pad) calc(12px + var(--safe-bottom));
  background-color: var(--bg-elevated);
  border-top: 1px solid var(--border-color);
  box-shadow: var(--theme-outer-glow-lighter);
  box-sizing: border-box;
}

/* 固定操作栏占位，避免遮挡页面最后一段内容（12+140+12 按钮 + 安全区） */
.checkin-fixed-spacer {
  height: calc(164px + var(--safe-bottom));
}

/* 无分时段计划的主打卡按钮 */
.checkin-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  border: none;
  background: var(--theme-gradient);
  box-shadow: var(--theme-outer-glow-soft);
  color: var(--theme-action-contrast);
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.checkin-btn:active {
  transform: scale(0.96);
  opacity: 0.9;
}

.checkin-btn-text {
  font-size: 18px;
  font-weight: 600;
}

/* 已打卡 / 已补签 / 未到时间 / 不可打卡：单色卡片 + 语义状态色 */
.checkin-btn.checked {
  background: var(--color-success-soft);
  border: 2px solid var(--color-success);
  color: var(--color-success-text);
  box-shadow: none;
}

.checkin-btn.retro {
  background: var(--color-warning-soft);
  border: 2px solid var(--color-warning);
  color: var(--color-warning-text);
  box-shadow: none;
}

.checkin-btn.future {
  background: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
  box-shadow: none;
}

.checkin-btn.not_started,
.checkin-btn.ended {
  background: var(--surface-soft);
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  box-shadow: none;
}

/* 分时段打卡列表 */
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
  gap: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 12px 16px;
  box-sizing: border-box;
}

.slot-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.slot-name {
  font-size: 15px;
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
  flex-shrink: 0;
}

/* 状态标签：底色 / 文字由 status-colors.scss 语义色决定，这里只统一胶囊形状 */
.status-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}

.status-text {
  font-size: 13px;
  color: var(--text-muted);
}

.status-text.muted {
  color: var(--text-faint);
}

/* 行内操作按钮：打卡用主题渐变，补签用 warning 语义色 */
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 80px;
  height: 44px;
  padding: 0 16px;
  border: none;
  border-radius: 10px;
  background: var(--theme-gradient);
  color: var(--theme-action-contrast);
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
}

.action-btn.retro {
  background: var(--color-warning-soft);
  border: 1px solid var(--color-warning);
  color: var(--color-warning-text);
}


</style>
