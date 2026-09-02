import type { BackupPayload } from '@/types/models';
import { STORAGE_PREFIX } from '@/utils/storageKeys';
import { validateBackupPayload } from '@/utils/validation';
import { DietRepository } from '@/repositories/DietRepository';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';
import { ProfileRepository } from '@/repositories/ProfileRepository';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import { groupByDate } from '@/utils/collections';

export class BackupService {
  private readonly profileRepository: ProfileRepository;
  private readonly dietRepository: DietRepository;
  private readonly workoutRepository: WorkoutRepository;

  constructor(private readonly storage: StorageAdapter) {
    this.profileRepository = new ProfileRepository(storage);
    this.dietRepository = new DietRepository(storage);
    this.workoutRepository = new WorkoutRepository(storage);
  }

  export(): BackupPayload {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: this.profileRepository.get(),
      diet: this.dietRepository.getAll(),
      workout: this.workoutRepository.getAll(),
    };
  }

  import(payload: BackupPayload): void {
    const result = validateBackupPayload(payload);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    this.clearFitnessData();

    if (payload.profile) {
      this.profileRepository.save(payload.profile);
    }

    const dietByDate = groupByDate(payload.diet);
    const workoutByDate = groupByDate(payload.workout);

    for (const [date, entries] of dietByDate) {
      this.dietRepository.saveByDate(date, entries);
    }
    for (const [date, entries] of workoutByDate) {
      this.workoutRepository.saveByDate(date, entries);
    }
  }

  private clearFitnessData(): void {
    for (const key of this.storage.keys()) {
      if (key.startsWith(STORAGE_PREFIX)) {
        this.storage.removeItem(key);
      }
    }
  }
}

