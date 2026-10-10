import { defineStore } from 'pinia';
import http from '@/libs/http/config';

export interface TimeSlotDto {
  id?: number;
  slotName?: string;
  startTime: string; // HH:mm:ss
  endTime: string; // HH:mm:ss
  orderNum?: number;
  isActive?: boolean;
}

export interface PlanSummary {
  id: number;
  title: string;
  description: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  timeSlots?: TimeSlotDto[];
}

interface PlansState {
  items: PlanSummary[];
  loading: boolean;
}

export const usePlansStore = defineStore('plans', {
  state: (): PlansState => ({
    items: [],
    loading: false,
  }),
  actions: {
    async fetchMyPlans(): Promise<void> {
      this.loading = true;
      try {
        const response = await http.get<PlanSummary[]>('/mm/plans');
        this.items = response.data;
      } finally {
        this.loading = false;
      }
    },
    async createPlan(payload: {
      title: string;
      description?: string;
      startDate?: string | null;
      endDate?: string | null;
      timeSlots?: TimeSlotDto[];
    }): Promise<PlanSummary> {
      const response = await http.post<PlanSummary>('/mm/plans', payload);
      const created = response.data;
      this.items.push(created);
      return created;
    },
    async updatePlan(payload: {
      id: number;
      title?: string;
      description?: string;
      startDate?: string | null;
      endDate?: string | null;
      isActive: boolean;
      timeSlots?: TimeSlotDto[];
    }): Promise<void> {
      await http.put(`/mm/plans/${payload.id}`, payload);
      // Ideally we should just refetch to get updated server state (especially IDs for new time slots)
      await this.fetchMyPlans();
    },
    async deletePlan(id: number): Promise<void> {
      await http.delete(`/mm/plans/${id}`);
      const index = this.items.findIndex((x) => x.id === id);
      if (index !== -1) {
        this.items.splice(index, 1);
      }
    },
  },
});
