import type { WorkoutCategory, WorkoutEntry } from '@/types/models';
import { isWorkoutCategory } from '@/utils/storageKeys';

type Categorizable = Pick<WorkoutEntry, 'category' | 'sets'>;

function hasSets(entry: Categorizable): boolean {
  return Array.isArray(entry.sets) && entry.sets.length > 0;
}

/**
 * 归一化运动类型。
 *
 * ⚠️ 关键兼容逻辑：0.3.2 之前的训练记录没有 `category` 字段，
 * 此时按「有组明细 = 力量」推断。绝不能因为缺省就把记录判为非法——
 * 那样 `parseStoredArray` 会在读取时静默丢弃用户的历史训练数据。
 */
export function normalizeWorkoutCategory(entry: Categorizable): WorkoutCategory {
  if (isWorkoutCategory(entry.category)) {
    return entry.category;
  }
  return hasSets(entry) ? 'strength' : 'cardio';
}

/** 该记录是否为有氧（兼容老数据） */
export function isCardioEntry(entry: Categorizable): boolean {
  return normalizeWorkoutCategory(entry) === 'cardio';
}

/** 补齐 `category` 字段，把本地缓存 / 云端返回的记录统一成同一形态 */
export function withWorkoutCategory(entry: WorkoutEntry): WorkoutEntry {
  return { ...entry, category: normalizeWorkoutCategory(entry) };
}
