<script setup lang="ts">

import { usePlansStore } from "@/stores";
import CalendarCell from "./CalendarCell.vue";

interface Props {
  selectedPlanId: number | null;
  checkinDate: Date;
  mobileMode: "card" | "calendar";
  getDayStatusClass: (date: Date) => string;
  getDayStatusStyle: (date: Date) => string;
}

interface Emits {
  (e: "update:checkinDate", value: Date): void;
}

interface Emits {
  (e: "back"): void;
  (e: "edit"): void;
  (e: "dateClick", date: Date): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const localCheckinDate = computed({
  get: () => props.checkinDate,
  set: (value) => emit("update:checkinDate", value),
});

const plansStore = usePlansStore();

const selectedPlan = computed(() => {
  if (props.selectedPlanId == null) return null;
  return plansStore.PlansItems.find((x) => x.id === props.selectedPlanId) ?? null;
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
  <section v-if="selectedPlan && mobileMode === 'calendar'" class="mobile-calendar-page mobile-only">
    <div class="mobile-calendar-header">
      <button type="button" class="mobile-back" @click="emit('back')">
        ← 返回
      </button>
      <div class="mobile-calendar-title">
        {{ selectedPlan.title }}
        <span class="mobile-edit-icon" @click="emit('edit')">✎</span>
      </div>
    </div>

    <el-calendar v-model="localCheckinDate">
      <template #date-cell="{ data }">
        <CalendarCell :date="data.date" :day-label="formatDayLabel(data.day)"
          :status-class="getDayStatusClass(data.date)" :status-style="getDayStatusStyle(data.date)"
          @click="handleDateClick" />
      </template>
    </el-calendar>

    <div class="legend">
      <span class="dot success"></span> 正常打卡
      <span class="dot retro"></span> 补签 <span class="dot missed"></span> 错过
    </div>
  </section>
</template>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

.mobile-calendar-page {
  padding: 12px;
}

.mobile-calendar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.mobile-back {
  border-radius: 999px;
  border: none;
  padding: 4px 10px;
  background: var(--theme-color-soft);
  color: var(--theme-color-strong);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;

  &:hover {
    background: var(--theme-primary-bg);
    color: var(--theme-color-contrast);
  }
}

.mobile-calendar-title {
  font-size: 14px;
  font-weight: 600;
}

.mobile-edit-icon {
  margin-left: 8px;
  font-size: 15px;
  color: var(--text-muted);

  // 触屏上把点击区域撑到 44x44（W3C/Apple 的最小舒适区）。
  // 原来只有一个 16px 的字形可点，手指基本点不中。
  @include rp.coarse-pointer {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    margin-left: 0;
  }
}

.mobile-only {
  display: none;
}

// 与 MobilePlanCards 同理：需要覆盖横屏手机，不能用纯宽度的媒体查询。
@include rp.phone {
  .mobile-only {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
}
</style>
