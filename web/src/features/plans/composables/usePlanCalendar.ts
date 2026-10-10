import { computed, ref, watch } from "vue";
import { usePlansStore, useCheckinsStore } from "@/stores";
import { storeToRefs } from "pinia";
import { toLocalDateOnlyString } from "@/utils/date";
export function usePlanCalendar() {
  const { PlansItems } = storeToRefs(usePlansStore());
  const { calendarByPlan } = storeToRefs(useCheckinsStore());

  const today = new Date();
  const currentYear = ref(today.getFullYear());
  const currentMonth = ref(today.getMonth() + 1);
  const selectedPlanId = ref<number | null>(null);
  const checkinDate = ref<Date>(new Date());

  const selectedPlan = computed(() => {
    if (selectedPlanId.value == null) return null;
    const data = PlansItems.value.find((x) => x.id === selectedPlanId.value) ?? null;
    return data;
  });

  const monthDays = computed(() => {
    const days: Date[] = [];
    const year = currentYear.value;
    const month = currentMonth.value - 1;
    const cursor = new Date(year, month, 1);
    while (cursor.getMonth() === month) {
      days.push(
        new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()),
      );
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  });

  const miniCalendarCells = computed(() => {
    const source = monthDays.value;
    if (source.length === 0) return [] as Array<Date | null>;
    const cells: Array<Date | null> = [];
    const firstDay = source[0];
    const weekday = firstDay ? firstDay.getDay() : 1; // 0=Sun
    const offset = (weekday + 6) % 7; // Monday=0
    for (let i = 0; i < offset; i += 1) {
      cells.push(null);
    }
    for (const d of source) {
      cells.push(d);
    }
    return cells;
  });

  function parseDateOnly(input: string): Date {
    const parts = input.split("-");
    const y = Number(parts[0] ?? "0") || 0;
    const m = Number(parts[1] ?? "1") || 1;
    const d = Number(parts[2] ?? "1") || 1;
    return new Date(y, m - 1, d);
  }

  function isInPlanRangeForPlan(planId: number | null, date: Date): boolean {
    if (planId == null) return false;
    const plan = PlansItems.value.find((x) => x.id === planId);
    if (!plan) return false;
    const cellDate = parseDateOnly(toLocalDateOnlyString(date));
    const startDate = parseDateOnly(plan.startDate);
    const endDate = plan.endDate ? parseDateOnly(plan.endDate) : null;
    if (cellDate < startDate) return false;
    if (endDate && cellDate > endDate) return false;
    return true;
  }

  function getPlanStatusCode(
    planId: number | null,
    date: Date,
  ): number | undefined {
    if (planId == null) return undefined;
    const list = calendarByPlan.value[planId] ?? [];
    const key = toLocalDateOnlyString(date);
    const found = list.find((item) => item.date === key);
    return found?.status;
  }

  function getTimeProgress(planId: number | null, date: Date): number {
    if (planId == null) return 0;
    const list = calendarByPlan.value[planId] ?? [];
    const key = toLocalDateOnlyString(date);
    const found = list.find((item) => item.date === key);
    if (found && found.checkinMode == 1) {
      const timeCount = PlansItems.value.find((x) => x.id === planId)?.timeSlots?.length ?? 0;
      if (timeCount > 0) {
        return found.status / timeCount;
      }
    }
    return 0;
  }

  function getPlanDayStatusClass(planId: number | null, date: Date): string {
    if (planId == null) return "day";
    const list = calendarByPlan.value[planId] ?? [];
    const key = toLocalDateOnlyString(date);
    const found = list.find((item) => item.date === key);
    if (found) {
      if (found.checkinMode == 1) {
        const statusCode = getTimeProgress(planId, date);
        if (statusCode >= 0.7) {
          return "day success cell";
        }
        if (statusCode > 0.5) {
          return "day retro cell";
        }
        return "day missed cell";
      }
    }

    const status = getPlanStatusCode(planId, date);
    if (status === 1) return "day success";
    if (status === 2) return "day retro";

    const cellDate = parseDateOnly(toLocalDateOnlyString(date));
    const now = new Date();
    const todayOnly = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const inPlanRange = isInPlanRangeForPlan(planId, date);
    const isPastDay = cellDate < todayOnly;

    if (inPlanRange && isPastDay && (status === undefined || status === null)) {
      return "day missed";
    }
    return "day";
  }

  function getMiniDayClassForPlan(planId: number, date: Date | null): string[] {
    if (!date || !isInPlanRangeForPlan(planId, date)) {
      return ["mini-day", "mini-day-empty"];
    }
    const cls = getPlanDayStatusClass(planId, date);
    const classes: string[] = ["mini-day", cls];

    if (cls === "day") {
      const now = new Date();
      const todayOnly = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const targetOnly = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      );
      if (targetOnly.getTime() === todayOnly.getTime()) {
        classes.push("mini-day-today");
      } else if (targetOnly > todayOnly) {
        classes.push("mini-day-future");
      }
    }

    return classes;
  }

  const monthStatsByPlan = computed(() => {
    return (planId: number) => {
      let totalCheckins = 0;
      let activeDays = 0;
      for (const day of monthDays.value) {
        const cls = getPlanDayStatusClass(planId, day);
        if (cls.includes("success") || cls.includes("retro")) {
          totalCheckins += 1;
        }
        if (
          cls.includes("success") ||
          cls.includes("retro") ||
          cls.includes("missed")
        ) {
          activeDays += 1;
        }
      }
      return { totalCheckins, activeDays };
    };
  });

  const progressPercentByPlan = computed(() => {
    return (planId: number) => {
      const stats = monthStatsByPlan.value(planId);
      if (stats.activeDays === 0) return 0;
      const ratio = (stats.totalCheckins / stats.activeDays) * 100;
      return Math.round(ratio);
    };
  });

  function formatDayLabel(value: string): string {
    const parts = value.split("-");
    return parts[2]?.replace(/^0/, "") ?? value;
  }

  function getDayStatusClass(date: Date): string {
    return getPlanDayStatusClass(selectedPlanId.value, date);
  }

  function getDayStatusStyle(date: Date): string {
    const statusCode = getTimeProgress(selectedPlanId.value, date);
    return '--progress: ' + (statusCode * 100) + '%;';
  }
  function getPlanTimeLength(planId: number): number {
    const plan = PlansItems.value.find((x) => x.id === planId);
    return plan?.timeSlots?.length ?? 0;
  }
  watch(checkinDate, (newDate) => {
    console.log("checkinDate changed:", newDate);
    if (!selectedPlanId.value) return;
    useCheckinsStore().loadCalendar(selectedPlanId.value, newDate.getFullYear(), newDate.getMonth() + 1);
  });
  return {
    // 响应式数据
    currentYear,
    currentMonth,
    selectedPlanId,
    checkinDate,
    selectedPlan,

    // 计算属性
    monthDays,
    miniCalendarCells,
    monthStatsByPlan,
    progressPercentByPlan,

    // 方法
    toLocalDateOnlyString,
    parseDateOnly,
    isInPlanRangeForPlan,

    getPlanTimeLength,
    getPlanDayStatusClass,
    getMiniDayClassForPlan,
    formatDayLabel,
    getDayStatusClass,
    getDayStatusStyle
  };
}
