import type { FamilyMember } from '@/types/models';
import { FAMILY_MEMBERS_KEY } from '@/utils/storageKeys';
import { validateFamilyMember } from '@/utils/validation';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import { parseStoredArray } from './parse';

export class FamilyRepository {
  constructor(private readonly storage: StorageAdapter) {}

  getAll(): FamilyMember[] {
    return parseStoredArray(
      this.storage.getItem(FAMILY_MEMBERS_KEY),
      (member) => validateFamilyMember(member).valid,
    );
  }

  saveAll(members: FamilyMember[]): void {
    if (members.length === 0) {
      this.storage.removeItem(FAMILY_MEMBERS_KEY);
      return;
    }
    this.storage.setItem(FAMILY_MEMBERS_KEY, JSON.stringify(members));
  }
}
