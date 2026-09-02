import type { WorkoutEntry } from '@/types/models';
import { WORKOUT_KEY_PREFIX, workoutKey } from '@/utils/storageKeys';
import { validateWorkoutEntry } from '@/utils/validation';
import type { StorageAdapter } from '@/storage/StorageAdapter';

function parseWorkoutEntries(raw: string | null): WorkoutEntry[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry) => validateWorkoutEntry(entry).valid);
  } catch {
    return [];
  }
}

export class WorkoutRepository {
  constructor(private readonly storage: StorageAdapter) {}

  getByDate(date: string): WorkoutEntry[] {
    return parseWorkoutEntries(this.storage.getItem(workoutKey(date)));
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
      .flatMap((key) => parseWorkoutEntries(this.storage.getItem(key)));
  }
}

