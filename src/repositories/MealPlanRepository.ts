import type { MealPlan } from '@/types/models';
import { MEAL_PLAN_KEY_PREFIX, mealPlanKey } from '@/utils/storageKeys';
import { validateMealPlan } from '@/utils/validation';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import { parseStoredArray } from './parse';

export class MealPlanRepository {
  constructor(private readonly storage: StorageAdapter) {}

  getByDate(date: string): MealPlan[] {
    return this.readByKey(mealPlanKey(date));
  }

  saveByDate(date: string, plans: MealPlan[]): void {
    const key = mealPlanKey(date);
    if (plans.length === 0) {
      this.storage.removeItem(key);
      return;
    }
    this.storage.setItem(key, JSON.stringify(plans));
  }

  getAll(): MealPlan[] {
    return this.storage
      .keys()
      .filter((key) => key.startsWith(MEAL_PLAN_KEY_PREFIX))
      .flatMap((key) => this.readByKey(key));
  }

  private readByKey(key: string): MealPlan[] {
    return parseStoredArray(
      this.storage.getItem(key),
      (plan) => validateMealPlan(plan).valid,
    );
  }
}
