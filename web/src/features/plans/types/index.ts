export interface TimeSlotDto {
  id: number;
  slotName?: string;
  startTime: string; // HH:mm:ss
  endTime: string; // HH:mm:ss
  orderNum?: number;
  isActive?: boolean;
}

export interface PlanSummary {
  id: number;
  title: string;
  checkinMode: number;
  description: string | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  timeSlots?: TimeSlotDto[];
}

export interface PlanPayload {
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  timeSlots?: TimeSlotDto[];
}
export interface UpdatePlan extends PlanPayload {
  id: number;
  isActive: boolean;
}
