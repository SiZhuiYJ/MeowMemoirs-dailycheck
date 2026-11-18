<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import useClass from '@/features/Curriculum/useClass';
import type { Class } from '@/libs/api/class/type';
import MmNavBar from '@/components/MmNavBar.vue';
import { useThemeStore } from '@/stores/theme';
import { padNumber } from '@/utils/date';



const props = defineProps<{
  isActive: boolean;
}>();

const { classes, initializeData, getClass, isLoading } = useClass();
// 主题变量绑定到页面根节点，保证日/夜切换时课程页配色跟随
const themeStore = useThemeStore();

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
  <view class="class-tab-container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：左侧周次、右侧「今天」按钮（由 MmNavBar 的左右插槽承载） -->
    <MmNavBar :show-back="false" align="left">
      <template #left>
        <view class="week-display">
          <text class="value highlight">第{{ currentWeek }}/{{ totalWeeks }}周</text>
        </view>
      </template>
      <template #right>
        <view class="today-btn" hover-class="mm-hover" @click="jumpToToday">
          <image src="/static/svg/to.svg" class="arrow-icon" />
        </view>
      </template>
    </MmNavBar>

    <!-- 空态：白卡片 + 轻描边，避免整页空白 -->
    <view v-if="!isLoading && classes.length === 0" class="empty-state">
      <text class="empty-title">暂无课程</text>
      <text class="empty-desc">当前学期还没有课程安排</text>
    </view>

    <!-- 课程表 -->
    <view v-else class="class-table" :class="{ 'skeleton-container': isLoading }">
      <scroll-view scroll-x="true" class="table-scroll">
        <view class="class-grid">
          <view class="time-column">
            <view class="time-header">
              <text>{{ padNumber(getDateForDay(currentWeek, 0).month, 2) }}月</text>
            </view>
            <view class="time-slot" v-for="slot in displayedTimeSlots" :key="slot.number" hover-class="mm-hover"
              @click="openTimeTable">
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
                <!-- 课程卡统一走单一强调色，不再按接口返回色值多色混用 -->
                <view class="course-item" hover-class="mm-hover"
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
        <view v-if="!hasNightClasses" class="fold-toggle" hover-class="mm-hover" @click="toggleFold"
          :class="{ 'is-expanded': !isFolded }">
          <view class="fold-btn">
            <text>{{ isFolded ? '展开晚间课程' : '收起晚间课程' }}</text>
            <image src="/static/svg/arrow-right.svg" class="toggle-icon" />
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- 周数选择器：上方周次 chip + 下方翻页按钮，保证每个热区 ≥44px -->
    <view class="week-selector" :class="{ 'skeleton-selector': isLoading }">
      <view class="week-list">
        <view v-for="week in weekRange" :key="week" class="week-item" :class="{ active: week === currentWeek }"
          hover-class="mm-hover" @click="!isLoading && (currentWeek = week)">
          {{ week }}
        </view>
      </view>
      <view class="week-btn" hover-class="mm-hover" @click="jumpToFirstWeek"
        :class="{ disabled: currentWeek <= 1 || isLoading }">
        <image src="/static/svg/arrow-double-left.svg" class="arrow-icon" />
      </view>
      <view class="week-btn" hover-class="mm-hover" @click="changeWeek(-1)"
        :class="{ disabled: currentWeek <= 1 || isLoading }">
        <image src="/static/svg/arrow-left.svg" class="arrow-icon" />
      </view>
      <view class="week-btn" hover-class="mm-hover" @click="changeWeek(1)"
        :class="{ disabled: currentWeek >= totalWeeks || isLoading }">
        <image src="/static/svg/arrow-right.svg" class="arrow-icon" />
      </view>
      <view class="week-btn" hover-class="mm-hover" @click="jumpToLastWeek"
        :class="{ disabled: currentWeek >= totalWeeks || isLoading }">
        <image src="/static/svg/arrow-double-right.svg" class="arrow-icon" />
      </view>
    </view>

    <!-- 时间表弹窗 -->
    <view v-if="showTimeTable" class="detail-overlay" @click="closeTimeTable">
      <view class="detail-content time-table-content" @click.stop>
        <view class="detail-header">
          <text class="detail-title">作息时间表</text>
          <text class="detail-close" @click="closeTimeTable">✕</text>
        </view>

        <view class="detail-body time-table-body">
          <view class="time-table-list">
            <view class="time-table-item" v-for="slot in timeSlots" :key="slot.number" hover-class="mm-hover">
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
          <button class="detail-btn" hover-class="mm-hover" @click="closeTimeTable">关闭</button>
        </view>
      </view>
    </view>

    <!-- 课程详情弹窗 -->
    <view v-if="showDetail" class="detail-overlay" @click="closeDetail">
      <view class="detail-content" @click.stop>
        <!-- 弹窗头统一用主题渐变（不再按课程色渲染） -->
        <view class="detail-header">
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
          <button class="detail-btn" hover-class="mm-hover" @click="closeDetail">关闭</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* ============================================================
   课程页：单色风格（浅灰底 + 白卡片 + 单一强调色）
   —— 所有颜色来自 CSS 变量，统一使用主题色阶，不再按课程色多色渲染
   ============================================================ */

.class-tab-container {
  /* 底部安全区由 pages/main 的 .tab-page 统一预留，这里只留模块间距 */
  padding: var(--page-pad) var(--page-pad) 16px;
  box-sizing: border-box;
  background-color: var(--bg-color);
  min-height: 100vh;
}

// 顶栏内的周次与「今天」按钮（由 MmNavBar 的左右插槽承载，这里只保留控件样式）
.week-display {
  display: flex;
  align-items: center;
  gap: 12px;

  .value {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-color);

    &.highlight {
      background-color: var(--bg-elevated);
      padding: 2px 12px;
      border-radius: 999px;
      border: 1px solid var(--border-color);
    }
  }
}

.today-btn {
  width: 32px;
  height: 32px;
  background-color: var(--bg-elevated);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s ease, opacity 0.2s ease;
  border: 1px solid var(--border-color);

  &:active {
    background-color: var(--surface-soft);
    transform: scale(0.95);
  }

  .arrow-icon {
    width: 16px;
    height: 16px;
  }
}

// 空态
.empty-state {
  padding: 48px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);

  .empty-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-color);
  }

  .empty-desc {
    font-size: 12px;
    color: var(--text-faint);
  }
}

// 课程表
.class-table {
  background-color: var(--bg-elevated);
  border-radius: var(--card-radius);
  border: 1px solid var(--border-color);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}

.table-scroll {
  width: 100%;
}

.class-grid {
  display: grid;
  grid-template-columns: 44px repeat(7, minmax(0, 1fr));
  gap: 1px;
  background-color: var(--divider-color);

  .time-column,
  .day-column {
    background-color: var(--bg-elevated);
    display: grid;
    grid-template-rows: 45px;
    grid-auto-rows: 1fr;

    .time-header,
    .day-header {
      background-color: var(--surface-soft);
      color: var(--text-muted);
      padding: 6px 2px;
      text-align: center;
      font-weight: 600;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      position: relative;
      overflow: hidden;

      // 今天：浅强调色底 + 强调色文字，保持克制
      &.today-header {
        background-color: var(--theme-color-soft);
        color: var(--theme-color-strong);

        .today-badge {
          position: absolute;
          top: 2px;
          right: 4px;
          background-color: var(--theme-color-strong);
          color: var(--theme-action-contrast);
          font-size: 10px;
          padding: 1px 4px;
          border-radius: 999px;
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
      transition: background-color 0.2s ease;
      min-height: 64px;

      &:active {
        background-color: var(--surface-soft);

        .time-slot-number {
          color: var(--theme-color-strong);
        }
      }

      .time-slot-number {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-muted);
      }
    }

    .course-slot {
      min-height: 104px;
      padding: 2px;
      position: relative;

      .course-item {
        background-color: var(--theme-color-softer);
        border: 1px solid var(--theme-color-soft);
        border-left: 3px solid var(--theme-color-muted);
        border-radius: 8px;
        padding: 6px 4px;
        height: calc(100% - 4px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transition: transform 0.2s ease;

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
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  gap: 10px;

  .week-list {
    order: -1;
    flex: 0 0 100%;
    display: flex;
    gap: 6px;

    .week-item {
      flex: 1;
      min-width: 0;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--surface-soft);
      border: 1px solid transparent;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-color);
      transition: background-color 0.2s ease, color 0.2s ease;

      &.active {
        background-color: var(--theme-color-soft);
        border-color: var(--theme-color-muted);
        color: var(--theme-color-strong);
        font-weight: 600;
      }
    }
  }

  .week-btn {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--theme-color-soft);
    border: 1px solid var(--theme-color-muted);
    border-radius: 10px;
    transition: transform 0.2s ease, opacity 0.2s ease;

    &:active {
      transform: scale(0.94);
    }

    &.disabled {
      opacity: 0.35;
      pointer-events: none;
    }

    .arrow-icon {
      width: 20px;
      height: 20px;
    }
  }
}

/* ========== 加载骨架 ========== */
.skeleton-container {
  pointer-events: none;

  .skeleton-course-item {
    width: calc(100% - 8px);
    height: calc(100% - 8px);
    margin: 4px;
    background-color: var(--surface-soft);
    border-radius: 8px;
    position: relative;
    overflow: hidden;

    &::after {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, var(--border-color), transparent);
      animation: skeleton-loading 1.5s infinite;
    }
  }
}

.skeleton-selector {
  opacity: 0.6;
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

/* ========== 弹层通用 ========== */
.detail-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--mask-color);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.detail-content {
  width: 100%;
  max-width: 320px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--theme-outer-glow);
  animation: slideUp 0.25s ease-out;
}

/* 时间表弹窗特殊样式 */
.time-table-content {
  max-width: 300px;
}

.time-table-body {
  padding: 0;
}

.time-table-list {
  max-height: 320px;
  overflow-y: auto;
}

.time-table-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--divider-color);
  transition: background-color 0.2s ease;
}

.time-table-item:last-child {
  border-bottom: none;
}

.time-table-item:active {
  background-color: var(--surface-soft);
}

.time-table-number {
  display: flex;
  align-items: center;
  gap: 8px;
}

.number-badge {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  box-sizing: border-box;
}

.number-text {
  font-size: 14px;
  color: var(--text-color);
  font-weight: 500;
}

.time-table-time {
  text-align: right;
}

.time-text {
  font-size: 14px;
  color: var(--theme-color-strong);
  font-weight: 600;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(24px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.detail-header {
  padding: 20px 16px 16px;
  position: relative;
  background: var(--theme-gradient);
}

.detail-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--theme-action-contrast);
  display: block;
  margin-bottom: 4px;
}

.detail-close {
  position: absolute;
  top: 14px;
  right: 14px;
  font-size: 18px;
  color: var(--theme-action-contrast);
  opacity: 0.9;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: opacity 0.2s ease;
}

.detail-close:active {
  opacity: 0.6;
}

.detail-body {
  padding: 16px;
}

.detail-item {
  display: flex;
  align-items: flex-start;
  margin-bottom: 10px;
  padding: 12px;
  background-color: var(--surface-soft);
  border-radius: 10px;
  border-left: 3px solid var(--theme-color-muted);
}

.detail-item:last-child {
  margin-bottom: 0;
}

.detail-icon {
  font-size: 18px;
  margin-right: 10px;
  flex-shrink: 0;
  line-height: 1.4;
}

.detail-info {
  flex: 1;
  min-width: 0;
}

.detail-label {
  font-size: 12px;
  color: var(--text-muted);
  display: block;
  margin-bottom: 2px;
  font-weight: 500;
}

.detail-value {
  font-size: 14px;
  color: var(--text-color);
  display: block;
  line-height: 1.5;
  word-break: break-all;
}

.detail-footer {
  padding: 12px 16px 16px;
  display: flex;
  justify-content: center;
  border-top: 1px solid var(--divider-color);
}

.detail-btn {
  width: 100%;
  height: var(--control-h);
  text-align: center;
  background: var(--theme-gradient);
  color: var(--theme-action-contrast);
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.detail-btn::after {
  border: none;
}

/* 折叠控制样式 */
.fold-toggle {
  padding: 14px 0;
  background-color: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-top: 1px solid var(--divider-color);
}

.fold-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--theme-color-strong);
  font-size: 12px;
  font-weight: 500;
}

.toggle-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.25s ease;
  transform: rotate(90deg);
  /* 默认向下 */
}

.is-expanded .toggle-icon {
  transform: rotate(-90deg);
  /* 展开时向上 */
}
</style>
