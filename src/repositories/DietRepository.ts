import type { DietEntry } from '@/types/models';
import { DIET_KEY_PREFIX, dietKey } from '@/utils/storageKeys';
import { validateDietEntry } from '@/utils/validation';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import { parseStoredArray } from './parse';

export class DietRepository {
  constructor(private readonly storage: StorageAdapter) {}

  getByDate(date: string): DietEntry[] {
    return this.readByDate(date);
  }

  saveByDate(date: string, entries: DietEntry[]): void {
    const key = dietKey(date);
    if (entries.length === 0) {
      this.storage.removeItem(key);
      return;
    }

    this.storage.setItem(key, JSON.stringify(entries));
  }

  deleteByDate(date: string): void {
    this.storage.removeItem(dietKey(date));
  }

  getAll(): DietEntry[] {
    return this.storage
      .keys()
      .filter((key) => key.startsWith(DIET_KEY_PREFIX))
      .flatMap((key) => this.readByKey(key));
  }

  private readByDate(date: string): DietEntry[] {
    return this.readByKey(dietKey(date));
  }

  private readByKey(key: string): DietEntry[] {
    return parseStoredArray(
      this.storage.getItem(key),
      (entry) => validateDietEntry(entry).valid,
    );
  }
}

