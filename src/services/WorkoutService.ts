import type { WorkoutCategory, WorkoutEntry, WorkoutSet } from '@/types/models';
import { createId } from '@/utils/id';
import { validateWorkoutEntry } from '@/utils/validation';
import { normalizeWorkoutCategory } from '@/utils/workout';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';

export type WorkoutSetDraft = Omit<WorkoutSet, 'id' | 'order'>;
export type WorkoutDraft = {
  /** 动作名（有氧时是项目名，如「跑步」） */
  exerciseName: string;
  /**
   * 运动类型。缺省时按「有组明细 = 力量」推断，兼容既有调用方（表单 / 测试）。
   *
   * ⚠️ 有氧**必须**显式传 `cardio` 并给出 `durationMin`：否则缺省推断得到的
   * 力量分支会因「一组都没有」而校验失败，有氧记录根本建不出来。
   */
  category?: WorkoutCategory;
  /** 组明细：力量至少一组；有氧传空数组 */
  sets: WorkoutSetDraft[];
  /** 有氧：时长（分钟，必填） */
  durationMin?: number;
  /** 有氧：距离（公里，选填） */
  distanceKm?: number;
  /** 消耗热量（千卡，选填；力量与有氧通用） */
  calories?: number;
  memberId?: string;
};
export type WorkoutPatch = Partial<WorkoutDraft>;

/**
 * 按类型归一化记录形态，与云端 `validateWorkoutPayload` 的分支**保持一致**：
 * 力量只保留组明细（清掉有氧字段），有氧只保留时长 / 距离（清掉组明细）。
 *
 * 两边形态一致才不会出现「本地存着时长、推上云变成 null」这类静默偏差。
 */
function applyCategory(entry: WorkoutEntry, sets: WorkoutSet[]): WorkoutEntry {
  const category = normalizeWorkoutCategory({ category: entry.category, sets });

  if (category === 'cardio') {
    return {
      ...entry,
      category,
      sets: [],
      durationMin: entry.durationMin,
      distanceKm: entry.distanceKm,
    };
  }

  return {
    ...entry,
    category,
    sets,
    durationMin: undefined,
    distanceKm: undefined,
  };
}

export class WorkoutService {
  constructor(private readonly repository: WorkoutRepository) {}

  listByDate(date: string): WorkoutEntry[] {
    return this.repository.getByDate(date);
  }

  getAll(): WorkoutEntry[] {
    return this.repository.getAll();
  }

  add(date: string, draft: WorkoutDraft): WorkoutEntry {
    const entry = applyCategory(
      {
        id: createId('workout'),
        date,
        category: draft.category,
        exerciseName: draft.exerciseName,
        sets: [],
        durationMin: draft.durationMin,
        distanceKm: draft.distanceKm,
        calories: draft.calories,
        memberId: draft.memberId,
      },
      normalizeSets(draft.sets),
    );

    const result = validateWorkoutEntry(entry);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    const entries = this.repository.getByDate(date);
    entries.push(entry);
    this.repository.saveByDate(date, entries);
    return entry;
  }

  update(date: string, id: string, patch: WorkoutPatch): WorkoutEntry {
    const entries = this.repository.getByDate(date);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      throw new Error('未找到要编辑的训练记录');
    }

    const existing = entries[index];
    const merged: WorkoutEntry = {
      // 保留既有语义：显式传 undefined 同样能清空字段（交由展开运算符处理）
      ...existing,
      ...patch,
      id,
      date,
      // 放在展开之后覆盖：未改组明细时保留原 id / order，改过才重新规范化
      sets: patch.sets ? normalizeSets(patch.sets) : existing.sets,
    };
    const nextEntry = applyCategory(merged, merged.sets);

    const result = validateWorkoutEntry(nextEntry);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    entries[index] = nextEntry;
    this.repository.saveByDate(date, entries);
    return nextEntry;
  }

  remove(date: string, id: string): void {
    const entries = this.repository.getByDate(date);
    const nextEntries = entries.filter((entry) => entry.id !== id);
    if (nextEntries.length === entries.length) {
      throw new Error('未找到要删除的训练记录');
    }

    this.repository.saveByDate(date, nextEntries);
  }
}

function normalizeSets(sets: WorkoutSetDraft[]): WorkoutSet[] {
  return sets.map((set, index) => ({
    id: createId('set'),
    order: index + 1,
    reps: set.reps,
    weightKg: set.weightKg,
  }));
}
