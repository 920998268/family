import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TravelPlan, TravelStatus } from '@/types/models';
import type { TravelPlanDraft, TravelPlanPatch } from '@/services/TravelService';
import { createTravelService } from '@/services';

export const useTravelStore = defineStore('travel', () => {
  const plans = ref<TravelPlan[]>([]);
  const loaded = ref(false);

  function load(): void {
    plans.value = createTravelService().list();
    loaded.value = true;
  }

  function add(draft: TravelPlanDraft): TravelPlan {
    const plan = createTravelService().add(draft);
    load();
    return plan;
  }

  function update(id: string, patch: TravelPlanPatch): TravelPlan {
    const plan = createTravelService().update(id, patch);
    load();
    return plan;
  }

  function setStatus(id: string, status: TravelStatus): TravelPlan {
    const plan = createTravelService().setStatus(id, status);
    load();
    return plan;
  }

  function toggleItem(planId: string, itemId: string): TravelPlan {
    const plan = createTravelService().toggleItem(planId, itemId);
    load();
    return plan;
  }

  function remove(id: string): void {
    createTravelService().remove(id);
    load();
  }

  return {
    plans,
    loaded,
    load,
    add,
    update,
    setStatus,
    toggleItem,
    remove,
  };
});
