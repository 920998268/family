import type { DietEntry, FavoriteFood, TravelPlan, WorkoutEntry } from '@/types/models';
import { MEAL_LABELS, TRAVEL_STATUS_LABELS, WORKOUT_CATEGORY_LABELS } from '@/types/models';
import { formatDateKey } from '@/utils/date';
import { isCardioEntry, normalizeWorkoutCategory } from '@/utils/workout';

/** 只关心营养四项的形态：饮食记录与常用食物都能传进来 */
type NutritionLike = Pick<DietEntry, 'calories' | 'protein' | 'carbs' | 'fat'>;

export function mealLabel(entry: DietEntry): string {
  return MEAL_LABELS[entry.mealType];
}

export function nutritionText(entry: NutritionLike): string {
  return [
    nutritionPart(entry.calories, '热量', ' 千卡'),
    nutritionPart(entry.protein, '蛋白质', 'g'),
    nutritionPart(entry.carbs, '碳水', 'g'),
    nutritionPart(entry.fat, '脂肪', 'g'),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function workoutText(entry: WorkoutEntry): string {
  // 有氧记录没有组明细，展示「时长 · 距离 · 消耗热量」
  if (isCardioEntry(entry)) {
    return [
      entry.durationMin === undefined ? '' : `${entry.durationMin} 分钟`,
      entry.distanceKm === undefined ? '' : `${entry.distanceKm} 公里`,
      entry.calories === undefined ? '' : `${entry.calories} 千卡`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  return entry.sets
    .map((set) => `${set.weightKg}kg × ${set.reps}`)
    .join(' / ');
}

/**
 * 列表副标题。
 *
 * 力量记录在最前面补一个组数汇总（「3 组 · 60kg × 8 / ...」）——
 * 组明细一串数字扫过去不容易看出练了几组，有氧记录本身就是时长 / 距离，无需再汇总。
 */
export function workoutSummary(entry: WorkoutEntry): string {
  if (isCardioEntry(entry)) {
    return workoutText(entry);
  }

  const detail = workoutText(entry);
  return detail ? `${entry.sets.length} 组 · ${detail}` : `${entry.sets.length} 组`;
}

/** 运动类型标签（力量 / 有氧），列表里与副标题拼成一行 */
export function workoutCategoryLabel(entry: WorkoutEntry): string {
  return WORKOUT_CATEGORY_LABELS[normalizeWorkoutCategory(entry)];
}

/** 常用食物摘要：数量 + 营养，让用户在一键带出前就知道会填进去什么 */
export function favoriteFoodText(food: FavoriteFood): string {
  return [food.quantity, nutritionText(food)].filter(Boolean).join(' · ');
}

function nutritionPart(
  value: number | undefined,
  label: string,
  unit: string,
): string {
  return value === undefined ? '' : `${label} ${value}${unit}`;
}

export function formatMoney(amount: number): string {
  return `¥${amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function travelDateRange(plan: TravelPlan): string {
  if (plan.startDate === plan.endDate) {
    return formatDateKey(plan.startDate);
  }
  return `${formatDateKey(plan.startDate)} 至 ${formatDateKey(plan.endDate)}`;
}

export function travelStatusLabel(plan: TravelPlan): string {
  return TRAVEL_STATUS_LABELS[plan.status];
}

