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
@use "@/styles/responsive-mixins" as rp;

.content {
  flex: 1;
  display: grid;
  // 侧栏按占比给而不是写死 260px：小窗口下 260px 占比过大。
  //   1200 宽 -> 260px（上限，与原来一致）
  //    852 宽 -> 约 187px
  grid-template-columns: clamp(150px, 22%, 260px) minmax(0, 1fr);
  max-width: 1200px;
  margin: 0;
}

.main {
  padding: 16px;
}

.calendar-header {
  margin-bottom: 8px;
}

// 小屏紧凑密度：横屏手机（852x393）走的就是这套桌面结构，
// 但纵向只有 393px —— 间距不收，日历区域几乎没空间可用。
// 只针对「矮」的视口，不影响正常桌面宽度下的观感。
@include rp.short-viewport {
  .main {
    padding: 8px;
  }

  .calendar-header {
    margin-bottom: 4px;

    h2 {
      font-size: 15px;
    }
  }
}

// 手机结构下隐藏桌面视图。
//
// 这里原本写的是 `display: block`，等于「在手机上把桌面网格显示出来」，
// 与 MobilePlanCards / MobileCalendarPage 同时渲染，谁生效取决于样式表顺序 ——
// 是本项目手机端布局错乱的主因。
//
// 现在两处兜底，且用的都是「宽度 + 宽高比」同一套判定：
//   1. 全局工具类 html[data-layout="mobile"] .desktop-only（styles/responsive.scss）；
//   2. 本地的 @include rp.phone，让组件不依赖全局层是否被引入。
.desktop-only {
  @include rp.phone {
    display: none;
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
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: background-color 0.2s ease, color 0.2s ease;

  &:hover {
    color: var(--theme-color-strong);
    background: var(--theme-color-soft);
  }

  // 触屏平板/触屏笔电上把点击区域撑到 44x44。
  @include rp.coarse-pointer {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
  }

  &:hover {
    background: var(--bg-elevated);
    color: var(--text-color);
  }
}
</style>
