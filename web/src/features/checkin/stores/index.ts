import { defineStore } from "pinia";
import { checkinApi } from "../api";
import type {
  CalendarItem,
  CheckinDetail,
  CheckinRecord,
  RetroCheckinRecord,
} from "../types";


export const useCheckinsStore = defineStore("checkins", () => {
  const calendar = ref<CalendarItem[]>([]);
  const calendarByPlan = ref<Record<number, CalendarItem[]>>({});

  async function loadCalendar(
    planId: number,
    year: number,
    month: number,
  ): Promise<void> {
    const response = await checkinApi.loadCalendar({
      planId, year, month,
    });
    calendar.value = response.data;
    calendarByPlan.value[planId] = response.data;
  }

  async function dailyCheckin(payload: CheckinRecord): Promise<void> {
    await checkinApi.Checkin(payload);
  }

  async function retroCheckin(payload: RetroCheckinRecord): Promise<void> {
    await checkinApi.RetroCheckin(payload);
  }

  async function getCheckinDetail(
    planId: number,
    date: string,
  ): Promise<CheckinDetail[]> {
    const response = await checkinApi.GetCheckinDetail({
      planId, date,
    });
    return response.data;
  }

  return {
    calendar,
    calendarByPlan,
    loadCalendar,
    dailyCheckin,
    retroCheckin,
    getCheckinDetail,
  };
});
