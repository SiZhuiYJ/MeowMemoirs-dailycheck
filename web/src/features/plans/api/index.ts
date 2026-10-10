// @/libs/api/auth/index.ts
import http from "@/libs/http";
import type { PlanSummary, PlanPayload, UpdatePlan } from "../types";

export const plansApi = {
  async getPlans() {
    return await http.get<PlanSummary[]>("/mm/plans");
  },
  async CreatePlan(data: PlanPayload) {
    return await http.post<PlanSummary>("/mm/plans", data);
  },
  async UpdatePlan(data: UpdatePlan) {
    return await http.put(`/mm/plans/${data.id}`, data);
  },
  async deletePlan(id: number) {
    return await http.delete(`/mm/plans/${id}`);
  },
};
