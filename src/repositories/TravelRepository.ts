import type { TravelPlan } from '@/types/models';
import { TRAVEL_PLANS_KEY } from '@/utils/storageKeys';
import { validateTravelPlan } from '@/utils/validation';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import { parseStoredArray } from './parse';

export class TravelRepository {
  constructor(private readonly storage: StorageAdapter) {}

  getAll(): TravelPlan[] {
    return parseStoredArray(
      this.storage.getItem(TRAVEL_PLANS_KEY),
      (plan) => validateTravelPlan(plan).valid,
    );
  }

  saveAll(plans: TravelPlan[]): void {
    if (plans.length === 0) {
      this.storage.removeItem(TRAVEL_PLANS_KEY);
      return;
    }
    this.storage.setItem(TRAVEL_PLANS_KEY, JSON.stringify(plans));
  }
}
