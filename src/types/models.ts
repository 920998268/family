export type Gender = 'male' | 'female' | 'other';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Profile {
  name: string;
  gender: Gender;
  birthDate: string;
  heightCm: number;
  currentWeightKg: number;
  targetWeightKg: number;
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

export interface WorkoutSet {
  id: string;
  order: number;
  reps: number;
  weightKg: number;
}

export interface WorkoutEntry {
  id: string;
  date: string;
  exerciseName: string;
  sets: WorkoutSet[];
  memberId?: string;
}

export type MemberRole = 'parent' | 'child' | 'elder' | 'other';

export interface FamilyMember {
  id: string;
  name: string;
  role: MemberRole;
  avatarColor: string;
}

export type StudyFrequency = 'daily' | 'weekly';

export interface StudyPlan {
  id: string;
  title: string;
  subject: string;
  frequency: StudyFrequency;
  targetTimes: number;
  memberId?: string;
  createdAt: string;
}

export interface StudyCheckin {
  id: string;
  planId: string;
  date: string;
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

export const MEMBER_ROLES: ReadonlyArray<{ value: MemberRole; label: string }> = [
  { value: 'parent', label: '父母' },
  { value: 'child', label: '子女' },
  { value: 'elder', label: '长辈' },
  { value: 'other', label: '其他' },
];

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  parent: '父母',
  child: '子女',
  elder: '长辈',
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
