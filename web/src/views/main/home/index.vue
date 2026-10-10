<script setup lang="ts">
import { usePlansStore, useCheckinsStore } from "@/stores";
import type { PlanSummary } from "@/features/plans/types";
import { notifyWarning } from "@/utils/notification";
import CreatePlanDrawer from "@/features/plans/components/CreatePlanDrawer.vue";
import CheckinDetailDrawer from "@/features/checkin/components/CheckinDetailDrawer.vue";
import DesktopMainView from "@/features/plans/components/DesktopMainView.vue";
import MobilePlanCards from "@/features/plans/components/MobilePlanCards.vue";
import MobileCalendarPage from "@/features/plans/components/MobileCalendarPage.vue";
import { usePlanCalendar } from "@/features/plans/composables/usePlanCalendar";

// 解构获取工具函数
const { parseDateOnly } = usePlanCalendar();

const plansStore = usePlansStore();
const checkinsStore = useCheckinsStore();

// 使用组合式函数管理日历逻辑
const {
  currentYear,
  currentMonth,
  selectedPlanId,
  checkinDate,
  selectedPlan,
  miniCalendarCells,
  monthStatsByPlan,
  progressPercentByPlan,
  isInPlanRangeForPlan,
  getMiniDayClassForPlan,
  getDayStatusClass,
  getDayStatusStyle,
} = usePlanCalendar();

const showPlanDrawer = ref(false);
const drawerPlan = ref<PlanSummary | null>(null);
const showDetailDrawer = ref(false);
const mobileMode = ref<"card" | "calendar">("card");

onMounted(async () => {
  await plansStore.fetchMyPlans();
  const first = plansStore.PlansItems[0];
  if (first) selectedPlanId.value = first.id;
});

watch(
  () => [selectedPlanId.value, currentYear.value, currentMonth.value] as [number | null, number, number],
  async (vals: [number | null, number, number]) => {
    const planId = vals[0];
    if (!planId) return;
    await checkinsStore.loadCalendar(
      planId,
      currentYear.value,
      currentMonth.value,
    );
  },
  { immediate: true },
);

function handleDateClick(date: Date): void {
  // 检查计划范围和未来日期
  const todayOnly = getDateWithoutTime(new Date());
  // 获取当前时间的年月日，构造一个新的日期对象，时间部分为00:00:00
  const targetOnly = getDateWithoutTime(date);

  // 检查计划范围
  if (selectedPlan.value) {
    const plan = selectedPlan.value;
    const startDate = parseDateOnly(plan.startDate);
    const startOnly = getDateWithoutTime(startDate);

    if (targetOnly < startOnly) {
      notifyWarning("所选日期计划未开始");
      return;
    }

    if (plan.endDate) {
      const endDate = parseDateOnly(plan.endDate);
      const endOnly = getDateWithoutTime(endDate);

      if (targetOnly > endOnly) {
        notifyWarning("所选日期计划已结束");
        return;
      }
    }
  }

  // 检查是否为未来日期
  if (targetOnly > todayOnly) {
    notifyWarning("未来日期不能打卡");
    return;
  }

  checkinDate.value = date;
  showDetailDrawer.value = true;
}

// 提取日期工具函数到组件级别
function getDateWithoutTime(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function handleCreatePlan(): void {
  drawerPlan.value = null;
  showPlanDrawer.value = true;
}

function handleEditPlan(): void {
  if (!selectedPlan.value) return;
  drawerPlan.value = selectedPlan.value;
  showPlanDrawer.value = true;
}

function handlePlanCreated(id: number): void {
  selectedPlanId.value = id;
  mobileMode.value = "card";
}

function handlePlanDeleted(id: number): void {
  if (selectedPlanId.value === id) {
    const first = plansStore.PlansItems[0];
    selectedPlanId.value = first ? first.id : null;
    if (!first) {
      mobileMode.value = "card";
    }
  }
}

function handleMobileCardSelect(planId: number): void {
  selectedPlanId.value = planId;
  handleMobileCardClick();
}

function handleMobileCardClick(): void {
  if (!selectedPlan.value) return;
  mobileMode.value = "calendar";
}

function handleMobileCalendarBack(): void {
  mobileMode.value = "card";
}

function getTimeSlotMode(): "default" | "timeSlot" {
  // 根据选中的计划是否有时段来决定模式
  const plan = selectedPlan.value;
  return plan?.timeSlots && plan.timeSlots.length > 0 ? "timeSlot" : "default";
}

function handleOpenCheckinFromDetail(): void {
  // 从详情页打开打卡页面
  showDetailDrawer.value = true;
}
</script>

<template>
  <el-scrollbar wrap-style="height: calc(100vh - var(--header-h))" view-class="dashboard">
    <DesktopMainView v-model:selected-plan-id="selectedPlanId" v-model:checkin-date="checkinDate"
      :get-day-status-class="getDayStatusClass" :get-day-status-style="getDayStatusStyle" @create="handleCreatePlan"
      @edit="handleEditPlan" @date-click="handleDateClick" />

    <MobilePlanCards :mobile-mode="mobileMode" :progress-percent-by-plan="progressPercentByPlan"
      :month-stats-by-plan="monthStatsByPlan" :mini-calendar-cells="miniCalendarCells"
      :get-mini-day-class-for-plan="getMiniDayClassForPlan" :is-in-plan-range-for-plan="isInPlanRangeForPlan"
      @select-plan="handleMobileCardSelect" @create="handleCreatePlan" />

    <MobileCalendarPage :selected-plan-id="selectedPlanId" :checkin-date="checkinDate" :mobile-mode="mobileMode"
      :get-day-status-class="getDayStatusClass" :get-day-status-style="getDayStatusStyle"
      @update:checkin-date="(v: Date) => (checkinDate = v)" @back="handleMobileCalendarBack" @edit="handleEditPlan"
      @date-click="handleDateClick" />

    <CreatePlanDrawer v-model="showPlanDrawer" :edit-plan="drawerPlan" @created="handlePlanCreated"
      @deleted="handlePlanDeleted" />

    <CheckinDetailDrawer v-if="selectedPlanId" v-model="showDetailDrawer" :plan-id="selectedPlanId" :date="checkinDate"
      :time-slots="selectedPlan?.timeSlots" :mode="getTimeSlotMode()" @open-checkin="handleOpenCheckinFromDetail" />
  </el-scrollbar>
</template>

<style lang="scss">
@use "@/features/plans/style/index.scss";
</style>

<style scoped lang="scss">
:deep(.dashboard) {
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  color: var(--text-color);
  align-items: center;
}

@media (max-width: 768px) {
  .desktop-only {
    display: none;
  }
}
</style>
