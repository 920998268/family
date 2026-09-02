import { getStorageAdapter } from '@/storage';
import { ProfileRepository } from '@/repositories/ProfileRepository';
import { DietRepository } from '@/repositories/DietRepository';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';
import { FamilyRepository } from '@/repositories/FamilyRepository';
import { StudyPlanRepository } from '@/repositories/StudyPlanRepository';
import { StudyCheckinRepository } from '@/repositories/StudyCheckinRepository';
import { MealPlanRepository } from '@/repositories/MealPlanRepository';
import { TravelRepository } from '@/repositories/TravelRepository';
import { LedgerRepository } from '@/repositories/LedgerRepository';
import { ProfileService } from './ProfileService';
import { DietService } from './DietService';
import { WorkoutService } from './WorkoutService';
import { FamilyService } from './FamilyService';
import { StudyService } from './StudyService';
import { MealService } from './MealService';
import { TravelService } from './TravelService';
import { LedgerService } from './LedgerService';
import { BackupService } from './BackupService';

export function createProfileService(): ProfileService {
  return new ProfileService(new ProfileRepository(getStorageAdapter()));
}

export function createDietService(): DietService {
  return new DietService(new DietRepository(getStorageAdapter()));
}

export function createWorkoutService(): WorkoutService {
  return new WorkoutService(new WorkoutRepository(getStorageAdapter()));
}

export function createFamilyService(): FamilyService {
  return new FamilyService(new FamilyRepository(getStorageAdapter()));
}

export function createStudyService(): StudyService {
  return new StudyService(
    new StudyPlanRepository(getStorageAdapter()),
    new StudyCheckinRepository(getStorageAdapter()),
  );
}

export function createMealService(): MealService {
  return new MealService(new MealPlanRepository(getStorageAdapter()));
}

export function createTravelService(): TravelService {
  return new TravelService(new TravelRepository(getStorageAdapter()));
}

export function createLedgerService(): LedgerService {
  return new LedgerService(new LedgerRepository(getStorageAdapter()));
}

export function createBackupService(): BackupService {
  return new BackupService(getStorageAdapter());
}
