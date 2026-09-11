import type { DietEntry, TravelPlan, WorkoutEntry } from '@/types/models';
import { MEAL_LABELS, TRAVEL_STATUS_LABELS } from '@/types/models';
import { formatDateKey } from '@/utils/date';
import { isCardioEntry } from '@/utils/workout';

export function mealLabel(entry: DietEntry): string {
  return MEAL_LABELS[entry.mealType];
}

export function nutritionText(entry: DietEntry): string {
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

