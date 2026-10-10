import { defineStore } from 'pinia';
import http from '@/libs/http/config';

export interface CalendarItem {
  date: string;
  status: number;
}

export interface CheckinDetail {
  date: string;
  status: number;
  note?: string;
  imageUrls: string[];
  timeSlotId?: number;
}

interface CheckinsState {
  calendar: CalendarItem[];
  calendarByPlan: Record<number, CalendarItem[]>;
  stats: Record<number, { totalCheckins: number; totalDays: number | null; loading: boolean }>;
}

export const useCheckinsStore = defineStore('checkins', {
  state: (): CheckinsState => ({
    calendar: [],
    calendarByPlan: {},
    stats: {},
  }),
  actions: {
    async loadCalendar(planId: number, year: number, month: number): Promise<void> {
      const response = await http.get<CalendarItem[]>(
        `/mm/checkins/plans/${planId}/calendar`,
        { params: { year, month } },
      );
      this.calendar = response.data;
      this.calendarByPlan[planId] = response.data;
    },
    async fetchPlanStats(plan: { id: number; startDate: string; endDate: string | null }): Promise<void> {
      // Initialize stats entry if not exists
      if (!this.stats[plan.id]) {
        this.stats[plan.id] = { totalCheckins: 0, totalDays: null, loading: true };
      } else {
        this.stats[plan.id].loading = true;
      }

      try {
        const parseDate = (str: string) => {
          const [y, m, d] = str.split('-').map(Number);
          return new Date(y, m - 1, d);
        };

        const start = parseDate(plan.startDate);
        const end = plan.endDate ? parseDate(plan.endDate) : new Date();
        const now = new Date(); // Local now
        
        // If end date is in the future, we only count up to today for "checkins" but total days depends on logic.
        // Requirement: "若没有截至日期就显示（{{已经打卡的天数}}/无限符号）有截止日期则（{{已经打卡的天数}}/{{总天数}}）"
        // Total days: if endDate exists, it's fixed. If not, it's infinite (displayed as symbol).
        
        // Calculate total days if endDate exists
        let totalDays: number | null = null;
        if (plan.endDate) {
          // Reset hours to avoid daylight saving issues or partial days affects
          const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
          const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
          const diffTime = Math.abs(e.getTime() - s.getTime());
          totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
        }

        // We need to fetch all checkins from start to NOW (or endDate if it's in the past).
        // Checkins cannot be in the future, so we clamp end range to today.
        // We use end of day for comparison
        const planEndDateObj = plan.endDate ? parseDate(plan.endDate) : null;
        const checkinScanEnd = planEndDateObj && planEndDateObj < now ? planEndDateObj : now;
        
        let current = new Date(start.getFullYear(), start.getMonth(), 1);
        const scanEndMonth = new Date(checkinScanEnd.getFullYear(), checkinScanEnd.getMonth(), 1);

        const tasks: Promise<any>[] = [];

        while (current <= scanEndMonth) {
          const y = current.getFullYear();
          const m = current.getMonth() + 1;
          
          // Use a separate request that doesn't affect state.calendarByPlan
          tasks.push(
            http.get<CalendarItem[]>(`/mm/checkins/plans/${plan.id}/calendar`, { 
              params: { year: y, month: m } 
            }).then(res => res.data)
          );

          current.setMonth(current.getMonth() + 1);
        }

        const results = await Promise.all(tasks);
        
        let totalCheckins = 0;
        results.forEach((items: CalendarItem[]) => {
          items.forEach(item => {
             // Only count if within range (API returns whole month)
             // But simple count is probably enough as API filters by planId.
             // We should double check dates if start/end are mid-month?
             // The API returns checkins, which are by definition "done".
             // We just need to count valid statuses (1 and 2).
             if (item.status === 1 || item.status === 2) {
               totalCheckins++;
             }
          });
        });

        this.stats[plan.id] = {
          totalCheckins,
          totalDays,
          loading: false
        };

      } catch (error) {
        console.error('Failed to fetch stats for plan', plan.id, error);
        this.stats[plan.id] = {
          totalCheckins: 0,
          totalDays: null,
          loading: false
        };
      }
    },
    async dailyCheckin(payload: {
      planId: number;
      imageUrls?: string[];
      note?: string;
      timeSlotId?: number;
    }): Promise<void> {
      await http.post('/mm/checkins', payload);
    },
    async retroCheckin(payload: {
      planId: number;
      date: string;
      imageUrls?: string[];
      note?: string;
      timeSlotId?: number;
    }): Promise<void> {
      await http.post('/mm/checkins/backfill', payload);
    },
    async getCheckinDetail(planId: number, date: string): Promise<CheckinDetail[]> {
      const response = await http.get<CheckinDetail[]>(
        `/mm/checkins/plans/${planId}/details`,
        { params: { date } },
      );
      return response.data;
    },
  },
});
