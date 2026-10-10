import { defineStore } from "pinia";

import { plansApi } from "../api";
import type {
  PlanSummary,
  PlanPayload,
  UpdatePlan,
} from "../types";

export const usePlansStore = defineStore("plans", () => {
  const PlansItems = ref<PlanSummary[]>([]);
  const loading = ref<boolean>(false);

  async function fetchMyPlans(): Promise<void> {
    loading.value = true;
    try {
      const response = await plansApi.getPlans();
      PlansItems.value = response.data;
    } finally {
      loading.value = false;
    }
  }

  async function createPlan(payload: PlanPayload): Promise<PlanSummary> {
    const response = await plansApi.CreatePlan(payload);
    const created = response.data;
    PlansItems.value.push(created);
    return created;
  }

  async function updatePlan(payload: UpdatePlan): Promise<void> {
    await plansApi.UpdatePlan(payload);
    await fetchMyPlans();
  }

  async function deletePlan(id: number): Promise<void> {
    await plansApi.deletePlan(id);
    const index = PlansItems.value.findIndex((x) => x.id === id);
    if (index !== -1) {
      PlansItems.value.splice(index, 1);
    }
  }

  return {
    PlansItems,
    loading,
    fetchMyPlans,
    createPlan,
    updatePlan,
    deletePlan,
  };
});
