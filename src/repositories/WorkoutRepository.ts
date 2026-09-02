import type { WorkoutEntry } from '@/types/models';
import { WORKOUT_KEY_PREFIX, workoutKey } from '@/utils/storageKeys';
import { validateWorkoutEntry } from '@/utils/validation';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import { parseStoredArray } from './parse';

export class WorkoutRepository {
  constructor(private readonly storage: StorageAdapter) {}

  getByDate(date: string): WorkoutEntry[] {
    return this.readByDate(date);
  }

  saveByDate(date: string, entries: WorkoutEntry[]): void {
    if (entries.length === 0) {
      this.storage.removeItem(workoutKey(date));
      return;
    }

    this.storage.setItem(workoutKey(date), JSON.stringify(entries));
  }

  deleteByDate(date: string): void {
    this.storage.removeItem(workoutKey(date));
  }

  getAll(): WorkoutEntry[] {
    return this.storage
      .keys()
      .filter((key) => key.startsWith(WORKOUT_KEY_PREFIX))
      .flatMap((key) => this.readByKey(key));
  }

  private readByDate(date: string): WorkoutEntry[] {
    return this.readByKey(workoutKey(date));
  }

  private readByKey(key: string): WorkoutEntry[] {
    return parseStoredArray(
      this.storage.getItem(key),
      (entry) => validateWorkoutEntry(entry).valid,
    );
  }
}

