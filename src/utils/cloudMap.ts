import type {
  DietEntry,
  FavoriteFood,
  MealType,
  WorkoutEntry,
  WorkoutSet,
} from '@/types/models';
import { isMealType, isWorkoutCategory } from '@/utils/storageKeys';
import { normalizeWorkoutCategory } from '@/utils/workout';
import {
  validateDietEntry,
  validateFavoriteFood,
  validateWorkoutEntry,
} from '@/utils/validation';

/**
 * 前端模型 ↔ 云函数记录 的双向映射（纯函数，可单元测试）。
 *
 * 为什么必须单独一层：
 * 1. **改名**：前端用 `id` 标识记录，云端幂等键叫 `clientId`，换名集中在此，避免散落各处；
 * 2. **`null` ↔ `undefined`**：云端把「未填写」统一存成 `null`，而前端校验器
 *    （`numberError`）把 `null` 判为非法数值 —— 下行时若不还原成 `undefined`，
 *    云端回来的记录会被本地 Repository 静默丢弃；
 * 3. **序列化丢键**：`callFunction` 走 JSON，`undefined` 键会被丢掉，
 *    上行时必须显式写 `null` 才能表达「用户清空了这个字段」。
 */

/**
 * 上行：前端记录 → `diet` 云函数入参（`clientId` 即前端 `id`）。
 *
 * ⚠️ 必须用 `type` 而不是 `interface`：TypeScript 只为对象**类型别名**推导隐式索引签名，
 * 而 `callDiet(action, payload: Record<string, unknown>)` 要求可索引。换成 `interface` 会报 TS2345。
 */
export type CloudDietPayload = {
  clientId: string;
  date: string;
  mealType: MealType;
  foodName: string;
  quantity: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  memberId: string | null;
};

/** 上行：前端记录 → `workout` 云函数入参（同样必须用 `type`，原因见上） */
export type CloudWorkoutPayload = {
  clientId: string;
  date: string;
  category: string;
  exerciseName: string;
  sets: WorkoutSet[];
  durationMin: number | null;
  distanceKm: number | null;
  calories: number | null;
  memberId: string | null;
};

/** 可选数值：`undefined` / `null` / 空串一律上行为 null（显式清空） */
function upNumber(value: number | undefined): number | null {
  return value === undefined || value === null ? null : value;
}

/** 可选字符串：空值上行为 null（云端 `normalizeOptionalId` 同样归一到 null） */
function upId(value: string | undefined): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** 安全取字符串（下行容错：类型不对一律当空串，绝不抛出） */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 下行可选数值：`null` / 空串 / 非数字 → `undefined`。
 *
 * ⚠️ 这里必须返回 `undefined` 而不是 `null`：前端 `validateDietEntry` 只在
 * `fieldValue !== undefined` 时才校验数值，传 `null` 会直接判为「必须是数字」而丢失整条记录。
 */
function downNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/** 逐行映射并丢弃非法行（重复前端 Repository 的同一套校验，防止脏数据写入本地缓存） */
function mapRows<T>(
  rows: unknown,
  mapOne: (row: Record<string, unknown>) => T,
  isValid: (value: unknown) => boolean,
  label: string,
): T[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  const out: T[] = [];
  let dropped = 0;

  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      dropped += 1;
      continue;
    }
    const mapped = mapOne(row as Record<string, unknown>);
    if (isValid(mapped)) {
      out.push(mapped);
    } else {
      dropped += 1;
    }
  }

  if (dropped > 0) {
    console.warn(`[cloudMap] ${label}：丢弃 ${dropped} 条不合法记录`);
  }

  return out;
}

/** 前端饮食记录 → `diet` 云函数入参 */
export function toCloudDiet(entry: DietEntry): CloudDietPayload {
  return {
    clientId: entry.id,
    date: entry.date,
    mealType: entry.mealType,
    foodName: entry.foodName,
    quantity: entry.quantity,
    calories: upNumber(entry.calories),
    protein: upNumber(entry.protein),
    carbs: upNumber(entry.carbs),
    fat: upNumber(entry.fat),
    memberId: upId(entry.memberId),
  };
}

/**
 * 前端运动记录 → `workout` 云函数入参。
 *
 * `category` 经 `normalizeWorkoutCategory` 归一：老记录（无 `category`）在本地
 * 也可能被更新后重传，归一后云端能拿到明确类型，不会退化成回推。
 * `sets` 恒为数组：有氧上传空数组（云端以「数组非空」判定形态矛盾）。
 */
export function toCloudWorkout(entry: WorkoutEntry): CloudWorkoutPayload {
  const sets = Array.isArray(entry.sets) ? entry.sets : [];
  return {
    clientId: entry.id,
    date: entry.date,
    category: normalizeWorkoutCategory({ category: entry.category, sets }),
    exerciseName: entry.exerciseName,
    sets,
    durationMin: upNumber(entry.durationMin),
    distanceKm: upNumber(entry.distanceKm),
    calories: upNumber(entry.calories),
    memberId: upId(entry.memberId),
  };
}

/** 云端记录 → 前端 `DietEntry`（同时兼容服务端 `toClientDiet` 形态与裸库文档） */
export function fromCloudDiet(row: unknown): DietEntry {
  const doc = (row || {}) as Record<string, unknown>;

  return {
    id: asString(doc.id) || asString(doc.clientId) || asString(doc._id),
    date: asString(doc.date),
    mealType: isMealType(doc.mealType) ? doc.mealType : 'breakfast',
    foodName: asString(doc.foodName),
    quantity: asString(doc.quantity),
    calories: downNumber(doc.calories),
    protein: downNumber(doc.protein),
    carbs: downNumber(doc.carbs),
    fat: downNumber(doc.fat),
    memberId: asString(doc.memberId) || undefined,
  };
}

/**
 * 云端记录 → 前端 `WorkoutEntry`。
 *
 * `order` 一律按数组下标重排（不信任线上传来的顺序，也不信任 `order` 字段本身），
 * 这样产出物才满足前端 `validateWorkoutEntry` 的「序号必须连续」约束。
 */
export function fromCloudWorkout(row: unknown): WorkoutEntry {
  const doc = (row || {}) as Record<string, unknown>;
  const rawSets = Array.isArray(doc.sets) ? doc.sets : [];

  const sets: WorkoutSet[] = rawSets.map((item, index) => {
    const set = (item || {}) as Record<string, unknown>;
    return {
      id: asString(set.id) || `set-${index + 1}`,
      order: index + 1,
      reps: downNumber(set.reps) ?? 0,
      weightKg: downNumber(set.weightKg) ?? 0,
    };
  });

  // 老记录（0.3.2 之前）没有 category：按「有组明细 = 力量」推断，绝不判为非法
  const category = isWorkoutCategory(doc.category)
    ? doc.category
    : normalizeWorkoutCategory({ sets });

  return {
    id: asString(doc.id) || asString(doc.clientId) || asString(doc._id),
    date: asString(doc.date),
    category,
    exerciseName: asString(doc.exerciseName),
    sets,
    durationMin: downNumber(doc.durationMin),
    distanceKm: downNumber(doc.distanceKm),
    calories: downNumber(doc.calories),
    memberId: asString(doc.memberId) || undefined,
  };
}

/**
 * 云端记录 → 前端 `FavoriteFood`。
 *
 * 注意：`quantity` 为空的记录会被 `validateFavoriteFood` 拦下（前端要求数量非空）——
 * 这是刻意的：常用食物的一键带出必须包含数量，没有数量的条目没有使用价值。
 */
export function fromCloudFood(row: unknown): FavoriteFood {
  const doc = (row || {}) as Record<string, unknown>;

  return {
    id: asString(doc.id) || asString(doc._id) || asString(doc.name),
    name: asString(doc.name),
    quantity: asString(doc.quantity),
    calories: downNumber(doc.calories),
    protein: downNumber(doc.protein),
    carbs: downNumber(doc.carbs),
    fat: downNumber(doc.fat),
    useCount: downNumber(doc.useCount) ?? 0,
    lastUsedAt: downNumber(doc.lastUsedAt),
  };
}

/** 云端饮食列表 → 前端数组（非数组入参返回空数组） */
export function mapCloudDiets(rows: unknown): DietEntry[] {
  return mapRows(rows, fromCloudDiet, (v) => validateDietEntry(v).valid, 'diets');
}

/** 云端运动列表 → 前端数组 */
export function mapCloudWorkouts(rows: unknown): WorkoutEntry[] {
  return mapRows(rows, fromCloudWorkout, (v) => validateWorkoutEntry(v).valid, 'workouts');
}

/** 云端常用食物列表 → 前端数组 */
export function mapCloudFoods(rows: unknown): FavoriteFood[] {
  return mapRows(rows, fromCloudFood, (v) => validateFavoriteFood(v).valid, 'favorite_foods');
}
