import type { TravelItem, TravelPlan, TravelStatus } from '@/types/models';
import { createId } from '@/utils/id';
import { validateTravelPlan } from '@/utils/validation';
import { TravelRepository } from '@/repositories/TravelRepository';

export type TravelItemDraft = Omit<TravelItem, 'id'>;
export type TravelPlanDraft = Omit<TravelPlan, 'id' | 'items'> & {
  items: TravelItemDraft[];
};
export type TravelPlanPatch = Partial<
  Omit<TravelPlan, 'id' | 'items'> & { items: TravelItemDraft[] }
>;

function normalizeItems(items: TravelItemDraft[]): TravelItem[] {
  return items.map((item) => ({
    id: createId('trip'),
    time: item.time,
    activity: item.activity,
    note: item.note,
    done: item.done,
  }));
}

export class TravelService {
  constructor(private readonly repository: TravelRepository) {}

  list(): TravelPlan[] {
    return [...this.repository.getAll()].sort((a, b) =>
      b.startDate.localeCompare(a.startDate),
    );
  }

  add(draft: TravelPlanDraft): TravelPlan {
    const plan: TravelPlan = {
      ...draft,
      id: createId('travel'),
      items: normalizeItems(draft.items),
    };
    const result = validateTravelPlan(plan);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    const plans = this.repository.getAll();
    plans.push(plan);
    this.repository.saveAll(plans);
    return plan;
  }

  update(id: string, patch: TravelPlanPatch): TravelPlan {
    const plans = this.repository.getAll();
    const index = plans.findIndex((plan) => plan.id === id);
    if (index === -1) {
      throw new Error('未找到要编辑的出行计划');
    }

    const existing = plans[index];
    const nextPlan: TravelPlan = {
      ...existing,
      ...patch,
      id,
      items: patch.items ? normalizeItems(patch.items) : existing.items,
    };
    const result = validateTravelPlan(nextPlan);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    plans[index] = nextPlan;
    this.repository.saveAll(plans);
    return nextPlan;
  }

  setStatus(id: string, status: TravelStatus): TravelPlan {
    return this.update(id, { status });
  }

  toggleItem(planId: string, itemId: string): TravelPlan {
    const plans = this.repository.getAll();
    const index = plans.findIndex((plan) => plan.id === planId);
    if (index === -1) {
      throw new Error('未找到要编辑的出行计划');
    }

    const plan = plans[index];
    const items = plan.items.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item,
    );
    return this.update(planId, { items });
  }

  remove(id: string): void {
    const plans = this.repository.getAll();
    const nextPlans = plans.filter((plan) => plan.id !== id);
    if (nextPlans.length === plans.length) {
      throw new Error('未找到要删除的出行计划');
    }
    this.repository.saveAll(nextPlans);
  }
}
