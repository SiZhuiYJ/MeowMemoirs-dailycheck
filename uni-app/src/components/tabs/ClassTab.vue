<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import useClass from '@/features/Curriculum/useClass';
import type { Class } from '@/libs/api/class/type';
import { useNavbar } from '@/utils/useNavbar';
import { padNumber } from '@/utils/date';



const props = defineProps<{
  isActive: boolean;
}>();

const { classes, initializeData, getClass, isLoading } = useClass();
const { paddingTop, height, paddingLeft, navbarHeight } = useNavbar();

watch(() => props.isActive, (newVal) => {
  if (newVal) {
    initializeData();
    // 每次激活时定位到当前周
    currentWeek.value = currentAcademicWeek.value;
  }
}, { immediate: true });

// 周次
const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const currentWeek = ref(1); // 初始值，在 script 末尾或 initializeData 后更新
const totalWeeks = ref(20); // 总周数

// 开学日期（本学期第一周的周一）
// 实际项目中，此日期应从后端 API 获取或在全局配置中定义
const semesterStartDate = ref(new Date('2026-03-10'));

// 计算当前逻辑上的“第几周”
const currentAcademicWeek = computed(() => {
  const now = new Date();
  // 重置时间为 00:00:00 避免小时差异
  const start = new Date(semesterStartDate.value);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const diffTime = today.getTime() - start.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  // 计算周数：(天数差 / 7) + 1
  const weekNum = Math.floor(diffDays / 7) + 1;
  return Math.max(1, Math.min(totalWeeks.value, weekNum));
});

// 节次时间
const timeSlots = [
  { number: 1, time: '08:25-09:10' },
  { number: 2, time: '09:15-10:00' },
  { number: 3, time: '10:10-10:55' },
  { number: 4, time: '11:00-11:45' },
  { number: 5, time: '14:00-14:45' },
  { number: 6, time: '14:50-15:35' },
  { number: 7, time: '15:45-16:30' },
  { number: 8, time: '16:35-17:20' },
  { number: 9, time: '18:30-19:15' },
  { number: 10, time: '19:20-20:05' },
  { number: 11, time: '20:10-20:55' },
  { number: 12, time: '21:00-21:45' },
];

// 是否折叠晚间课程（9节及以后）
const isFolded = ref(true);

// 检查当前周是否有晚间课程（第9节及以后）
const hasNightClasses = computed(() => {
  for (let day = 1; day <= 7; day++) {
    for (let slot = 9; slot <= 12; slot++) {
      if (getClass(currentWeek.value, day, slot)) {
        return true;
      }
    }
  }
  return false;
});

// 实际显示的节次
const displayedTimeSlots = computed(() => {
  // 如果当前周有晚间课程，或者用户主动取消折叠，则显示全部
  if (hasNightClasses.value || !isFolded.value) {
    return timeSlots;
  }
  // 否则只显示前8节
  return timeSlots.slice(0, 8);
});

// 切换折叠状态
function toggleFold() {
  isFolded.value = !isFolded.value;
}

// 详情弹窗
const showDetail = ref(false);
const selectedClass = ref<Class | null>(null);

// 时间表弹窗
const showTimeTable = ref(false);

// 计算当前日期信息
const today = computed(() => {
  const now = new Date();
  return {
    month: now.getMonth() + 1,
    day: now.getDate(),
    dayOfWeek: now.getDay() || 7 // 周日为 7
  };
});

// 判断是否是今天
function isToday(dayIndex: number): boolean {
  // 必须满足：1. 当前显示的周是“本周” 2. 星期匹配
  return currentWeek.value === currentAcademicWeek.value && today.value.dayOfWeek === dayIndex + 1;
}

// 获取指定周数和星期的日期
function getDateForDay(week: number, dayIndex: number): { month: number; day: number } {
  // 基于开学日期计算
  const targetDate = new Date(semesterStartDate.value);
  // 计算偏移天数：(周数-1) * 7 + 星期偏移(0-6)
  const offsetDays = (week - 1) * 7 + dayIndex;
  targetDate.setDate(semesterStartDate.value.getDate() + offsetDays);

  return {
    month: targetDate.getMonth() + 1,
    day: targetDate.getDate()
  };
}

// 切换周数
function changeWeek(delta: number) {
  const newWeek = currentWeek.value + delta;
  if (newWeek >= 1 && newWeek <= totalWeeks.value) {
    currentWeek.value = newWeek;
  }
}

// 跳转到首周
function jumpToFirstWeek() {
  currentWeek.value = 1;
}

// 跳转到末尾周
function jumpToLastWeek() {
  currentWeek.value = totalWeeks.value;
}

// 获取周次范围
const weekRange = computed(() => {
  const startWeek = Math.max(1, currentWeek.value - 2);
  const endWeek = Math.min(totalWeeks.value, currentWeek.value + 2);
  return Array.from({ length: endWeek - startWeek + 1 }, (_, i) => startWeek + i);
});

// 获取课程详细信息
function showClassDetail(week: number, dayIndex: number, slotIndex: number) {
  const course = getClass(week, dayIndex + 1, slotIndex + 1);
  if (course) {
    selectedClass.value = course;
    showDetail.value = true;
  }
}

// 关闭详情
function closeDetail() {
  showDetail.value = false;
  selectedClass.value = null;
}

// 获取节次时间文本
function getTimeSlotText(slotIndex: number): string {
  return timeSlots[slotIndex]?.time || '';
}

// 打开时间表弹窗
function openTimeTable() {
  showTimeTable.value = true;
}

// 关闭时间表弹窗
function closeTimeTable() {
  showTimeTable.value = false;
}

// 定位到今天所在的周
function jumpToToday() {
  currentWeek.value = currentAcademicWeek.value;
}
</script>

<template>
  <view class="class-tab-container">
    <!-- 顶部标题栏（集成背景色和安全区域适配） -->
    <view class="tab-header-fixed"
      :style="{ paddingTop: paddingTop + 'px', paddingLeft: paddingLeft + 'px', paddingRight: paddingLeft + 'px' }">
      <view class="header-info-inner" :style="{ height: height + 'px' }">
        <view class="week-display">
          <text class="value highlight">第{{ currentWeek }}/{{ totalWeeks }}周</text>
          <view class="today-btn" @click="jumpToToday" :style="{ width: height + 'px', height: height + 'px' }">
            <image src="/static/svg/to.svg" class="arrow-icon" />
          </view>
        </view>
      </view>
    </view>

    <!-- 撑开固定头部的内容区域 -->
    <view :style="{ height: `calc(${navbarHeight}px - var(--uni-container-padding))` }"></view>

    <!-- 课程表 -->
    <view class="class-table" :class="{ 'skeleton-container': isLoading }">
      <scroll-view scroll-x="true" class="table-scroll">
        <view class="class-grid">
          <view class="time-column">
            <view class="time-header">
              <text>{{ padNumber(getDateForDay(currentWeek, 0).month, 2) }}月</text>
            </view>
            <view class="time-slot" v-for="slot in displayedTimeSlots" :key="slot.number" @click="openTimeTable">
              <text class="time-slot-number">{{ slot.number }}</text>
            </view>
          </view>

          <!-- 周次循环 -->
          <view class="day-column" v-for="(day, dayIndex) in weekDays" :key="dayIndex">
            <view class="day-header" :class="{ 'today-header': isToday(dayIndex) }">
              <text>
                {{ padNumber(getDateForDay(currentWeek, dayIndex).month, 2) }}/{{ padNumber(getDateForDay(currentWeek,
                  dayIndex).day, 2) }}
              </text>
              <text>{{ day }}</text>
              <text v-if="isToday(dayIndex)" class="today-badge">今</text>
            </view>
            <view v-for="(_, slotIndex) in displayedTimeSlots" :key="slotIndex" class="course-slot">
              <template v-if="isLoading">
                <view class="skeleton-course-item" v-if="(dayIndex + slotIndex) % 3 === 0"></view>
              </template>
              <template v-else-if="getClass(currentWeek, dayIndex + 1, slotIndex + 1)">
                <view class="course-item"
                  :style="{ '--text-color': getClass(currentWeek, dayIndex + 1, slotIndex + 1)!.color, '--text-muted': getClass(currentWeek, dayIndex + 1, slotIndex + 1)!.color, backgroundColor: getClass(currentWeek, dayIndex + 1, slotIndex + 1)!.color + '15' }"
                  @click="showClassDetail(currentWeek, dayIndex, slotIndex)">
                  <text class="course-name">{{ getClass(currentWeek, dayIndex + 1, slotIndex + 1)?.name }}</text>
                  <text class="course-details">{{ getClass(currentWeek, dayIndex + 1,
                    slotIndex + 1)?.location }} {{ getClass(currentWeek, dayIndex + 1, slotIndex + 1)?.teacher }}</text>
                </view>
              </template>
              <template v-else>
                <view class="empty-slot"></view>
              </template>
            </view>
          </view>
        </view>

        <!-- 展开/折叠控制（仅在没有晚间课程时显示） -->
        <view v-if="!hasNightClasses" class="fold-toggle" @click="toggleFold" :class="{ 'is-expanded': !isFolded }">
          <view class="fold-btn">
            <text>{{ isFolded ? '展开晚间课程' : '收起晚间课程' }}</text>
            <image src="/static/svg/arrow-right.svg" class="toggle-icon" />
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- 周数选择器 -->
    <view class="week-selector" :class="{ 'skeleton-selector': isLoading }">
      <view class="week-btn" @click="jumpToFirstWeek" :class="{ disabled: currentWeek <= 1 || isLoading }">
        <image src="/static/svg/arrow-double-left.svg" class="arrow-icon" />
      </view>
      <view class="week-btn" @click="changeWeek(-1)" :class="{ disabled: currentWeek <= 1 || isLoading }">
        <image src="/static/svg/arrow-left.svg" class="arrow-icon" />
      </view>
      <view class="week-list">
        <view v-for="week in weekRange" :key="week" class="week-item" :class="{ active: week === currentWeek }"
          @click="!isLoading && (currentWeek = week)">
          {{ week }}
        </view>
      </view>
      <view class="week-btn" @click="changeWeek(1)" :class="{ disabled: currentWeek >= totalWeeks || isLoading }">
        <image src="/static/svg/arrow-right.svg" class="arrow-icon" />
      </view>
      <view class="week-btn" @click="jumpToLastWeek" :class="{ disabled: currentWeek >= totalWeeks || isLoading }">
        <image src="/static/svg/arrow-double-right.svg" class="arrow-icon" />
      </view>
    </view>

    <!-- 时间表弹窗 -->
    <view v-if="showTimeTable" class="detail-overlay" @click="closeTimeTable">
      <view class="detail-content time-table-content" @click.stop>
        <view class="detail-header"
          :style="{ background: `linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%)` }">
          <text class="detail-title">作息时间表</text>
          <text class="detail-close" @click="closeTimeTable">✕</text>
        </view>

        <view class="detail-body time-table-body">
          <view class="time-table-list">
            <view class="time-table-item" v-for="slot in timeSlots" :key="slot.number">
              <view class="time-table-number">
                <text class="number-badge">{{ slot.number }}</text>
                <text class="number-text">第{{ slot.number }}节</text>
              </view>
              <view class="time-table-time">
                <text class="time-text">{{ slot.time }}</text>
              </view>
            </view>
          </view>
        </view>

        <view class="detail-footer">
          <button class="detail-btn" @click="closeTimeTable">关闭</button>
        </view>
      </view>
    </view>

    <!-- 课程详情弹窗 -->
    <view v-if="showDetail" class="detail-overlay" @click="closeDetail">
      <view class="detail-content" @click.stop>
        <view class="detail-header"
          :style="{ background: selectedClass?.color ? `linear-gradient(135deg, ${selectedClass.color} 0%, ${selectedClass.color} 100%)` : `linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%)` }">
          <text class="detail-title">{{ selectedClass?.name }}</text>
          <text class="detail-close" @click="closeDetail">✕</text>
        </view>

        <view class="detail-body">
          <view class="detail-item">
            <view class="detail-icon">📍</view>
            <view class="detail-info">
              <text class="detail-label">上课地点</text>
              <text class="detail-value">{{ selectedClass?.location }}</text>
            </view>
          </view>

          <view class="detail-item">
            <view class="detail-icon">👨‍🏫</view>
            <view class="detail-info">
              <text class="detail-label">授课教师</text>
              <text class="detail-value">{{ selectedClass?.teacher }}</text>
            </view>
          </view>

          <view class="detail-item">
            <view class="detail-icon">📅</view>
            <view class="detail-info">
              <text class="detail-label">上课时间</text>
              <text class="detail-value">
                {{ weekDays[(selectedClass?.dayOfWeek || 1) - 1] }}
                第{{ selectedClass?.number.join('、') }}节
              </text>
            </view>
          </view>

          <view class="detail-item">
            <view class="detail-icon">🕐</view>
            <view class="detail-info">
              <text class="detail-label">具体时间</text>
              <text class="detail-value">
                {{ getTimeSlotText((selectedClass?.number[0] || 1) - 1) }}
              </text>
            </view>
          </view>

          <view class="detail-item">
            <view class="detail-icon">📆</view>
            <view class="detail-info">
              <text class="detail-label">上课周次</text>
              <text class="detail-value">
                第{{ selectedClass?.week.join('、') }}周
              </text>
            </view>
          </view>

          <view v-if="selectedClass?.remark" class="detail-item">
            <view class="detail-icon">📝</view>
            <view class="detail-info">
              <text class="detail-label">备注信息</text>
              <text class="detail-value">{{ selectedClass?.remark }}</text>
            </view>
          </view>
        </view>

        <view class="detail-footer">
          <button class="detail-btn" @click="closeDetail">关闭</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.class-tab-container {
  padding: var(--uni-container-padding);
  box-sizing: border-box;
  background-color: var(--bg-color);
  min-height: 100vh;
}

.header {
  margin-bottom: 20px;
}

.title {
  font-size: 24px;
  font-weight: 800;
  color: var(--text-color);
}

// 头部信息
.tab-header-fixed {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background-color: rgba(var(--bg-color), 0.01);
}

.header-info-inner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--text-color);

  .today-btn {
    background-color: var(--bg-elevated);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    border: 1px solid var(--border-color);

    &:active {
      background-color: var(--bg-soft);
      transform: scale(0.95);
    }

    .arrow-icon {
      width: 60%;
      height: 60%;
    }
  }

  .date-display,
  .week-display {
    display: flex;
    align-items: center;
    gap: 12px;

    .label {
      font-size: 14px;
      color: var(--text-muted);
    }

    .value {
      font-size: 16px;
      font-weight: 600;

      &.primary {
        color: var(--theme-primary);
      }

      &.highlight {
        background-color: var(--bg-elevated);
        padding: 2px 12px;
        border-radius: 20px;
        border: 1px solid var(--border-color);
      }
    }
  }
}

// 课程表
.class-table {
  background-color: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

.table-scroll {
  width: 100%;
}

.class-grid {
  display: grid;
  grid-template-columns: 40px repeat(7, minmax(0, 1fr));
  gap: 1px;
  background-color: #eef2f7;

  .time-column,
  .day-column {
    background-color: #fff;
    display: grid;
    grid-template-rows: 45px;
    grid-auto-rows: 1fr;

    .time-header,
    .day-header {
      background: var(--theme-secondary);
      color: #fff;
      padding: 8px 2px;
      text-align: center;
      font-weight: 600;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      position: relative;
      overflow: hidden;

      &.today-header {
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);

        .today-badge {
          position: absolute;
          top: 2px;
          right: 4px;
          background-color: #fff;
          color: #f5576c;
          font-size: 10px;
          padding: 1px 4px;
          border-radius: 8px;
          font-weight: 600;
        }
      }
    }

    .time-slot {
      background-color: var(--bg-elevated);
      padding: 4px 2px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
      min-height: 60px;

      &:active {
        background: linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%);
        transform: scale(0.95);

        .time-slot-number {
          color: #fff;
          -webkit-text-fill-color: #fff;
        }
      }

      .time-slot-number {
        font-size: 16px;
        font-weight: 600;
        color: var(--theme-primary);
        background: linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
    }

    .course-slot {
      min-height: 100px;
      padding: 1px;
      position: relative;

      .course-item {
        border-radius: 4px;
        padding: 6px 4px;
        height: calc(100% - 2px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        transition: all 0.3s;

        &:active {
          transform: scale(0.98);
        }

        .course-name {
          font-weight: 600;
          color: var(--text-color);
          font-size: 12px;
          margin-bottom: 4px;
          line-height: 1.3;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          word-break: break-all;
        }

        .course-details {
          font-size: 10px;
          color: var(--text-muted);
          margin-top: 2px;
          line-height: 1.2;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 4;
          overflow: hidden;
        }
      }

      .empty-slot {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
      }
    }
  }
}

// 周数选择器
.week-selector {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  margin-bottom: 80px;
  padding: 15px 10px;
  background-color: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  gap: 8px;

  .week-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--bg-elevated);
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.3s;

    &:active {
      transform: scale(0.9);
    }

    &.disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .arrow-icon {
      width: 20px;
      height: 20px;
    }

    .arrow {
      font-size: 24px;
      color: var(--theme-primary);
      font-weight: bold;
    }

    .arrow-double {
      font-size: 20px;
      color: var(--theme-primary);
      font-weight: bold;
    }
  }

  .week-list {
    display: flex;
    gap: 8px;
    flex: 1;
    justify-content: center;

    .week-item {
      min-width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--bg-elevated);
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-color);
      cursor: pointer;
      transition: all 0.3s;

      &:active {
        transform: scale(0.95);
      }

      &.active {
        background: linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%);
        color: #fff;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }
    }
  }
}

/* ========== 课程详情弹窗 ========== */
.skeleton-container {
  pointer-events: none;

  .skeleton-course-item {
    width: calc(100% - 8px);
    height: calc(100% - 8px);
    margin: 4px;
    background: #f0f0f0;
    border-radius: 4px;
    position: relative;
    overflow: hidden;

    &::after {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
      animation: skeleton-loading 1.5s infinite;
    }
  }
}

.skeleton-selector {
  opacity: 0.7;
  pointer-events: none;
}

@keyframes skeleton-loading {
  0% {
    transform: translateX(-100%);
  }

  100% {
    transform: translateX(100%);
  }
}

.detail-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40rpx;
}

.detail-content {
  width: 100%;
  max-width: 600rpx;
  background-color: #fff;
  border-radius: 20rpx;
  overflow: hidden;
  box-shadow: 0 10rpx 40rpx rgba(0, 0, 0, 0.3);
  animation: slideUp 0.3s ease-out;
}

/* 时间表弹窗特殊样式 */
.time-table-content {
  max-width: 500rpx;
}

.time-table-body {
  padding: 0;
}

.time-table-list {
  max-height: 600rpx;
  overflow-y: auto;
}

.time-table-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 25rpx 30rpx;
  border-bottom: 1rpx solid #f0f0f0;
  transition: all 0.2s;
}

.time-table-item:last-child {
  border-bottom: none;
}

.time-table-item:active {
  background-color: #f8f9fa;
}

.time-table-number {
  display: flex;
  align-items: center;
  gap: 15rpx;
}

.number-badge {
  width: 50rpx;
  height: 50rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: bold;
  box-shadow: 0 4rpx 8rpx rgba(0, 0, 0, 0.2);
}

.number-text {
  font-size: 30rpx;
  color: var(--text-color);
  font-weight: 500;
}

.time-table-time {
  text-align: right;
}

.time-text {
  font-size: 32rpx;
  color: var(--theme-primary);
  font-weight: 600;
  background: linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(100rpx);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.detail-header {
  padding: 40rpx 30rpx 30rpx;
  position: relative;
  background: linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%);
}

.detail-title {
  font-size: 40rpx;
  font-weight: bold;
  color: #fff;
  display: block;
  margin-bottom: 8rpx;
}

.detail-close {
  position: absolute;
  top: 30rpx;
  right: 30rpx;
  font-size: 44rpx;
  color: rgba(255, 255, 255, 0.9);
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.2s;
}

.detail-close:active {
  background-color: rgba(255, 255, 255, 0.2);
  transform: scale(0.9);
}

.detail-body {
  padding: 30rpx;
}

.detail-item {
  display: flex;
  align-items: flex-start;
  margin-bottom: 30rpx;
  padding: 25rpx;
  background: linear-gradient(135deg, var(--bg-soft) 0%, var(--bg-elevated) 100%);
  border-radius: 16rpx;
  border-left: 6rpx solid var(--theme-primary);
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
  transition: all 0.2s;
}

.detail-item:active {
  transform: scale(0.98);
  box-shadow: 0 1rpx 4rpx rgba(0, 0, 0, 0.1);
}

.detail-icon {
  font-size: 40rpx;
  margin-right: 20rpx;
  flex-shrink: 0;
  line-height: 1;
}

.detail-info {
  flex: 1;
  min-width: 0;
}

.detail-label {
  font-size: 26rpx;
  color: var(--text-muted);
  display: block;
  margin-bottom: 10rpx;
  font-weight: 500;
}

.detail-value {
  font-size: 30rpx;
  color: var(--text-color);
  display: block;
  line-height: 1.5;
  word-break: break-all;
}

.detail-footer {
  padding: 20rpx 30rpx 30rpx;
  display: flex;
  justify-content: center;
  border-top: 1rpx solid var(--border-color);
}

.detail-btn {
  width: 100%;
  height: 88rpx;
  line-height: 88rpx;
  text-align: center;
  background: linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%);
  color: #fff;
  border: none;
  border-radius: 16rpx;
  font-size: 32rpx;
  font-weight: bold;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.2);
  transition: all 0.2s;
}

.detail-btn:active {
  transform: scale(0.96);
  box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.1);
}

/* 折叠控制样式 */
.fold-toggle {
  padding: 20rpx 0;
  background-color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-top: 1rpx solid #f0f0f0;
}

.fold-btn {
  display: flex;
  align-items: center;
  gap: 10rpx;
  color: var(--theme-primary);
  font-size: 24rpx;
  font-weight: 500;
  transition: all 0.2s;

  &:active {
    opacity: 0.7;
    transform: scale(0.95);
  }
}

.toggle-icon {
  width: 24rpx;
  height: 24rpx;
  transition: transform 0.3s ease;
  transform: rotate(90deg);
  /* 默认向下 */
}

.is-expanded .toggle-icon {
  transform: rotate(-90deg);
  /* 展开时向上 */
}
</style>
