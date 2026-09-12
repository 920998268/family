export type Gender = 'male' | 'female' | 'other';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Profile {
  name: string;
  gender: Gender;
  birthDate: string;
  heightCm: number;
  currentWeightKg: number;
  targetWeightKg: number;
  mobile?: string; // 手机号（选填，与登录账号手机号同步）
  avatarUrl?: string; // 头像URL（微信头像或相册上传）
  role?: MemberRole; // 家庭关系
}

export interface DietEntry {
  id: string;
  date: string;
  mealType: MealType;
  foodName: string;
  quantity: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  memberId?: string;
}

/** 常用食物：云端沉淀，饮食录入时快捷带出名称与营养值 */
export interface FavoriteFood {
  id: string;
  name: string;
  quantity: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  /** 使用次数，列表按它降序排序（服务端维护） */
  useCount: number;
  lastUsedAt?: number;
}

export interface WorkoutSet {
  id: string;
  order: number;
  reps: number;
  weightKg: number;
}

export type WorkoutCategory = 'strength' | 'cardio';

export interface WorkoutEntry {
  id: string;
  date: string;
  /**
   * 运动类型：力量 / 有氧。
   *
   * ⚠️ 0.3.2 新增，**必须保持可选**：此前的训练记录没有该字段，
   * 若设为必填，`parseStoredArray` 会在校验时把老记录判为非法并静默丢弃，
   * 等同于用户历史训练数据消失。读取时统一由 `normalizeWorkoutCategory` 推断。
   */
  category?: WorkoutCategory;
  exerciseName: string;
  /** 组明细：力量至少一组；有氧为空数组 */
  sets: WorkoutSet[];
  /** 有氧：时长（分钟） */
  durationMin?: number;
  /** 有氧：距离（公里，选填） */
  distanceKm?: number;
  /** 消耗热量（千卡，选填；力量与有氧均可用） */
  calories?: number;
  memberId?: string;
}

export type MemberRole =
  | 'father'
  | 'mother'
  | 'grandfather'
  | 'grandmother'
  | 'maternalGrandfather'
  | 'maternalGrandmother'
  | 'son'
  | 'daughter'
  | 'other';

export interface FamilyMember {
  id: string;
  userId?: string; // 绑定的登录账号 UID，空=未绑定的虚拟成员
  mobile?: string; // 预设手机号，用户用该手机号登录后自动关联
  name: string;
  role: MemberRole;
  avatarColor: string;
  avatarUrl?: string;
}

export type StudyFrequency = 'daily' | 'weekly';

export interface StudyPlan {
  id: string;
  title: string;
  subject: string;
  frequency: StudyFrequency;
  targetTimes: number;
  memberId?: string;
  /**
   * 创建时间。
   *
   * ⚠️ 前端用 **ISO 字符串**，而云端 `study_plans.createdAt` 存 **毫秒时间戳**
   * （与 diets / workouts 一致）。换算由 `utils/cloudMap.ts` 负责，
   * 工具函数是 `utils/date.ts` 的 `toMillis` / `toIsoString`。
   *
   * 计划列表按 `createdAt` 排序（`StudyService.sortPlans`），
   * 所以换算方向写错会**静默错序**而不是报错 —— 改动这块务必跑单测。
   */
  createdAt: string;
}

export interface StudyCheckin {
  id: string;
  planId: string;
  date: string;
  /**
   * 打卡备注。
   *
   * ⚠️ `validateStudyCheckin` 要求它**必须是字符串**（不能是 undefined / null），
   * 而云端空备注存的是 `null`。映射层必须用 `normalizeStudyNote` 归一化，
   * 否则整条打卡会被 `StudyCheckinRepository` 静默丢弃。
   */
  note: string;
  memberId?: string;
}

export interface MealPlan {
  id: string;
  date: string;
  slot: MealType;
  dishName: string;
  ingredients: string;
  cook: string;
  done: boolean;
  note: string;
}

export type TravelStatus = 'planned' | 'ongoing' | 'done' | 'cancelled';

export interface TravelItem {
  id: string;
  time: string;
  activity: string;
  note: string;
  done: boolean;
}

export interface TravelPlan {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  destination: string;
  members: string[];
  budget: number;
  status: TravelStatus;
  note: string;
  items: TravelItem[];
}

export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  date: string;
  memberId?: string;
  note: string;
}

export interface BackupPayload {
  version: 2;
  exportedAt: string;
  profile: Profile | null;
  familyMembers: FamilyMember[];
  diet: DietEntry[];
  workout: WorkoutEntry[];
  studyPlans: StudyPlan[];
  studyCheckins: StudyCheckin[];
  mealPlans: MealPlan[];
  travelPlans: TravelPlan[];
  transactions: Transaction[];
}

export const GENDERS: ReadonlyArray<{ value: Gender; label: string }> = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' },
];

export const MEAL_TYPES: ReadonlyArray<{ value: MealType; label: string }> = [
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'snack', label: '加餐' },
];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

export const WORKOUT_CATEGORIES: ReadonlyArray<{
  value: WorkoutCategory;
  label: string;
}> = [
  { value: 'strength', label: '力量' },
  { value: 'cardio', label: '有氧' },
];

export const WORKOUT_CATEGORY_LABELS: Record<WorkoutCategory, string> = {
  strength: '力量',
  cardio: '有氧',
};

export const MEMBER_ROLES: ReadonlyArray<{ value: MemberRole; label: string }> = [
  { value: 'father', label: '爸爸' },
  { value: 'mother', label: '妈妈' },
  { value: 'grandfather', label: '爷爷' },
  { value: 'grandmother', label: '奶奶' },
  { value: 'maternalGrandfather', label: '外公' },
  { value: 'maternalGrandmother', label: '外婆' },
  { value: 'son', label: '儿子' },
  { value: 'daughter', label: '女儿' },
  { value: 'other', label: '其他' },
];

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  father: '爸爸',
  mother: '妈妈',
  grandfather: '爷爷',
  grandmother: '奶奶',
  maternalGrandfather: '外公',
  maternalGrandmother: '外婆',
  son: '儿子',
  daughter: '女儿',
  other: '其他',
};

export const AVATAR_COLORS: ReadonlyArray<string> = [
  '#f97316',
  '#0ea5e9',
  '#10b981',
  '#8b5cf6',
  '#f43f5e',
  '#f59e0b',
];

export const STUDY_FREQUENCIES: ReadonlyArray<{
  value: StudyFrequency;
  label: string;
}> = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
];

export const STUDY_FREQUENCY_LABELS: Record<StudyFrequency, string> = {
  daily: '每天',
  weekly: '每周',
};

export const TRAVEL_STATUSES: ReadonlyArray<{
  value: TravelStatus;
  label: string;
}> = [
  { value: 'planned', label: '计划中' },
  { value: 'ongoing', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
];

export const TRAVEL_STATUS_LABELS: Record<TravelStatus, string> = {
  planned: '计划中',
  ongoing: '进行中',
  done: '已完成',
  cancelled: '已取消',
};

export const EXPENSE_CATEGORIES: ReadonlyArray<string> = [
  '餐饮',
  '购物',
  '交通',
  '居住',
  '教育',
  '医疗',
  '娱乐',
  '其他',
];

export const INCOME_CATEGORIES: ReadonlyArray<string> = [
  '工资',
  '奖金',
  '理财',
  '兼职',
  '礼金',
  '其他',
];
