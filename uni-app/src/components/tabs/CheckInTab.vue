<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { usePlansStore } from '@/stores/plans';
import { useCheckinsStore } from '@/stores/checkins';
import ProgressRing from '@/components/ProgressRing.vue';
import { toLocalDateOnlyString, parseDateOnly, getMonthDays } from '@/utils/date';
import MmNavBar from '@/components/MmNavBar.vue';

const props = defineProps<{
  isActive: boolean;
}>();

const plansStore = usePlansStore();
const checkinsStore = useCheckinsStore();

const today = new Date();
const currentYear = ref(today.getFullYear());
const currentMonth = ref(today.getMonth() + 1);
const isLoading = ref(true);

watch(() => props.isActive, async (newVal) => {
  if (newVal) {
    await loadData();
  }
}, { immediate: true });

function handlePlanUpdated() {
  if (props.isActive) {
    loadData();
  }
}

onMounted(() => {
  uni.$on('plan-updated', handlePlanUpdated);
});

onUnmounted(() => {
  uni.$off('plan-updated', handlePlanUpdated);
});

async function loadData() {
  isLoading.value = true;
  try {
    await plansStore.fetchMyPlans();
    if (plansStore.items.length > 0) {
      const year = currentYear.value;
      const month = currentMonth.value;
      const tasks = plansStore.items.map((plan) => {
        // Load current month calendar for display
        const t1 = checkinsStore.loadCalendar(plan.id, year, month);
        // Load total stats
        const t2 = checkinsStore.fetchPlanStats(plan);
        return Promise.all([t1, t2]);
      });
      await Promise.all(tasks);
    }
  } finally {
    isLoading.value = false;
  }
}

const monthDays = computed(() => {
  return getMonthDays(currentYear.value, currentMonth.value);
});

const miniCalendarCells = computed(() => {
  const source = monthDays.value;
  if (source.length === 0) return [] as Array<Date | null>;
  const cells: Array<Date | null> = [];
  const firstDay = source[0];
  const weekday = firstDay ? firstDay.getDay() : 1; // 0=Sun
  const offset = weekday === 0 ? 6 : weekday - 1; // Mon=0, Sun=6 for grid starting Monday
  for (let i = 0; i < offset; i += 1) {
    cells.push(null);
  }
  for (const d of source) {
    cells.push(d);
  }
  return cells;
});

function isInPlanRangeForPlan(planId: number | null, date: Date): boolean {
  if (planId == null) return false;
  const plan = plansStore.items.find((x) => x.id === planId);
  if (!plan) return false;
  const cellDate = parseDateOnly(toLocalDateOnlyString(date));
  const startDate = parseDateOnly(plan.startDate);
  const endDate = plan.endDate ? parseDateOnly(plan.endDate) : null;
  if (cellDate < startDate) return false;
  if (endDate && cellDate > endDate) return false;
  return true;
}

function getPlanStatusCode(planId: number | null, date: Date): number | undefined {
  if (planId == null) return undefined;
  const list = checkinsStore.calendarByPlan[planId] ?? [];
  const key = toLocalDateOnlyString(date);
  const found = list.find((item) => item.date === key);
  return found?.status;
}

function getPlanDayStatusClass(planId: number | null, date: Date): string {
  const status = getPlanStatusCode(planId, date);
  if (status === 1) return 'day success';
  if (status === 2) return 'day retro';

  const cellDate = parseDateOnly(toLocalDateOnlyString(date));
  const now = new Date();
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const inPlanRange = isInPlanRangeForPlan(planId, date);
  const isPastDay = cellDate < todayOnly;

  if (inPlanRange && isPastDay && (status === undefined || status === null)) {
    return 'day missed';
  }

  return 'day';
}

function getMiniDayClassForPlan(planId: number, date: Date | null): string[] {
  if (!date || !isInPlanRangeForPlan(planId, date)) {
    return ['mini-day', 'mini-day-empty'];
  }
  const cls = getPlanDayStatusClass(planId, date);
  const classes: string[] = ['mini-day', cls];

  const now = new Date();
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (targetOnly.getTime() === todayOnly.getTime()) {
    classes.push('mini-day-today');
  }

  return classes;
}

const monthStatsByPlan = computed((): ((planId: number) => { totalCheckins: number; activeDays: number; percentage: number }) => {
  return (planId: number) => {
    let totalCheckins = 0;
    let activeDays = 0;

    for (const day of monthDays.value) {
      if (isInPlanRangeForPlan(planId, day)) {
        activeDays += 1;
        const cls = getPlanDayStatusClass(planId, day);
        if (cls.includes('success') || cls.includes('retro')) {
          totalCheckins += 1;
        }
      }
    }

    const percentage = activeDays > 0 ? (totalCheckins / activeDays) * 100 : 0;
    return { totalCheckins, activeDays, percentage };
  };
});

function getTotalStatsDisplay(planId: number) {
  const stats = checkinsStore.stats[planId];
  if (!stats || stats.loading) return '∞';

  const { totalCheckins, totalDays } = stats;
  if (totalDays === null) {
    return `${totalCheckins}/∞`;
  }
  return `${totalCheckins}/${totalDays}`;
}

function handlePlanClick(planId: number) {
  uni.navigateTo({
    url: `/pages/plan/detail?id=${planId}`
  });
}

function handleCreatePlan() {
  uni.navigateTo({
    url: '/pages/plan/create'
  });
}

function getPlanStatus(plan: any) {
  if (!plan.isActive) {
    return { text: '已停用', class: 'status-inactive' };
  }

  const now = new Date();
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = parseDateOnly(plan.startDate);
  const endDate = plan.endDate ? parseDateOnly(plan.endDate) : null;

  if (startDate > todayOnly) {
    return { text: '未开始', class: 'status-pending', isInactive: true };
  }
  if (endDate && endDate < todayOnly) {
    return { text: '已结束', class: 'status-ended', isInactive: true };
  }
  return null; // 进行中不显示状态
}
</script>

<template>
  <view class="tab-content">
    <NotificationSystem />

    <!-- 毛玻璃顶栏：内容与顶栏之间保留 .tab-content 的 16px 顶部内边距作为间距 -->
    <MmNavBar title="我的计划" :show-back="false" align="left" />

    <view class="plan-list">
      <template v-if="isLoading">
        <view v-for="i in 2" :key="i" class="plan-card skeleton">
          <view class="skeleton-header">
            <view class="skeleton-title"></view>
            <view class="skeleton-desc"></view>
          </view>
          <view class="skeleton-date"></view>
          <view class="skeleton-body">
            <view class="skeleton-calendar"></view>
            <view class="skeleton-stats"></view>
          </view>
        </view>
      </template>

      <template v-else>
        <view v-for="plan in plansStore.items" :key="plan.id" class="plan-card" hover-class="mm-hover"
          @click="handlePlanClick(plan.id)">
          <view class="card-header-row">
            <view class="card-title-group">
              <text class="card-title">{{ plan.title }}</text>
              <text v-if="getPlanStatus(plan)" :class="['status-badge', getPlanStatus(plan)?.class]">{{ getPlanStatus(plan)?.text
              }}</text>
              <text class="card-desc">{{ plan.description || '无描述' }}</text>
            </view>
          </view>
          <text class="card-date-range">{{ plan.startDate }} 到 {{ plan.endDate || '永久' }}</text>

          <view class="card-body">
            <view class="calendar-wrapper">
              <view class="mini-calendar">
                <view v-for="(cell, index) in miniCalendarCells" :key="index"
                  :class="getMiniDayClassForPlan(plan.id, cell)">
                  <text v-if="cell && isInPlanRangeForPlan(plan.id, cell)" class="mini-day-text">
                    {{ cell.getDate() }}
                  </text>
                </view>
              </view>
            </view>

            <view class="stats-wrapper">
              <view class="progress-ring">
                <!-- 进度环颜色改为默认主题强调色，不再传旧绿色 -->
                <ProgressRing :progress="monthStatsByPlan(plan.id).percentage / 100" :size="50" :radius="65"
                  :strokeWidth="12">
                  <text class="ring-text">{{ monthStatsByPlan(plan.id).totalCheckins }}</text>
                </ProgressRing>
              </view>

              <view class="stat-item">
                <text class="stat-val">{{ monthStatsByPlan(plan.id).percentage.toFixed(2) }}%</text>
                <text class="stat-lbl">本月进度</text>
              </view>

              <view class="stat-item">
                <text class="stat-val">{{ monthStatsByPlan(plan.id).totalCheckins }}/{{
                  monthStatsByPlan(plan.id).activeDays }}</text>
                <text class="stat-lbl">本月天数</text>
              </view>
              <view class="stat-item">
                <text class="stat-val">{{ getTotalStatsDisplay(plan.id) }}</text>
                <text class="stat-lbl">总进度</text>
              </view>
            </view>
          </view>

          <!-- Inactive Overlay -->
          <view v-if="getPlanStatus(plan)?.isInactive" class="card-overlay">
            <text class="overlay-text">{{ getPlanStatus(plan)?.text }}</text>
          </view>
        </view>

        <view class="create-plan-card" hover-class="mm-hover" @click="handleCreatePlan">
          <text class="create-icon">+</text>
        </view>

        <view v-if="plansStore.items.length === 0" class="empty-state">
          <text>暂无计划，点击上方按钮创建</text>
        </view>
      </template>
    </view>
  </view>
</template>

<style scoped lang="scss">
@use "@/styles/status-colors.scss";

/* 打卡 tab 根节点：左右 16px 页面留白，min-height 用 100% 避免在 100vh 容器内再套 100vh */
.tab-content {
  padding: var(--page-pad);
  padding-bottom: 4px;
  box-sizing: border-box;
  background-color: var(--bg-color);
  min-height: 100%;
}

.header {
  margin-bottom: 20px;
}

.plan-list {
  /* 底部 tabBar 空间已由 pages/main/index.vue 的滚动容器统一预留，这里不再叠加 80px */
  padding-bottom: 4px;
}

/* Skeleton Loading */
.skeleton {
  pointer-events: none;
  
  .skeleton-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  
  .skeleton-title {
    width: 40%;
    height: 24px;
    background-color: var(--surface-soft);
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
      background: linear-gradient(90deg, transparent, var(--divider-color), transparent);
      animation: skeleton-loading 1.5s infinite;
    }
  }
  
  .skeleton-desc {
    flex: 1;
    height: 16px;
    background-color: var(--divider-color);
    border-radius: 4px;
  }
  
  .skeleton-date {
    width: 60%;
    height: 14px;
    background-color: var(--divider-color);
    border-radius: 4px;
    margin-bottom: 20px;
  }
  
  .skeleton-body {
    display: flex;
    gap: 16px;
  }
  
  .skeleton-calendar {
    flex: 1;
    height: 120px;
    background-color: var(--divider-color);
    border-radius: 8px;
  }
  
  .skeleton-stats {
    width: 80px;
    height: 120px;
    background-color: var(--divider-color);
    border-radius: 8px;
  }
}

@keyframes skeleton-loading {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* Plan Card：统一为单色卡片语言（白底 + token 描边/阴影） */
.plan-card {
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  padding: var(--uni-card-padding);
  margin-bottom: var(--uni-card-margin-bottom);
  box-shadow: var(--card-shadow);
  position: relative;
  overflow: hidden;
}

/* 未开始 / 已结束计划的遮罩：透明底 + 背景模糊（毛玻璃），卡片内容仍隐约可见；
   不支持 backdrop-filter 的环境回退到 --overlay-bg-fallback（更实的半透明底） */
.card-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  background-color: var(--overlay-bg-fallback);
}

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .card-overlay {
    background-color: var(--overlay-bg);
    -webkit-backdrop-filter: blur(10px) saturate(150%);
    backdrop-filter: blur(10px) saturate(150%);
  }
}

.overlay-text {
  font-size: 24px;
  font-weight: bold;
  color: var(--text-muted);
  transform: rotate(-15deg);
  border: 3px solid var(--text-muted);
  padding: 4px 16px;
  border-radius: 8px;
  opacity: 0.8;
}

.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}

.card-title-group {
  display: flex;
  align-items: baseline;
  gap: 8px;
  overflow: hidden;
}

.card-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-color);
  white-space: nowrap;
  flex-shrink: 0;
}

/* 状态徽标：只用中性 / 语义 token，不再写死蓝 / 灰 / 橙 */
.status-badge {
   font-size: 10px;
   padding: 1px 8px;
   border-radius: 999px;
   font-weight: 500;
   flex-shrink: 0;
   white-space: nowrap;
 }

/* 未开始：中性浅底 */
.status-pending {
   background-color: var(--surface-soft);
   color: var(--text-muted);
 }

/* 已结束：更弱的灰 */
.status-ended {
   background-color: var(--divider-color);
   color: var(--text-faint);
 }

/* 已停用：语义警告色（补签黄同族） */
.status-inactive {
   background-color: var(--color-warning-soft);
   color: var(--color-warning-text);
 }

.card-desc {
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.card-date-range {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 16px;
}

.card-body {
  display: flex;
  gap: 16px;
  align-items: center;
}

.calendar-wrapper {
  flex: 1;
}

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
  font-size: 12px;
  color: var(--text-color);
  font-weight: 500;
}

.mini-day-today {
  border: 1px solid var(--theme-primary) !important;
  font-weight: 600;
}

/* Stats Wrapper */
.stats-wrapper {
  width: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.ring-text {
  font-size: 16px;
  font-weight: bold;
  color: var(--text-color);
}

.stat-item {
  text-align: center;
  line-height: 1.2;
}

.stat-val {
  display: block;
  font-size: 16px;
  font-weight: bold;
  color: var(--text-color);
}

.stat-lbl {
  font-size: 11px;
  color: var(--text-muted);
}

/* 新建计划入口：虚线描边卡片，与白卡片同一套 token */
.create-plan-card {
  background-color: var(--bg-elevated);
  border: 1px dashed var(--border-strong);
  border-radius: var(--card-radius);
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--uni-card-margin-bottom);
  box-sizing: border-box;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.create-plan-card:active {
  transform: scale(0.98);
  opacity: 0.8;
}

.create-icon {
  font-size: 32px;
  color: var(--text-muted);
  font-weight: 300;
  line-height: 1;
}

.empty-state {
  text-align: center;
  color: var(--text-muted);
  margin-top: 20px;
}
</style>
