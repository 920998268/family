import type { StudyCheckin } from '@/types/models';
import { STUDY_CHECKIN_KEY_PREFIX, studyCheckinKey } from '@/utils/storageKeys';
import { validateStudyCheckin } from '@/utils/validation';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import { parseStoredArray } from './parse';

export class StudyCheckinRepository {
  constructor(private readonly storage: StorageAdapter) {}

  getByDate(date: string): StudyCheckin[] {
    return this.readByKey(studyCheckinKey(date));
  }

  saveByDate(date: string, checkins: StudyCheckin[]): void {
    const key = studyCheckinKey(date);
    if (checkins.length === 0) {
      this.storage.removeItem(key);
      return;
    }
    this.storage.setItem(key, JSON.stringify(checkins));
  }

  getAll(): StudyCheckin[] {
    return this.storage
      .keys()
      .filter((key) => key.startsWith(STUDY_CHECKIN_KEY_PREFIX))
      .flatMap((key) => this.readByKey(key));
  }

  private readByKey(key: string): StudyCheckin[] {
    return parseStoredArray(
      this.storage.getItem(key),
      (checkin) => validateStudyCheckin(checkin).valid,
    );
  }
}
