// @/libs/api/checkin/index.ts
import http from "@/libs/http";
import type {
  CalendarItem,
  CheckinDetail,
  CheckinRecord,
  RetroCheckinRecord,
} from "../types";

export const checkinApi = {
  async loadCalendar(data: {
    planId: number; year: number; month: number;
  }) {
    console.log("loadCalendar", data);
    return await http.get<CalendarItem[]>(`/mm/checkins/plans/${data.planId}/calendar`, { year: data.year, month: data.month });
  },
  async Checkin(data: CheckinRecord) {
    return await http.post("/mm/checkins", data);
  },
  async RetroCheckin(data: RetroCheckinRecord) {
    return http.post("/mm/checkins/backfill", data);
  },
  async GetCheckinDetail(data: { planId: number; date: string }) {
    return await http.get<CheckinDetail[]>(`/mm/checkins/plans/${data.planId}/details`, { date: data.date });
  },
};
