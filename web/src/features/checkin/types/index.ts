import type { TimeSlotDto } from "@/features/plans/types";
export interface CalendarItem {
  date: string;
  status: number;
  checkinMode: number;
  timeSlots: TimeSlotDto[];
}

export interface CheckinDetail {
  id: number;
  date: string;
  status: number;
  note?: string;
  imageUrls: string[];
  timeSlotId?: number;
}
export interface CheckinRecord {
  planId: number;
  imageUrls?: string[];
  note?: string;
  timeSlotId?: number;
}
export interface RetroCheckinRecord extends CheckinRecord {
  date: string;
}
export type CheckinStatus =
  | "done" // 已打卡
  | "missed" //未打卡
  | "made" // 已补卡
  | "future" //未开始
  | "pending"; //进行中
