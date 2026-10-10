<script setup lang="ts">

import PlanSidebar from "@/features/plans/components/PlanSidebar.vue";
import CalendarCell from "./CalendarCell.vue";
import { usePlansStore } from "@/stores";

interface Props {
  // selectedPlanId: number | null;
  // checkinDate: Date;
  getDayStatusClass: (date: Date) => string;
  getDayStatusStyle: (date: Date) => string;
}

interface Emits {
  // (e: "update:checkinDate", value: Date): void;
  // (e: "update:selectedPlanId", value: number | null): void;
  (e: "create"): void;
  (e: "edit"): void;
  (e: "dateClick", date: Date): void;
}
const selectedPlanId = defineModel<number | null>("selectedPlanId");
const checkinDate = defineModel<Date>("checkinDate");

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const plansStore = usePlansStore();

const selectedPlan = computed(() => {
  if (selectedPlanId.value == null) return null;
  return (
    plansStore.PlansItems.find((x) => x.id === selectedPlanId.value) ?? null
  );
});

function handleDateClick(date: Date): void {
  emit("dateClick", date);
}

function formatDayLabel(value: string): string {
  const parts = value.split("-");
  return parts[2]?.replace(/^0/, "") ?? value;
}

function getDayStatusClass(date: Date): string {
  return props.getDayStatusClass(date);
}
</script>

<template>
  <main class="content desktop-only">
    <PlanSidebar
      :items="plansStore.PlansItems"
      v-model:selected-id="selectedPlanId"
      @create="emit('create')"
    />

    <section class="main">
      <div class="calendar-header">
        <div class="header-row" v-if="selectedPlan">
          <h2>{{ selectedPlan.title }}</h2>
          <button class="icon-btn" @click="emit('edit')">✎</button>
        </div>
        <h2 v-else>请选择一个打卡计划</h2>
      </div>

      <el-calendar v-model="checkinDate">
        <template #date-cell="{ data }">
          <CalendarCell
            :date="data.date"
            :day-label="formatDayLabel(data.day)"
            :status-class="getDayStatusClass(data.date)"
            :status-style="getDayStatusStyle(data.date)"
            @click="handleDateClick"
          />
        </template>
      </el-calendar>

      <div class="legend">
        <span class="dot success"></span> 正常打卡
        <span class="dot retro"></span> 补签
        <span class="dot missed"></span> 错过
      </div>
    </section>
  </main>
</template>

<style scoped lang="scss">
.content {
  flex: 1;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  max-width: 1200px;
  margin: 0;
}

.main {
  padding: 16px;
}

.calendar-header {
  margin-bottom: 8px;
}

.desktop-only {
  /* 手机端 */
  @media (max-width: 768px) {
    display: block;
  }
}

.header-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;

  &:hover {
    background: var(--bg-elevated);
    color: var(--text-color);
  }
}
</style>
