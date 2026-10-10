<script setup lang="ts">

import { usePlansStore } from "@/stores";

interface Props {
  mobileMode: "card" | "calendar";
  progressPercentByPlan: (planId: number) => number;
  monthStatsByPlan: (planId: number) => {
    totalCheckins: number;
    activeDays: number;
  };
  miniCalendarCells: Array<Date | null>;
  getMiniDayClassForPlan: (planId: number, date: Date | null) => string[];
  isInPlanRangeForPlan: (planId: number | null, date: Date) => boolean;
}

interface Emits {
  (e: "selectPlan", planId: number): void;
  (e: "create"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const plansStore = usePlansStore();

const showEmptyState = computed(() => plansStore.PlansItems.length === 0);
</script>

<template>
  <main class="mobile-main mobile-only" v-if="mobileMode === 'card'">
    <section v-for="plan in plansStore.PlansItems" :key="plan.id" class="mobile-card" @click="emit('selectPlan', plan.id)">
      <div class="mobile-card-header">
        <div>
          <div class="mobile-title">
            {{ plan.title }}
            <span class="mobile-description">
              {{ plan.description }}
            </span>
          </div>
          <div class="mobile-subtitle">
            {{ plan.startDate }}
            {{ plan.endDate ? "到 " + plan.endDate : "开始" }}
          </div>
        </div>
        <div class="mobile-progress">
          <el-progress type="circle" :percentage="progressPercentByPlan(plan.id)" :stroke-width="6" :width="52"
            color="#22c55e" :show-text="false" />
          <div class="mobile-progress-text">
            {{ monthStatsByPlan(plan.id).totalCheckins }}
          </div>
        </div>
      </div>

      <div class="mobile-card-body">
        <div class="mini-calendar">
          <div v-for="(cell, index) in miniCalendarCells" :key="index" :class="getMiniDayClassForPlan(plan.id, cell)">
            <span v-if="cell && isInPlanRangeForPlan(plan.id, cell)" class="mini-day-label">
              {{ cell.getDate() }}
            </span>
          </div>
        </div>

        <div class="mobile-stats">
          <div class="mobile-stat">
            <div class="mobile-stat-value">
              {{ monthStatsByPlan(plan.id).totalCheckins }}
            </div>
            <div class="mobile-stat-label">本月次数</div>
          </div>
          <div class="mobile-stat">
            <div class="mobile-stat-value">
              {{ monthStatsByPlan(plan.id).activeDays }}
            </div>
            <div class="mobile-stat-label">本月天数</div>
          </div>
        </div>
      </div>
    </section>

    <section class="mobile-empty" @click="emit('create')">
      <p v-if="showEmptyState" class="mobile-empty-text">暂无打卡计划</p>
    </section>
  </main>
</template>

<style scoped lang="scss">
.mobile-main {
  padding: 12px;
}

.mobile-card {
  border-radius: 16px;
  background: var(--bg-elevated);
  padding: 16px;
  margin-bottom: 15px;
}

.mobile-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.mobile-title {
  font-size: 16px;
  font-weight: 600;

  .mobile-description {
    font-size: 12px;
    color: var(--text-muted);
  }
}

.mobile-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.mobile-progress {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mobile-progress-text {
  position: absolute;
  font-size: 14px;
  font-weight: 600;
}

.mobile-card-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.mini-calendar {
  display: grid;
  grid-template-columns: repeat(7, 18px);
  grid-auto-rows: 18px;
  gap: 4px;
}

.mini-day {
  position: relative;
  border-radius: 4px;
  background: transparent;
  width: 18px;
  height: 18px;
  cursor: default;
}

.mini-day.day.success {
  background: #22c55e;
  cursor: pointer;
}

.mini-day.day.retro {
  background: #eab308;
  cursor: pointer;
}

.mini-day.day.missed {
  background: #f97373;
  cursor: pointer;
}

.mini-day-empty {
  background: transparent;
}

.mini-day-today {
  border: 1px solid #22c55e;
}

.mini-day-future {
  border: 1px solid #38bdf8;
}

.mini-day-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
}

.mini-day.day.success .mini-day-label,
.mini-day.day.retro .mini-day-label,
.mini-day.day.missed .mini-day-label {
  color: #ffffff;
}

.mobile-stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mobile-stat-value {
  font-size: 18px;
  font-weight: 600;
}

.mobile-stat-label {
  font-size: 12px;
  color: var(--text-muted);
}

.mobile-empty {
  border-radius: 16px;
  background: var(--bg-elevated);
  padding: 20px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  background-image:
    linear-gradient(#f3f4f6),
    linear-gradient(#f3f4f6);
  background-repeat: no-repeat;
  background-position: center;
  background-size:
    2px 24px,
    24px 2px;
}

.mobile-empty-text {
  font-size: 14px;
}

.mobile-only {
  display: none;
}

@media (max-width: 768px) {
  .mobile-only {
    display: flex;
    flex-direction: column;
    width: 100vw;
  }
}
</style>
