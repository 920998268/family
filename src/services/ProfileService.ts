import type { Profile } from '@/types/models';
import { validateProfile } from '@/utils/validation';
import { ProfileRepository } from '@/repositories/ProfileRepository';

export class ProfileService {
  constructor(private readonly repository: ProfileRepository) {}

  get(): Profile | null {
    return this.repository.get();
  }

  save(profile: Profile): Profile {
    const result = validateProfile(profile);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    this.repository.save(profile);
    return profile;
  }
}

