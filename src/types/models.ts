export type Gender = 'male' | 'female' | 'other';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Profile {
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
}

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  profile: Profile | null;
  diet: DietEntry[];
  workout: WorkoutEntry[];
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

