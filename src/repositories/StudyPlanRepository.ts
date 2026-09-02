import type { StudyPlan } from '@/types/models';
import { STUDY_PLANS_KEY } from '@/utils/storageKeys';
import { validateStudyPlan } from '@/utils/validation';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import { parseStoredArray } from './parse';

export class StudyPlanRepository {
  constructor(private readonly storage: StorageAdapter) {}

  getAll(): StudyPlan[] {
    return parseStoredArray(
      this.storage.getItem(STUDY_PLANS_KEY),
      (plan) => validateStudyPlan(plan).valid,
    );
  }

  saveAll(plans: StudyPlan[]): void {
    if (plans.length === 0) {
      this.storage.removeItem(STUDY_PLANS_KEY);
      return;
    }
    this.storage.setItem(STUDY_PLANS_KEY, JSON.stringify(plans));
  }
}
