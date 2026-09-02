import type { MealPlan, MealType } from '@/types/models';
import { MEAL_TYPES } from '@/types/models';
import { createId } from '@/utils/id';
import { validateMealPlan } from '@/utils/validation';
import { MealPlanRepository } from '@/repositories/MealPlanRepository';

export type MealPlanDraft = Omit<MealPlan, 'id' | 'date'>;
export type MealPlanPatch = Partial<Omit<MealPlan, 'id' | 'date'>>;

const SLOT_ORDER: ReadonlyMap<MealType, number> = new Map(
  MEAL_TYPES.map((item, index) => [item.value, index] as const),
);

function sortBySlot(plans: MealPlan[]): MealPlan[] {
  return [...plans].sort((a, b) => {
    const aOrder = SLOT_ORDER.get(a.slot) ?? 0;
    const bOrder = SLOT_ORDER.get(b.slot) ?? 0;
    return aOrder - bOrder;
  });
}

export class MealService {
  constructor(private readonly repository: MealPlanRepository) {}

  listByDate(date: string): MealPlan[] {
    return sortBySlot(this.repository.getByDate(date));
  }

  getAll(): MealPlan[] {
    return sortBySlot(this.repository.getAll());
  }

  add(date: string, draft: MealPlanDraft): MealPlan {
    const plan: MealPlan = { ...draft, id: createId('meal'), date };
    const result = validateMealPlan(plan);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    const plans = this.repository.getByDate(date);
    plans.push(plan);
    this.repository.saveByDate(date, plans);
    return plan;
  }

  update(date: string, id: string, patch: MealPlanPatch): MealPlan {
    const plans = this.repository.getByDate(date);
    const index = plans.findIndex((plan) => plan.id === id);
    if (index === -1) {
      throw new Error('未找到要编辑的食谱计划');
    }

    const nextPlan: MealPlan = { ...plans[index], ...patch, id, date };
    const result = validateMealPlan(nextPlan);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    plans[index] = nextPlan;
    this.repository.saveByDate(date, plans);
    return nextPlan;
  }

  remove(date: string, id: string): void {
    const plans = this.repository.getByDate(date);
    const nextPlans = plans.filter((plan) => plan.id !== id);
    if (nextPlans.length === plans.length) {
      throw new Error('未找到要删除的食谱计划');
    }
    this.repository.saveByDate(date, nextPlans);
  }
}
