import {
  isGender,
  isMealType,
  isMemberRole,
  isStudyFrequency,
  isTransactionType,
  isTravelStatus,
  isWorkoutSet,
} from '@/utils/storageKeys';
import { isValidDateKey } from '@/utils/date';
import type {
  BackupPayload,
  DietEntry,
  FamilyMember,
  MealPlan,
  Profile,
  StudyCheckin,
  StudyPlan,
  Transaction,
  TravelPlan,
  WorkoutEntry,
} from '@/types/models';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

type NumberField = {
  key: 'calories' | 'protein' | 'carbs' | 'fat';
  label: string;
  min: number;
  max: number;
};

const NUTRITION_FIELDS: NumberField[] = [
  { key: 'calories', label: '热量', min: 0, max: 100000 },
  { key: 'protein', label: '蛋白质', min: 0, max: 100000 },
  { key: 'carbs', label: '碳水化合物', min: 0, max: 100000 },
  { key: 'fat', label: '脂肪', min: 0, max: 100000 },
];

function numberError(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${label}必须是数字`;
  }

  if (value < min || value > max) {
    return `${label}需要在 ${min} 到 ${max} 之间`;
  }

  return null;
}

function pushError(errors: string[], error: string | null): void {
  if (error) {
    errors.push(error);
  }
}

function optionalIdError(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || !value) {
    return `${label}不合法`;
  }
  return null;
}

export function validateProfile(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['个人信息档案不能为空'] };
  }

  const profile = value as Partial<Profile>;

  if (typeof profile.name !== 'string' || !profile.name.trim()) {
    errors.push('姓名不能为空');
  }
  if (!isGender(profile.gender)) {
    errors.push('性别不合法');
  }
  if (typeof profile.birthDate !== 'string' || !isValidDateKey(profile.birthDate)) {
    errors.push('出生日期不合法');
  }

  pushError(errors, numberError(profile.heightCm, '身高', 50, 260));
  pushError(errors, numberError(profile.currentWeightKg, '当前体重', 10, 500));
  pushError(errors, numberError(profile.targetWeightKg, '目标体重', 10, 500));

  return { valid: errors.length === 0, errors };
}

export function validateDietEntry(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['饮食记录不能为空'] };
  }

  const entry = value as Partial<DietEntry>;

  if (typeof entry.id !== 'string' || !entry.id) {
    errors.push('记录 ID 缺失');
  }
  if (typeof entry.date !== 'string' || !isValidDateKey(entry.date)) {
    errors.push('日期不合法');
  }
  if (!isMealType(entry.mealType)) {
    errors.push('餐次不合法');
  }
  if (typeof entry.foodName !== 'string' || !entry.foodName.trim()) {
    errors.push('食物名称不能为空');
  }
  if (typeof entry.quantity !== 'string' || !entry.quantity.trim()) {
    errors.push('数量不能为空');
  }
  pushError(errors, optionalIdError(entry.memberId, '打卡成员'));

  for (const field of NUTRITION_FIELDS) {
    const fieldValue = entry[field.key];
    if (fieldValue !== undefined) {
      pushError(
        errors,
        numberError(fieldValue, field.label, field.min, field.max),
      );
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

  if (typeof entry.id !== 'string' || !entry.id) {
    errors.push('记录 ID 缺失');
  }
  if (typeof entry.date !== 'string' || !isValidDateKey(entry.date)) {
    errors.push('日期不合法');
  }
  if (typeof entry.exerciseName !== 'string' || !entry.exerciseName.trim()) {
    errors.push('动作名称不能为空');
  }
  pushError(errors, optionalIdError(entry.memberId, '打卡成员'));
  if (!Array.isArray(entry.sets) || entry.sets.length === 0) {
    errors.push('至少需要一组训练明细');
  } else {
    for (const [index, set] of entry.sets.entries()) {
      if (!isWorkoutSet(set)) {
        errors.push(`第 ${index + 1} 组明细不合法`);
        continue;
      }

      if (set.order !== index + 1) {
        errors.push(`第 ${index + 1} 组序号不连续`);
      }

      const repsError = numberError(set.reps, '次数', 1, 10000);
      const weightError = numberError(set.weightKg, '重量', 0, 2000);
      pushError(errors, repsError && `第 ${index + 1} 组${repsError}`);
      pushError(errors, weightError && `第 ${index + 1} 组${weightError}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateFamilyMember(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['家庭成员不能为空'] };
  }

  const member = value as Partial<FamilyMember>;

  if (typeof member.id !== 'string' || !member.id) {
    errors.push('成员 ID 缺失');
  }
  if (typeof member.name !== 'string' || !member.name.trim()) {
    errors.push('成员姓名不能为空');
  }
  if (!isMemberRole(member.role)) {
    errors.push('成员角色不合法');
  }
  if (typeof member.avatarColor !== 'string' || !member.avatarColor) {
    errors.push('成员头像颜色不合法');
  }

  return { valid: errors.length === 0, errors };
}

export function validateStudyPlan(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['学习计划不能为空'] };
  }

  const plan = value as Partial<StudyPlan>;

  if (typeof plan.id !== 'string' || !plan.id) {
    errors.push('计划 ID 缺失');
  }
  if (typeof plan.title !== 'string' || !plan.title.trim()) {
    errors.push('计划标题不能为空');
  }
  if (typeof plan.subject !== 'string' || !plan.subject.trim()) {
    errors.push('学习内容不能为空');
  }
  if (!isStudyFrequency(plan.frequency)) {
    errors.push('打卡频率不合法');
  }
  pushError(errors, numberError(plan.targetTimes, '目标次数', 1, 1000));
  pushError(errors, optionalIdError(plan.memberId, '归属成员'));
  if (typeof plan.createdAt !== 'string' || !plan.createdAt) {
    errors.push('创建时间不合法');
  }

  return { valid: errors.length === 0, errors };
}

export function validateStudyCheckin(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['学习打卡不能为空'] };
  }

  const checkin = value as Partial<StudyCheckin>;

  if (typeof checkin.id !== 'string' || !checkin.id) {
    errors.push('打卡 ID 缺失');
  }
  if (typeof checkin.planId !== 'string' || !checkin.planId) {
    errors.push('所属计划缺失');
  }
  if (typeof checkin.date !== 'string' || !isValidDateKey(checkin.date)) {
    errors.push('日期不合法');
  }
  if (typeof checkin.note !== 'string') {
    errors.push('打卡备注不合法');
  }
  pushError(errors, optionalIdError(checkin.memberId, '打卡成员'));

  return { valid: errors.length === 0, errors };
}

export function validateMealPlan(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['食谱计划不能为空'] };
  }

  const plan = value as Partial<MealPlan>;

  if (typeof plan.id !== 'string' || !plan.id) {
    errors.push('计划 ID 缺失');
  }
  if (typeof plan.date !== 'string' || !isValidDateKey(plan.date)) {
    errors.push('日期不合法');
  }
  if (!isMealType(plan.slot)) {
    errors.push('餐次不合法');
  }
  if (typeof plan.dishName !== 'string' || !plan.dishName.trim()) {
    errors.push('菜品名称不能为空');
  }
  if (typeof plan.ingredients !== 'string') {
    errors.push('食材信息不合法');
  }
  if (typeof plan.cook !== 'string') {
    errors.push('掌勺人信息不合法');
  }
  if (typeof plan.done !== 'boolean') {
    errors.push('执行状态不合法');
  }
  if (typeof plan.note !== 'string') {
    errors.push('备注不合法');
  }

  return { valid: errors.length === 0, errors };
}

export function validateTravelPlan(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['出行计划不能为空'] };
  }

  const plan = value as Partial<TravelPlan>;

  if (typeof plan.id !== 'string' || !plan.id) {
    errors.push('计划 ID 缺失');
  }
  if (typeof plan.title !== 'string' || !plan.title.trim()) {
    errors.push('计划标题不能为空');
  }
  if (typeof plan.startDate !== 'string' || !isValidDateKey(plan.startDate)) {
    errors.push('开始日期不合法');
  }
  if (typeof plan.endDate !== 'string' || !isValidDateKey(plan.endDate)) {
    errors.push('结束日期不合法');
  }
  if (
    typeof plan.startDate === 'string' &&
    typeof plan.endDate === 'string' &&
    plan.startDate > plan.endDate
  ) {
    errors.push('开始日期不能晚于结束日期');
  }
  if (typeof plan.destination !== 'string') {
    errors.push('目的地信息不合法');
  }
  if (!Array.isArray(plan.members) || !plan.members.every((item) => typeof item === 'string')) {
    errors.push('参与成员不合法');
  }
  pushError(errors, numberError(plan.budget, '预算', 0, 100000000));
  if (!isTravelStatus(plan.status)) {
    errors.push('计划状态不合法');
  }
  if (typeof plan.note !== 'string') {
    errors.push('备注不合法');
  }
  if (!Array.isArray(plan.items)) {
    errors.push('行程明细不合法');
  } else {
    for (const [index, item] of plan.items.entries()) {
      const itemErrors: string[] = [];
      if (!item || typeof item !== 'object') {
        errors.push(`第 ${index + 1} 项行程不合法`);
        continue;
      }
      if (typeof item.id !== 'string' || !item.id) {
        itemErrors.push('ID 缺失');
      }
      if (typeof item.activity !== 'string' || !item.activity.trim()) {
        itemErrors.push('活动不能为空');
      }
      if (typeof item.time !== 'string') {
        itemErrors.push('时间不合法');
      }
      if (typeof item.note !== 'string') {
        itemErrors.push('备注不合法');
      }
      if (typeof item.done !== 'boolean') {
        itemErrors.push('执行状态不合法');
      }
      if (itemErrors.length > 0) {
        errors.push(`第 ${index + 1} 项行程：${itemErrors.join('；')}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateTransaction(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['收支记录不能为空'] };
  }

  const entry = value as Partial<Transaction>;

  if (typeof entry.id !== 'string' || !entry.id) {
    errors.push('记录 ID 缺失');
  }
  if (!isTransactionType(entry.type)) {
    errors.push('收支类型不合法');
  }
  pushError(errors, numberError(entry.amount, '金额', 0.01, 100000000));
  if (typeof entry.category !== 'string' || !entry.category.trim()) {
    errors.push('分类不能为空');
  }
  if (typeof entry.date !== 'string' || !isValidDateKey(entry.date)) {
    errors.push('日期不合法');
  }
  pushError(errors, optionalIdError(entry.memberId, '记账成员'));
  if (typeof entry.note !== 'string') {
    errors.push('备注不合法');
  }

  return { valid: errors.length === 0, errors };
}

export function validateBackupPayload(value: unknown): ValidationResult {
  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['备份文件内容不能为空'] };
  }

  const payload = value as Partial<BackupPayload>;
  if (payload.version !== 2) {
    return { valid: false, errors: ['不支持的备份文件版本'] };
  }
  if (!payload.diet || !Array.isArray(payload.diet)) {
    return { valid: false, errors: ['备份文件缺少饮食记录'] };
  }
  if (!payload.workout || !Array.isArray(payload.workout)) {
    return { valid: false, errors: ['备份文件缺少训练记录'] };
  }
  if (payload.profile !== null && !validateProfile(payload.profile).valid) {
    return { valid: false, errors: ['备份文件中的个人信息档案不合法'] };
  }

  const collections: Array<{ key: keyof Pick<
    BackupPayload,
    'familyMembers' | 'studyPlans' | 'studyCheckins' | 'mealPlans' | 'travelPlans' | 'transactions'
  >; label: string; validate: (value: unknown) => ValidationResult }> = [
    { key: 'familyMembers', label: '家庭成员', validate: validateFamilyMember },
    { key: 'studyPlans', label: '学习计划', validate: validateStudyPlan },
    { key: 'studyCheckins', label: '学习打卡', validate: validateStudyCheckin },
    { key: 'mealPlans', label: '食谱计划', validate: validateMealPlan },
    { key: 'travelPlans', label: '出行计划', validate: validateTravelPlan },
    { key: 'transactions', label: '收支记录', validate: validateTransaction },
  ];

  for (const collection of collections) {
    if (!Array.isArray(payload[collection.key])) {
      return { valid: false, errors: [`备份文件缺少${collection.label}`] };
    }
  }

  const errors: string[] = [];
  for (const [index, entry] of payload.diet.entries()) {
    if (!validateDietEntry(entry).valid) {
      errors.push(`第 ${index + 1} 条饮食记录不合法`);
    }
  }
  for (const [index, entry] of payload.workout.entries()) {
    if (!validateWorkoutEntry(entry).valid) {
      errors.push(`第 ${index + 1} 条训练记录不合法`);
    }
  }
  for (const collection of collections) {
    const entries = (payload[collection.key] as unknown[]) ?? [];
    for (const [index, entry] of entries.entries()) {
      if (!collection.validate(entry).valid) {
        errors.push(`第 ${index + 1} 条${collection.label}不合法`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
