import type { TravelItem, TravelPlan, TravelStatus } from '@/types/models';
import { createId } from '@/utils/id';
import { normalizeTravelItems, normalizeTravelMembers, type TravelItemInput } from '@/utils/travel';
import { validateTravelPlan } from '@/utils/validation';
import { TravelRepository } from '@/repositories/TravelRepository';

/**
 * 明细草稿。可带已有 id（编辑既有明细行），也可不带（新增行）。
 *
 * 由 `src/utils/travel.ts` 定义并在此转出，保持既有引用路径不变
 *（`src/stores/travel.ts` 等从这里 import）。
 */
export type TravelItemDraft = TravelItemInput;
export type TravelPlanDraft = Omit<TravelPlan, 'id' | 'items'> & {
  items: TravelItemDraft[];
};
export type TravelPlanPatch = Partial<
  Omit<TravelPlan, 'id' | 'items'> & { items: TravelItemDraft[] }
>;

/**
 * 明细归一化。
 *
 * ⚠️ 改造要点（M3 第 2 步）：**保留草稿里已有的 id**，只为新行生成。
 * 旧实现无条件给全部明细重新生成 id，导致任何一次计划编辑之后
 * `toggleItem` 拿到的 id 立即失效 —— 纯本地场景看不出来，
 * 但云端按明细记录读写完全依赖稳定 id。
 */
function normalizeItems(items: TravelItemDraft[]): TravelItem[] {
  return normalizeTravelItems(items);
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
      members: normalizeTravelMembers(draft.members),
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
      members: patch.members ? normalizeTravelMembers(patch.members) : existing.members,
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
