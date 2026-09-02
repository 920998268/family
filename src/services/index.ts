import { getStorageAdapter } from '@/storage';
import { ProfileRepository } from '@/repositories/ProfileRepository';
import { DietRepository } from '@/repositories/DietRepository';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';
import { ProfileService } from './ProfileService';
import { DietService } from './DietService';
import { WorkoutService } from './WorkoutService';
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

export function createBackupService(): BackupService {
  return new BackupService(getStorageAdapter());
}

