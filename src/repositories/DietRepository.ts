import type { DietEntry } from '@/types/models';
import { DIET_KEY_PREFIX, dietKey } from '@/utils/storageKeys';
import { validateDietEntry } from '@/utils/validation';
import type { StorageAdapter } from '@/storage/StorageAdapter';

function parseDietEntries(raw: string | null): DietEntry[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry) => validateDietEntry(entry).valid);
  } catch {
    return [];
  }
}

export class DietRepository {
  constructor(private readonly storage: StorageAdapter) {}

  getByDate(date: string): DietEntry[] {
    return parseDietEntries(this.storage.getItem(dietKey(date)));
  }

  saveByDate(date: string, entries: DietEntry[]): void {
    if (entries.length === 0) {
      this.storage.removeItem(dietKey(date));
      return;
    }

    this.storage.setItem(dietKey(date), JSON.stringify(entries));
  }

  deleteByDate(date: string): void {
    this.storage.removeItem(dietKey(date));
  }

  getAll(): DietEntry[] {
    return this.storage
      .keys()
      .filter((key) => key.startsWith(DIET_KEY_PREFIX))
      .flatMap((key) => parseDietEntries(this.storage.getItem(key)));
  }
}

