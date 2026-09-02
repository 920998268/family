import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { ProfileRepository } from '@/repositories/ProfileRepository';
import { DietRepository } from '@/repositories/DietRepository';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';
import { ProfileService } from '@/services/ProfileService';
import { DietService } from '@/services/DietService';
import { WorkoutService } from '@/services/WorkoutService';
import { BackupService } from '@/services/BackupService';
import { isValidDateKey, todayKey } from '@/utils/date';
import { validateBackupPayload, validateDietEntry, validateProfile } from '@/utils/validation';
import { mealLabel, nutritionText, workoutText } from '@/utils/format';
import { errorMessage } from '@/utils/error';
import { groupByDate } from '@/utils/collections';
import type { BackupPayload, DietEntry, Profile, WorkoutEntry } from '@/types/models';

const profile: Profile = {
  gender: 'male',
  birthDate: '1990-01-01',
  heightCm: 178,
  currentWeightKg: 80,
  targetWeightKg: 75,
};

describe('date utilities', () => {
  it('validates and formats date keys', () => {
    expect(isValidDateKey('2026-09-02')).toBe(true);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('02/09/2026')).toBe(false);
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('shared formatting utilities', () => {
  it('builds compact nutrition and workout summaries', () => {
    const diet: DietEntry = {
      id: 'diet-1',
      date: '2026-09-02',
      mealType: 'lunch',
      foodName: '鸡胸肉',
      quantity: '200g',
      calories: 300,
      protein: 45,
    };
    const workout: WorkoutEntry = {
      id: 'workout-1',
      date: '2026-09-02',
      exerciseName: '卧推',
      sets: [
        { id: 'set-1', order: 1, reps: 8, weightKg: 60 },
        { id: 'set-2', order: 2, reps: 6, weightKg: 65 },
      ],
    };

    expect(mealLabel(diet)).toBe('午餐');
    expect(nutritionText(diet)).toBe('热量 300 千卡 · 蛋白质 45g');
    expect(workoutText(workout)).toBe('60kg × 8 / 65kg × 6');
  });

  it('returns the underlying error message', () => {
    expect(errorMessage(new Error('保存失败'))).toBe('保存失败');
    expect(errorMessage('unknown')).toBe('请稍后重试');
    expect(errorMessage('unknown', '请检查填写内容')).toBe('请检查填写内容');
  });
});

describe('collection helpers', () => {
  it('groups dated entries by their date', () => {
    const entries = [
      { date: '2026-09-02', id: 'a' },
      { date: '2026-09-03', id: 'b' },
      { date: '2026-09-02', id: 'c' },
    ];

    expect(groupByDate(entries)).toEqual(
      new Map([
        ['2026-09-02', [entries[0], entries[2]]],
        ['2026-09-03', [entries[1]]],
      ]),
    );
  });
});

describe('validation', () => {
  it('accepts a valid profile', () => {
    expect(validateProfile(profile)).toEqual({ valid: true, errors: [] });
  });

  it('rejects invalid profile fields', () => {
    const result = validateProfile({ ...profile, heightCm: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors.join('')).toContain('身高');
  });

  it('accepts a valid diet entry', () => {
    const entry: DietEntry = {
      id: 'diet-1',
      date: '2026-09-02',
      mealType: 'lunch',
      foodName: '鸡胸肉',
      quantity: '200g',
      calories: 300,
      protein: 45,
    };

    expect(validateDietEntry(entry).valid).toBe(true);
  });

  it('rejects a backup with invalid entries', () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile,
      diet: [
        {
          id: 'diet-1',
          date: '2026-09-02',
          mealType: 'lunch',
          foodName: '',
          quantity: '1碗',
        },
      ],
      workout: [],
    };

    expect(validateBackupPayload(payload).valid).toBe(false);
  });
});

describe('repositories', () => {
  let storage: InMemoryStorageAdapter;
  let profileRepository: ProfileRepository;
  let dietRepository: DietRepository;
  let workoutRepository: WorkoutRepository;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    profileRepository = new ProfileRepository(storage);
    dietRepository = new DietRepository(storage);
    workoutRepository = new WorkoutRepository(storage);
  });

  it('persists and reads the profile', () => {
    profileRepository.save(profile);
    expect(profileRepository.get()).toEqual(profile);
    profileRepository.clear();
    expect(profileRepository.get()).toBeNull();
  });

  it('persists diet entries by date and ignores malformed data', () => {
    const diet: DietEntry[] = [
      {
        id: 'diet-1',
        date: '2026-09-02',
        mealType: 'breakfast',
        foodName: '鸡蛋',
        quantity: '2个',
      },
    ];

    dietRepository.saveByDate('2026-09-02', diet);
    expect(dietRepository.getByDate('2026-09-02')).toEqual(diet);
    expect(dietRepository.getByDate('2026-09-03')).toEqual([]);

    const malformedEntry = {
      id: 'bad',
      date: '2026-09-04',
      mealType: 'lunch',
      foodName: '',
      quantity: '',
    };
    storage.setItem(
      'fitness.diet.v1.2026-09-04',
      JSON.stringify([malformedEntry]),
    );
    expect(dietRepository.getByDate('2026-09-04')).toEqual([]);
  });

  it('persists workout entries by date', () => {
    const workout: WorkoutEntry[] = [
      {
        id: 'workout-1',
        date: '2026-09-02',
        exerciseName: '卧推',
        sets: [{ id: 'set-1', order: 1, reps: 8, weightKg: 60 }],
      },
    ];

    workoutRepository.saveByDate('2026-09-02', workout);
    expect(workoutRepository.getByDate('2026-09-02')).toEqual(workout);
  });
});

describe('services', () => {
  let storage: InMemoryStorageAdapter;
  let dietService: DietService;
  let workoutService: WorkoutService;
  let profileService: ProfileService;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    profileService = new ProfileService(new ProfileRepository(storage));
    dietService = new DietService(new DietRepository(storage));
    workoutService = new WorkoutService(new WorkoutRepository(storage));
  });

  it('performs profile save validation', () => {
    expect(() => profileService.save({ ...profile, gender: 'invalid' as never })).toThrow();
    expect(profileService.save(profile)).toEqual(profile);
  });

  it('adds, updates, and removes diet entries', () => {
    const added = dietService.add('2026-09-02', {
      mealType: 'dinner',
      foodName: '米饭',
      quantity: '300g',
    });
    expect(dietService.listByDate('2026-09-02')).toHaveLength(1);

    dietService.update('2026-09-02', added.id, { foodName: '糙米饭' });
    expect(dietService.listByDate('2026-09-02')[0].foodName).toBe('糙米饭');

    dietService.remove('2026-09-02', added.id);
    expect(dietService.listByDate('2026-09-02')).toEqual([]);
  });

  it('adds and edits workout entries with ordered sets', () => {
    const added = workoutService.add('2026-09-02', {
      exerciseName: '深蹲',
      sets: [
        { reps: 5, weightKg: 100 },
        { reps: 5, weightKg: 105 },
      ],
    });

    expect(added.sets.map((set) => set.order)).toEqual([1, 2]);

    workoutService.update('2026-09-02', added.id, {
      sets: [{ reps: 3, weightKg: 110 }],
    });

    expect(workoutService.listByDate('2026-09-02')[0].sets[0].order).toBe(1);
  });

  it('exports and imports a complete backup', () => {
    profileService.save(profile);
    dietService.add('2026-09-02', {
      mealType: 'breakfast',
      foodName: '燕麦',
      quantity: '50g',
    });
    workoutService.add('2026-09-02', {
      exerciseName: '硬拉',
      sets: [{ reps: 5, weightKg: 120 }],
    });

    const backupService = new BackupService(storage);
    const exported = backupService.export();
    expect(exported.diet).toHaveLength(1);
    expect(exported.workout).toHaveLength(1);

    const freshStorage = new InMemoryStorageAdapter();
    const freshBackupService = new BackupService(freshStorage);
    freshBackupService.import(exported as BackupPayload);

    expect(new ProfileRepository(freshStorage).get()).toEqual(profile);
    expect(new DietRepository(freshStorage).getAll()).toHaveLength(1);
    expect(new WorkoutRepository(freshStorage).getAll()).toHaveLength(1);
  });
});

