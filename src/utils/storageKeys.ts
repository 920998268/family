import type {
  Gender,
  MealType,
  MemberRole,
  StudyFrequency,
  TransactionType,
  TravelStatus,
  WorkoutCategory,
  WorkoutSet,
} from '@/types/models';

export const STORAGE_PREFIX = 'family';

export const PROFILE_KEY = `${STORAGE_PREFIX}.profile.v1`;
export const DIET_KEY_PREFIX = `${STORAGE_PREFIX}.diet.v1.`;
export const WORKOUT_KEY_PREFIX = `${STORAGE_PREFIX}.workout.v1.`;
export const FAMILY_MEMBERS_KEY = `${STORAGE_PREFIX}.family.members.v1`;
export const STUDY_PLANS_KEY = `${STORAGE_PREFIX}.study.plans.v1`;
export const STUDY_CHECKIN_KEY_PREFIX = `${STORAGE_PREFIX}.study.checkin.v1.`;
export const MEAL_PLAN_KEY_PREFIX = `${STORAGE_PREFIX}.meal.v1.`;
export const TRAVEL_PLANS_KEY = `${STORAGE_PREFIX}.travel.plans.v1`;
export const TRANSACTION_KEY_PREFIX = `${STORAGE_PREFIX}.ledger.v1.`;
/**
 * 上一次「上传本机数据到云端」（M4 数据认领）的结果快照。
 *
 * 单独一个键而不是塞进 profile：它是**过程留档**（供页面展示「上次传了多少条」），
 * 与个人信息无关，`clearAllData()` 清掉它也正合适。
 */
export const IMPORT_RECORD_KEY = `${STORAGE_PREFIX}.importRecord.v1`;

export function dietKey(date: string): string {
  return `${DIET_KEY_PREFIX}${date}`;
}

export function workoutKey(date: string): string {
  return `${WORKOUT_KEY_PREFIX}${date}`;
}

export function studyCheckinKey(date: string): string {
  return `${STUDY_CHECKIN_KEY_PREFIX}${date}`;
}

export function mealPlanKey(date: string): string {
  return `${MEAL_PLAN_KEY_PREFIX}${date}`;
}

export function transactionKey(date: string): string {
  return `${TRANSACTION_KEY_PREFIX}${date}`;
}

export function isGender(value: unknown): value is Gender {
  return value === 'male' || value === 'female' || value === 'other';
}

export function isMealType(value: unknown): value is MealType {
  return (
    value === 'breakfast' ||
    value === 'lunch' ||
    value === 'dinner' ||
    value === 'snack'
  );
}

export function isMemberRole(value: unknown): value is MemberRole {
  return (
    value === 'father' ||
    value === 'mother' ||
    value === 'grandfather' ||
    value === 'grandmother' ||
    value === 'maternalGrandfather' ||
    value === 'maternalGrandmother' ||
    value === 'son' ||
    value === 'daughter' ||
    value === 'other'
  );
}

export function isStudyFrequency(value: unknown): value is StudyFrequency {
  return value === 'daily' || value === 'weekly';
}

export function isTravelStatus(value: unknown): value is TravelStatus {
  return (
    value === 'planned' ||
    value === 'ongoing' ||
    value === 'done' ||
    value === 'cancelled'
  );
}

export function isTransactionType(value: unknown): value is TransactionType {
  return value === 'income' || value === 'expense';
}

export function isWorkoutCategory(value: unknown): value is WorkoutCategory {
  return value === 'strength' || value === 'cardio';
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
