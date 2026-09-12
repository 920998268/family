import { getStorageAdapter } from '@/storage';
import type { StorageAdapter } from '@/storage/StorageAdapter';
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
import { CheckinSyncService } from './CheckinSyncService';
import { createDietRemoteRepo } from '@/repositories/remote/DietRemoteRepo';
import { createWorkoutRemoteRepo } from '@/repositories/remote/WorkoutRemoteRepo';

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

let checkinSyncService: CheckinSyncService | null = null;
let checkinSyncAdapter: StorageAdapter | null = null;

/**
 * 打卡同步服务（**必须是单例**）。
 *
 * `flush()` 的并发去重靠实例内的 `inFlight`；若每次调用都 new 一个，
 * App `onShow` 与页面 `onShow` 会各跑一次，对同一条记录并发推两遍。
 *
 * 存储适配器变化时自动重建（测试会替换适配器），避免实例握着旧适配器不放。
 */
export function getCheckinSyncService(): CheckinSyncService {
  const adapter = getStorageAdapter();
  if (!checkinSyncService || checkinSyncAdapter !== adapter) {
    checkinSyncAdapter = adapter;
    checkinSyncService = new CheckinSyncService({
      storage: adapter,
      dietRepository: new DietRepository(adapter),
      workoutRepository: new WorkoutRepository(adapter),
      dietRemote: createDietRemoteRepo(),
      workoutRemote: createWorkoutRemoteRepo(),
    });
  }
  return checkinSyncService;
}
