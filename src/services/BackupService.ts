import type { BackupPayload } from '@/types/models';
import type { CloudImportRecord } from '@/utils/importData';
import { IMPORT_RECORD_KEY, STORAGE_PREFIX } from '@/utils/storageKeys';
import { validateBackupPayload } from '@/utils/validation';
import { DietRepository } from '@/repositories/DietRepository';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';
import { ProfileRepository } from '@/repositories/ProfileRepository';
import { FamilyRepository } from '@/repositories/FamilyRepository';
import { StudyPlanRepository } from '@/repositories/StudyPlanRepository';
import { StudyCheckinRepository } from '@/repositories/StudyCheckinRepository';
import { MealPlanRepository } from '@/repositories/MealPlanRepository';
import { TravelRepository } from '@/repositories/TravelRepository';
import { LedgerRepository } from '@/repositories/LedgerRepository';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import { groupByDate } from '@/utils/collections';

export class BackupService {
  private readonly profileRepository: ProfileRepository;
  private readonly dietRepository: DietRepository;
  private readonly workoutRepository: WorkoutRepository;
  private readonly familyRepository: FamilyRepository;
  private readonly studyPlanRepository: StudyPlanRepository;
  private readonly studyCheckinRepository: StudyCheckinRepository;
  private readonly mealPlanRepository: MealPlanRepository;
  private readonly travelRepository: TravelRepository;
  private readonly ledgerRepository: LedgerRepository;

  constructor(private readonly storage: StorageAdapter) {
    this.profileRepository = new ProfileRepository(storage);
    this.dietRepository = new DietRepository(storage);
    this.workoutRepository = new WorkoutRepository(storage);
    this.familyRepository = new FamilyRepository(storage);
    this.studyPlanRepository = new StudyPlanRepository(storage);
    this.studyCheckinRepository = new StudyCheckinRepository(storage);
    this.mealPlanRepository = new MealPlanRepository(storage);
    this.travelRepository = new TravelRepository(storage);
    this.ledgerRepository = new LedgerRepository(storage);
  }

  export(): BackupPayload {
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      profile: this.profileRepository.get(),
      familyMembers: this.familyRepository.getAll(),
      diet: this.dietRepository.getAll(),
      workout: this.workoutRepository.getAll(),
      studyPlans: this.studyPlanRepository.getAll(),
      studyCheckins: this.studyCheckinRepository.getAll(),
      mealPlans: this.mealPlanRepository.getAll(),
      travelPlans: this.travelRepository.getAll(),
      transactions: this.ledgerRepository.getAll(),
    };
  }

  import(payload: BackupPayload): void {
    const result = validateBackupPayload(payload);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    this.clearAllData();

    if (payload.profile) {
      this.profileRepository.save(payload.profile);
    }

    this.familyRepository.saveAll(payload.familyMembers);
    this.studyPlanRepository.saveAll(payload.studyPlans);
    this.travelRepository.saveAll(payload.travelPlans);

    const dietByDate = groupByDate(payload.diet);
    const workoutByDate = groupByDate(payload.workout);
    const checkinByDate = groupByDate(payload.studyCheckins);
    const mealByDate = groupByDate(payload.mealPlans);
    const txnByDate = groupByDate(payload.transactions);

    for (const [date, entries] of dietByDate) {
      this.dietRepository.saveByDate(date, entries);
    }
    for (const [date, entries] of workoutByDate) {
      this.workoutRepository.saveByDate(date, entries);
    }
    for (const [date, entries] of checkinByDate) {
      this.studyCheckinRepository.saveByDate(date, entries);
    }
    for (const [date, entries] of mealByDate) {
      this.mealPlanRepository.saveByDate(date, entries);
    }
    for (const [date, entries] of txnByDate) {
      this.ledgerRepository.saveByDate(date, entries);
    }
  }

  private clearAllData(): void {
    for (const key of this.storage.keys()) {
      if (key.startsWith(STORAGE_PREFIX)) {
        this.storage.removeItem(key);
      }
    }
  }

  /**
   * 读上一次「上传本机数据到云端」的结果快照（没有则返回 `null`）。
   *
   * 解析失败一律当作「没有留档」而不是抛错：这份记录只用于**展示**，
   * 让它有本事把整个页面打挂是不划算的（与 `parseStoredArray` 的取舍不同 ——
   * 那里滤掉的是用户数据，这里只是一条统计）。
   */
  readImportRecord(): CloudImportRecord | null {
    const raw = this.storage.getItem(IMPORT_RECORD_KEY);
    if (!raw) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      const record = parsed as Partial<CloudImportRecord>;
      if (typeof record.finishedAt !== 'string') {
        return null;
      }
      const num = (value: unknown): number =>
        typeof value === 'number' && Number.isFinite(value) ? value : 0;
      return {
        finishedAt: record.finishedAt,
        attempted: num(record.attempted),
        created: num(record.created),
        duplicated: num(record.duplicated),
        failed: num(record.failed),
        skippedDuplicates: num(record.skippedDuplicates),
      };
    } catch {
      return null;
    }
  }

  saveImportRecord(record: CloudImportRecord): void {
    this.storage.setItem(IMPORT_RECORD_KEY, JSON.stringify(record));
  }
}
