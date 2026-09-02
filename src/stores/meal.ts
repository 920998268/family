import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { MealPlan } from '@/types/models';
import type { MealPlanDraft, MealPlanPatch } from '@/services/MealService';
import { createMealService } from '@/services';

export const useMealStore = defineStore('meal', () => {
  const plans = ref<MealPlan[]>([]);
  const loadedDate = ref<string | null>(null);

  function load(date: string): void {
    plans.value = createMealService().listByDate(date);
    loadedDate.value = date;
  }

  function add(date: string, draft: MealPlanDraft): MealPlan {
    const plan = createMealService().add(date, draft);
    load(date);
    return plan;
  }

  function update(date: string, id: string, patch: MealPlanPatch): MealPlan {
    const plan = createMealService().update(date, id, patch);
    load(date);
    return plan;
  }

  function remove(date: string, id: string): void {
    createMealService().remove(date, id);
    load(date);
  }

  function doneCount(date: string): number {
    const items = createMealService().listByDate(date);
    return items.filter((plan) => plan.done).length;
  }

  return {
    plans,
    loadedDate,
    load,
    add,
    update,
    remove,
    doneCount,
  };
});
