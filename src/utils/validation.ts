import {
  isGender,
  isMealType,
  isWorkoutSet,
} from '@/utils/storageKeys';
import { isValidDateKey } from '@/utils/date';
import type {
  BackupPayload,
  DietEntry,
  Profile,
  WorkoutEntry,
} from '@/types/models';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function numberError(value: unknown, label: string, min: number, max: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${label}必须是数字`;
  }
  if (value < min || value > max) {
    return `${label}需要在 ${min} 到 ${max} 之间`;
  }
  return null;
}

export function validateProfile(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['健康档案不能为空'] };
  }

  const profile = value as Partial<Profile>;

  if (!isGender(profile.gender)) {
    errors.push('性别不合法');
  }
  if (typeof profile.birthDate !== 'string' || !isValidDateKey(profile.birthDate)) {
    errors.push('出生日期不合法');
  }

  const heightError = numberError(profile.heightCm, '身高', 50, 260);
  const currentWeightError = numberError(profile.currentWeightKg, '当前体重', 10, 500);
  const targetWeightError = numberError(profile.targetWeightKg, '目标体重', 10, 500);

  if (heightError) errors.push(heightError);
  if (currentWeightError) errors.push(currentWeightError);
  if (targetWeightError) errors.push(targetWeightError);

  return { valid: errors.length === 0, errors };
}

export function validateDietEntry(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['饮食记录不能为空'] };
  }

  const entry = value as Partial<DietEntry>;

  if (typeof entry.id !== 'string' || !entry.id) errors.push('记录 ID 缺失');
  if (typeof entry.date !== 'string' || !isValidDateKey(entry.date)) errors.push('日期不合法');
  if (!isMealType(entry.mealType)) errors.push('餐次不合法');
  if (typeof entry.foodName !== 'string' || !entry.foodName.trim()) errors.push('食物名称不能为空');
  if (typeof entry.quantity !== 'string' || !entry.quantity.trim()) errors.push('数量不能为空');

  for (const [key, label] of [
    ['calories', '热量'],
    ['protein', '蛋白质'],
    ['carbs', '碳水化合物'],
    ['fat', '脂肪'],
  ] as const) {
    if (entry[key] !== undefined) {
      const error = numberError(entry[key], label, 0, 100000);
      if (error) errors.push(error);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateWorkoutEntry(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['训练记录不能为空'] };
  }

  const entry = value as Partial<WorkoutEntry>;

  if (typeof entry.id !== 'string' || !entry.id) errors.push('记录 ID 缺失');
  if (typeof entry.date !== 'string' || !isValidDateKey(entry.date)) errors.push('日期不合法');
  if (typeof entry.exerciseName !== 'string' || !entry.exerciseName.trim()) {
    errors.push('动作名称不能为空');
  }
  if (!Array.isArray(entry.sets) || entry.sets.length === 0) {
    errors.push('至少需要一组训练明细');
  } else {
    entry.sets.forEach((set, index) => {
      if (!isWorkoutSet(set)) {
        errors.push(`第 ${index + 1} 组明细不合法`);
        return;
      }

      if (set.order !== index + 1) {
        errors.push(`第 ${index + 1} 组序号不连续`);
      }

      const repsError = numberError(set.reps, '次数', 1, 10000);
      const weightError = numberError(set.weightKg, '重量', 0, 2000);
      if (repsError) errors.push(`第 ${index + 1} 组${repsError}`);
      if (weightError) errors.push(`第 ${index + 1} 组${weightError}`);
    });
  }

  return { valid: errors.length === 0, errors };
}

export function validateBackupPayload(value: unknown): ValidationResult {
  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['备份文件内容不能为空'] };
  }

  const payload = value as Partial<BackupPayload>;
  if (payload.version !== 1) {
    return { valid: false, errors: ['不支持的备份文件版本'] };
  }
  if (!payload.diet || !Array.isArray(payload.diet)) {
    return { valid: false, errors: ['备份文件缺少饮食记录'] };
  }
  if (!payload.workout || !Array.isArray(payload.workout)) {
    return { valid: false, errors: ['备份文件缺少训练记录'] };
  }
  if (payload.profile !== null && !validateProfile(payload.profile).valid) {
    return { valid: false, errors: ['备份文件中的健康档案不合法'] };
  }

  const errors: string[] = [];
  payload.diet.forEach((entry, index) => {
    if (!validateDietEntry(entry).valid) {
      errors.push(`第 ${index + 1} 条饮食记录不合法`);
    }
  });
  payload.workout.forEach((entry, index) => {
    if (!validateWorkoutEntry(entry).valid) {
      errors.push(`第 ${index + 1} 条训练记录不合法`);
    }
  });

  return { valid: errors.length === 0, errors };
}

