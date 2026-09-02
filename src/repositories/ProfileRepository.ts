import type { Profile } from '@/types/models';
import { PROFILE_KEY } from '@/utils/storageKeys';
import { validateProfile } from '@/utils/validation';
import type { StorageAdapter } from '@/storage/StorageAdapter';

export class ProfileRepository {
  constructor(private readonly storage: StorageAdapter) {}

  get(): Profile | null {
    const raw = this.storage.getItem(PROFILE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!validateProfile(parsed).valid) {
        return null;
      }
      return parsed as Profile;
    } catch {
      return null;
    }
  }

  save(profile: Profile): void {
    this.storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  clear(): void {
    this.storage.removeItem(PROFILE_KEY);
  }
}

