import type { Gender, MealType, WorkoutSet } from '@/types/models';

export const STORAGE_PREFIX = 'fitness';

export const PROFILE_KEY = `${STORAGE_PREFIX}.profile.v1`;
export const DIET_KEY_PREFIX = `${STORAGE_PREFIX}.diet.v1.`;
export const WORKOUT_KEY_PREFIX = `${STORAGE_PREFIX}.workout.v1.`;

export function dietKey(date: string): string {
  return `${DIET_KEY_PREFIX}${date}`;
}

export function workoutKey(date: string): string {
  return `${WORKOUT_KEY_PREFIX}${date}`;
}

export function isGender(value: unknown): value is Gender {
  return value === 'male' || value === 'female' || value === 'other';
}

export function isMealType(value: unknown): value is MealType {
  return value === 'breakfast' || value === 'lunch' || value === 'dinner' || value === 'snack';
}

export function isWorkoutSet(value: unknown): value is WorkoutSet {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const set = value as WorkoutSet;
  return (
    typeof set.id === 'string' &&
    typeof set.order === 'number' &&
    typeof set.reps === 'number' &&
    typeof set.weightKg === 'number'
  );
}

