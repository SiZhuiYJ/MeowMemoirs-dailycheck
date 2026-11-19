<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import MmNavBar from '@/components/MmNavBar.vue';
import { useThemeStore } from '@/stores/theme';
import useSchedule, { type ScheduleBlock } from '@/features/Curriculum/useSchedule';

/**
 * 课程 tab（只读课表）
 *
 * 重构要点：
 * 1. 数据换成后端新课表模型：`useSchedule` 负责拉列表/详情、算当前周、把
 *    Course.times 按「当前周 + 星期」映射成可跨行渲染的课程块；
 * 2. 顶部沿用 MmNavBar：左侧课表名（多课表时可 picker 切换）+ 周次胶囊，
 *    右侧「今天」按钮；
 * 3. 周次切换条：上一周 / 第 N 周（本周高亮）/ 下一周；
 * 4. 网格：左侧节次/时间列固定，右侧 7 天用 scroll-view 横向滚动；课程块按
 *    sectionList 跨行、用数据 color 做浅底 + 左侧条；
 * 5. 只读：没有任何添加/编辑/删除入口；进入 tab 时自动刷新（isActive watch + onMounted）。
 */
const props = defineProps<{
  isActive: boolean;
}>();

// 主题变量绑定到页面根节点，保证日/夜切换时课程页配色跟随
const themeStore = useThemeStore();

const {
  // 数据
  schedules,
  currentSchedule,
  currentScheduleName,
  scheduleNames,
  currentScheduleIndex,
  courses,
  // 周次
  currentWeek,
  todayWeek,
  weekCount,
  isCurrentWeek,
  weekDays,
  weekDateRangeText,
  sectionRows,
  // 课程块
  courseBlocks,
  getDayBlocks,
  weekdayLabel,
  // 状态
  isLoading,
  isRefreshing,
  hasLoaded,
  error,
  // 方法
  refresh,
  switchSchedule,
  prevWeek,
  nextWeek,
  goToday,
} = useSchedule();

/** 网格布局常量：与 <style> 里的行高 / 表头高度 / 天列宽保持一致 */
const ROW_HEIGHT = 62;
const HEADER_HEIGHT = 42;
const DAY_COLUMN_WIDTH = 78;
const DAY_COUNT = 7;

/** 网格内容高度（表头 + N 节） */
const bodyHeight = computed(() => sectionRows.value.length * ROW_HEIGHT);
const gridHeight = computed(() => HEADER_HEIGHT + bodyHeight.value);
const dayGridWidth = computed(() => DAY_COLUMN_WIDTH * DAY_COUNT);

/** 首屏骨架：只有「第一次加载」才闪骨架，之后进入 tab 都是静默刷新 */
const showSkeleton = computed(() => isLoading.value && !hasLoaded.value);

/** 当前周没有课程时顶部展示提示条 */
const hasNoCourseThisWeek = computed(() => courseBlocks.value.length === 0);
const noCourseDesc = computed(() =>
  courses.value.length === 0 ? '这份课表还没有课程' : '可以切换到其他周次看看',
);

// 进入 tab 刷新：watch isActive + onMounted 双保险；
// refresh 内部有并发保护（isLoading/isRefreshing），两个入口不会重复请求。
watch(
  () => props.isActive,
  (active) => {
    if (active) void refresh();
  },
  { immediate: true },
);
onMounted(() => {
  void refresh();
});

/** 课程详情弹层 */
const activeCourse = ref<ScheduleBlock | null>(null);

function openCourseDetail(block: ScheduleBlock) {
  activeCourse.value = block;
}

function closeCourseDetail() {
  activeCourse.value = null;
}

/** 多课表切换：picker change 事件里拿下标再切 */
function onScheduleChange(event: any) {
  const index = Number(event?.detail?.value);
  const target = schedules.value[index];
  if (target) void switchSchedule(target.id);
}

/** 课程块绝对定位：按 sectionStart / sectionSpan 跨行 */
function courseBlockStyle(block: ScheduleBlock) {
  return {
    top: `${(block.sectionStart - 1) * ROW_HEIGHT + 2}px`,
    height: `${block.sectionSpan * ROW_HEIGHT - 4}px`,
    backgroundColor: block.tint || 'var(--theme-color-soft)',
    borderLeftColor: block.color || 'var(--theme-primary)',
  };
}

/** 详情弹层的时间文案：周一 第1-2节 · 08:00-09:40 */
function courseTimeText(block: ScheduleBlock): string {
  const weekday = weekdayLabel(block.dayOfWeek);
  return `${weekday} ${block.sectionText}${block.timeText ? ` · ${block.timeText}` : ''}`;
}
</script>

<template>
  <view class="class-tab-container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：左侧课表名/周次，右侧「今天」；MmNavBar 自带等高占位 -->
    <MmNavBar :show-back="false" align="left">
      <template #left>
        <view class="schedule-head">
          <!-- 多课表时才出现切换入口（uni picker，无额外依赖） -->
          <picker v-if="schedules.length > 1" class="schedule-picker" :range="scheduleNames"
            :value="currentScheduleIndex" @change="onScheduleChange">
            <view class="schedule-name-row" hover-class="mm-hover">
              <text class="schedule-name">{{ currentScheduleName }}</text>
              <text class="picker-arrow">▾</text>
            </view>
          </picker>
          <view v-else class="schedule-name-row">
            <text class="schedule-name">{{ currentScheduleName }}</text>
          </view>
          <text v-if="currentSchedule" class="week-pill">第{{ currentWeek }}/{{ weekCount }}周</text>
        </view>
      </template>
      <template #right>
        <view class="today-btn" hover-class="mm-hover" @click="goToday">
          <text>今天</text>
        </view>
      </template>
    </MmNavBar>

    <!-- 首屏 loading 骨架 -->
    <view v-if="showSkeleton" class="skeleton-wrap">
      <view class="skeleton-week-bar">
        <view class="skeleton-square"></view>
        <view class="skeleton-text"></view>
        <view class="skeleton-square"></view>
      </view>
      <view class="skeleton-card">
        <view class="skeleton-card-head"></view>
        <view v-for="row in 6" :key="row" class="skeleton-card-row">
          <view v-for="cell in 7" :key="cell" class="skeleton-cell"></view>
        </view>
      </view>
    </view>

    <!-- 没有任何课表 / 加载失败 -->
    <view v-else-if="!currentSchedule" class="empty-state">
      <text class="empty-title">{{ error ? '课表加载失败' : '还没有课表' }}</text>
      <text class="empty-desc">{{ error || '你的课表还没有同步到这里，稍后再来看看吧' }}</text>
      <view v-if="error" class="empty-retry" hover-class="mm-hover" @click="refresh">重新加载</view>
    </view>

    <!-- 课表主体 -->
    <template v-else>
      <!-- 周次切换：上一周 / 第 N 周（本周高亮）/ 下一周 -->
      <view class="week-bar">
        <view class="week-btn" :class="{ disabled: currentWeek <= 1 }" hover-class="mm-hover" @click="prevWeek">
          <view class="chev chev-left"></view>
        </view>
        <view class="week-center">
          <view class="week-title-row">
            <text class="week-title">第 {{ currentWeek }} 周</text>
            <text v-if="isCurrentWeek" class="week-badge">本周</text>
          </view>
          <text class="week-range">{{ weekDateRangeText }}</text>
        </view>
        <view class="week-btn" :class="{ disabled: currentWeek >= weekCount }" hover-class="mm-hover" @click="nextWeek">
          <view class="chev chev-right"></view>
        </view>
      </view>

      <!-- 本周无课 / 课表无课程提示 -->
      <view v-if="hasNoCourseThisWeek && !isRefreshing" class="empty-banner">
        <text class="empty-banner-title">本周暂无课程</text>
        <text class="empty-banner-desc">{{ noCourseDesc }}</text>
      </view>

      <!-- 课表网格：左列固定节次/时间，右侧 7 天横向滚动 -->
      <view class="grid-card">
        <view class="grid-inner" :style="{ height: gridHeight + 'px' }">
          <!-- 左侧固定节次列 -->
          <view class="section-col">
            <view class="section-head">
              <text class="section-head-text">节次</text>
            </view>
            <view v-for="slot in sectionRows" :key="slot.number" class="section-cell">
              <text class="section-no">{{ slot.number }}</text>
              <text class="section-time">{{ slot.startTime }}</text>
            </view>
          </view>

          <!-- 右侧 7 天网格：scroll-view 横向滚动 -->
          <scroll-view class="day-scroll" scroll-x="true">
            <view class="day-grid" :style="{ width: dayGridWidth + 'px' }">
              <view v-for="day in weekDays" :key="day.dayOfWeek" class="day-col"
                :class="{ 'is-today': day.isToday }">
                <view class="day-head" :class="{ 'is-today': day.isToday }">
                  <text class="day-week">{{ day.label }}</text>
                  <text class="day-date">{{ day.dateText }}</text>
                </view>
                <view class="day-body" :style="{ height: bodyHeight + 'px' }">
                  <!-- 背景节次行（画分隔线），课程块绝对定位覆盖其上 -->
                  <view v-for="slot in sectionRows" :key="slot.number" class="slot-row"></view>
                  <view v-for="block in getDayBlocks(day.dayOfWeek)" :key="block.key" class="course-block"
                    :style="courseBlockStyle(block)" hover-class="mm-hover" @click="openCourseDetail(block)">
                    <text class="course-block-name">{{ block.courseName }}</text>
                    <text v-if="block.location" class="course-block-loc">{{ block.location }}</text>
                  </view>
                </view>
              </view>
            </view>
          </scroll-view>
        </view>

        <view class="grid-footer">
          <text class="grid-footer-text">{{ currentScheduleName }} · 第 {{ currentWeek }} 周</text>
          <text class="grid-footer-hint">{{ isRefreshing ? '更新中…' : '左右滑动查看整周' }}</text>
        </view>
      </view>
    </template>

    <!-- 课程详情弹层（只读，无编辑入口） -->
    <view v-if="activeCourse" class="sheet-overlay" @click="closeCourseDetail">
      <view class="sheet-card" @click.stop>
        <view class="sheet-head">
          <view class="sheet-title-row">
            <view class="sheet-color-dot"
              :style="{ backgroundColor: activeCourse.color || 'var(--theme-primary)' }"></view>
            <text class="sheet-title">{{ activeCourse.courseName }}</text>
          </view>
          <view class="sheet-close" hover-class="mm-hover" @click="closeCourseDetail">
            <text class="sheet-close-icon">✕</text>
          </view>
        </view>

        <view class="sheet-body">
          <view class="sheet-row">
            <text class="sheet-label">上课时间</text>
            <text class="sheet-value">{{ courseTimeText(activeCourse) }}</text>
          </view>
          <view class="sheet-row">
            <text class="sheet-label">上课地点</text>
            <text class="sheet-value">{{ activeCourse.location || '未填写' }}</text>
          </view>
          <view class="sheet-row">
            <text class="sheet-label">授课教师</text>
            <text class="sheet-value">{{ activeCourse.teacher || '未填写' }}</text>
          </view>
          <view class="sheet-row">
            <text class="sheet-label">上课周次</text>
            <text class="sheet-value">{{ activeCourse.weekText }}</text>
          </view>
          <view v-if="activeCourse.remark" class="sheet-row">
            <text class="sheet-label">备注</text>
            <text class="sheet-value">{{ activeCourse.remark }}</text>
          </view>
        </view>

        <view class="sheet-footer">
          <view class="sheet-btn" hover-class="mm-hover" @click="closeCourseDetail">
            <text>关闭</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* ============================================================
   课程页（只读课表）：单色风格 + 小程序网格
   —— 左侧节次列固定、右侧 7 天横向滚动；
   —— 课程块用接口返回的课程色做低透明度浅底 + 左侧原色条，
      其余颜色一律走主题 token（白卡片 / 描边 / 文字 / 强调色）。
   ============================================================ */

.class-tab-container {
  padding: var(--page-pad);
  box-sizing: border-box;
  background-color: var(--bg-color);
  min-height: 100%;
}

/* ---------- 顶栏左右插槽 ---------- */
.schedule-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.schedule-picker {
  flex-shrink: 1;
  min-width: 0;
}

.schedule-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.schedule-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
  max-width: 120px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.picker-arrow {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1;
}

.week-pill {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--theme-color-strong);
  background-color: var(--theme-color-soft);
  border-radius: 999px;
  padding: 2px 8px;
}

/* 「今天」按钮：36px 行内按钮热区（导航栏内），符合移动端点击规范 */
.today-btn {
  height: 36px;
  min-width: 52px;
  padding: 0 12px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
  font-size: 13px;
  font-weight: 600;
}

/* ---------- 周次切换条 ---------- */
.week-bar {
  margin-top: 12px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

.week-btn {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  box-sizing: border-box;
}

.week-btn.disabled {
  opacity: 0.35;
  pointer-events: none;
}

/* 左右 chevron：用边框绘制，颜色随 --text-muted（与 MmNavBar 返回箭头同一技法） */
.chev {
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border-style: solid;
  border-color: var(--text-muted);
  border-width: 0 2px 2px 0;
}

.chev-left {
  transform: rotate(135deg);
  margin-left: 3px;
}

.chev-right {
  transform: rotate(-45deg);
  margin-right: 3px;
}

.week-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.week-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.week-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.week-badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--theme-color-strong);
  background-color: var(--theme-color-soft);
  border-radius: 999px;
  padding: 1px 6px;
}

.week-range {
  font-size: 11px;
  color: var(--text-muted);
}

/* ---------- 空态 / 空课提示 ---------- */
.empty-state {
  margin-top: 12px;
  padding: 48px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.empty-desc {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.6;
}

.empty-retry {
  margin-top: 8px;
  height: 44px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 10px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
  font-size: 14px;
  font-weight: 600;
}

.empty-banner {
  margin-top: 12px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background-color: var(--surface-soft);
  border: 1px dashed var(--border-strong);
  border-radius: var(--card-radius);
}

.empty-banner-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}

.empty-banner-desc {
  font-size: 11px;
  color: var(--text-muted);
}

/* ---------- 课表网格 ---------- */
.grid-card {
  margin-top: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}

.grid-inner {
  display: flex;
  align-items: stretch;
  width: 100%;
}

/* 左侧固定节次/时间列 */
.section-col {
  width: 52px;
  flex-shrink: 0;
  background-color: var(--surface-soft);
  border-right: 1px solid var(--divider-color);
  box-sizing: border-box;
}

.section-head {
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid var(--divider-color);
  box-sizing: border-box;
}

.section-head-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}

.section-cell {
  height: 62px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-bottom: 1px solid var(--divider-color);
  box-sizing: border-box;
}

.section-cell:last-child {
  border-bottom: none;
}

.section-no {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
  line-height: 1;
}

.section-time {
  font-size: 9px;
  color: var(--text-faint);
  line-height: 1;
}

/* 右侧 7 天：scroll-view 横向滚动 */
.day-scroll {
  flex: 1;
  min-width: 0;
  height: 100%;
  white-space: nowrap;
}

.day-grid {
  display: flex;
  height: 100%;
  /* 作为 scroll-view 内容宽度固定为 7 列总宽，禁止被 flex 压缩，保证横向滚动 */
  flex-shrink: 0;
}

.day-col {
  width: 78px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.day-col + .day-col {
  border-left: 1px solid var(--divider-color);
}

.day-head {
  height: 42px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border-bottom: 1px solid var(--divider-color);
  box-sizing: border-box;
}

.day-week {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  line-height: 1;
}

.day-date {
  font-size: 9px;
  color: var(--text-faint);
  line-height: 1;
}

/* 今天列：表头浅强调色底 + 强调色文字，列底也略作区分 */
.day-head.is-today {
  background-color: var(--theme-color-soft);
}

.day-head.is-today .day-week,
.day-head.is-today .day-date {
  color: var(--theme-color-strong);
}

.day-col.is-today .day-body {
  background-color: var(--theme-color-softer);
}

.day-body {
  position: relative;
  box-sizing: border-box;
}

/* 背景节次行（只画分隔线），课程块绝对定位覆盖在上面 */
.slot-row {
  height: 62px;
  border-bottom: 1px solid var(--divider-color);
  box-sizing: border-box;
}

.slot-row:last-child {
  border-bottom: none;
}

/* 课程块：浅色底 + 左侧原色条；跨行由内联 top/height 控制 */
.course-block {
  position: absolute;
  left: 2px;
  right: 2px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 3px 4px;
  box-sizing: border-box;
  border-left: 3px solid var(--theme-primary);
  border-radius: 6px;
  overflow: hidden;
}

.course-block-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-color);
  line-height: 1.25;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
}

.course-block-loc {
  font-size: 9px;
  color: var(--text-muted);
  line-height: 1.2;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.grid-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--divider-color);
}

.grid-footer-text {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.grid-footer-hint {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-faint);
}

/* ---------- 首屏骨架（灰阶全走 token） ---------- */
.skeleton-wrap {
  pointer-events: none;
}

.skeleton-week-bar {
  margin-top: 12px;
  height: 64px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-sizing: border-box;
}

.skeleton-square {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 10px;
  background-color: var(--surface-soft);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton-text {
  flex: 1;
  height: 28px;
  border-radius: 8px;
  background-color: var(--surface-soft);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton-card {
  margin-top: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  overflow: hidden;
}

.skeleton-card-head {
  height: 42px;
  background-color: var(--surface-soft);
  border-bottom: 1px solid var(--divider-color);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton-card-row {
  display: flex;
  gap: 4px;
  padding: 3px 4px;
}

.skeleton-cell {
  flex: 1;
  height: 56px;
  border-radius: 6px;
  background-color: var(--surface-soft);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 0.5;
  }

  50% {
    opacity: 0.9;
  }
}

/* ---------- 课程详情弹层 ---------- */
.sheet-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background-color: var(--mask-color);
}

.sheet-card {
  width: 100%;
  max-width: 340px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--theme-outer-glow);
  animation: sheet-in 0.2s ease-out;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--divider-color);
}

.sheet-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sheet-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sheet-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sheet-close {
  width: 44px;
  height: 44px;
  margin: -8px -8px -8px 0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.sheet-close-icon {
  font-size: 16px;
  color: var(--text-muted);
  line-height: 1;
}

.sheet-body {
  padding: 4px 16px;
}

.sheet-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--divider-color);
}

.sheet-row:last-child {
  border-bottom: none;
}

.sheet-label {
  width: 64px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.sheet-value {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--text-color);
  line-height: 1.5;
  word-break: break-all;
}

.sheet-footer {
  padding: 12px 16px 16px;
}

.sheet-btn {
  height: var(--control-h);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--theme-gradient);
  color: var(--theme-action-contrast);
  font-size: 15px;
  font-weight: 600;
}

@keyframes sheet-in {
  from {
    opacity: 0;
    transform: translateY(16px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
