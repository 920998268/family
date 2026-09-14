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
import { DataImportService, createImportSender } from './DataImportService';
import { CheckinSyncService } from './CheckinSyncService';
import { FavoriteFoodService } from './FavoriteFoodService';
import { createDietRemoteRepo } from '@/repositories/remote/DietRemoteRepo';
import { createFavoriteFoodRemoteRepo } from '@/repositories/remote/FavoriteFoodRemoteRepo';
import { createWorkoutRemoteRepo } from '@/repositories/remote/WorkoutRemoteRepo';
import { createStudyPlanRemoteRepo } from '@/repositories/remote/StudyPlanRemoteRepo';
import { createStudyCheckinRemoteRepo } from '@/repositories/remote/StudyCheckinRemoteRepo';
import { createMealPlanRemoteRepo } from '@/repositories/remote/MealPlanRemoteRepo';
import { createTravelPlanRemoteRepo } from '@/repositories/remote/TravelPlanRemoteRepo';
import { createTravelItemRemoteRepo } from '@/repositories/remote/TravelItemRemoteRepo';
import { createLedgerRemoteRepo } from '@/repositories/remote/LedgerRemoteRepo';
import { createTombstoneRemoteRepo } from '@/repositories/remote/TombstoneRemoteRepo';

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

/**
 * 老数据导入服务（M4 第 7 步）。
 *
 * 本机全量刻意复用 `BackupService.export()`：这样「能导入的」与「能备份的」
 * 永远是同一份数据 —— 少一个 domain 就会表现为「备份里有、导入漏了」，
 * 而那是用户最难自己发现的一类丢失。
 */
export function createDataImportService(): DataImportService {
  return new DataImportService({
    exportAll: () => createBackupService().export(),
    createOne: createImportSender(),
  });
}

/** 常用食物服务（纯云端，无本地缓存） */
export function createFavoriteFoodService(): FavoriteFoodService {
  return new FavoriteFoodService(createFavoriteFoodRemoteRepo());
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
      studyPlanRepository: new StudyPlanRepository(adapter),
      studyCheckinRepository: new StudyCheckinRepository(adapter),
      mealPlanRepository: new MealPlanRepository(adapter),
      travelRepository: new TravelRepository(adapter),
      ledgerRepository: new LedgerRepository(adapter),
      dietRemote: createDietRemoteRepo(),
      workoutRemote: createWorkoutRemoteRepo(),
      studyPlanRemote: createStudyPlanRemoteRepo(),
      studyCheckinRemote: createStudyCheckinRemoteRepo(),
      mealPlanRemote: createMealPlanRemoteRepo(),
      travelPlanRemote: createTravelPlanRemoteRepo(),
      travelItemRemote: createTravelItemRemoteRepo(),
      ledgerRemote: createLedgerRemoteRepo(),
      tombstoneRemote: createTombstoneRemoteRepo(),
    });
  }
  return checkinSyncService;
}
