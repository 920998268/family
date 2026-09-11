import { describe, it, expect } from 'vitest';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';
import {
  validateBackupPayload,
  validateFavoriteFood,
  validateWorkoutEntry,
} from '@/utils/validation';
import { isCardioEntry, normalizeWorkoutCategory, withWorkoutCategory } from '@/utils/workout';
import { workoutText } from '@/utils/format';
import type { BackupPayload, FavoriteFood, WorkoutEntry } from '@/types/models';

const DATE = '2026-09-11';

/** 0.3.2 之前的记录形态：**没有 category 字段** */
const legacyWorkout: WorkoutEntry = {
  id: 'workout-legacy',
  date: DATE,
  exerciseName: '卧推',
  sets: [{ id: 'set-1', order: 1, reps: 8, weightKg: 60 }],
};

const strengthWorkout: WorkoutEntry = {
  id: 'workout-strength',
  date: DATE,
  category: 'strength',
  exerciseName: '深蹲',
  sets: [
    { id: 'set-1', order: 1, reps: 10, weightKg: 80 },
    { id: 'set-2', order: 2, reps: 8, weightKg: 85 },
  ],
};

const cardioWorkout: WorkoutEntry = {
  id: 'workout-cardio',
  date: DATE,
  category: 'cardio',
  exerciseName: '跑步',
  sets: [],
  durationMin: 30,
  distanceKm: 5.2,
  calories: 320,
};

describe('运动类型归一化', () => {
  it('老记录没有 category 时按「有组明细 = 力量」推断', () => {
    expect(normalizeWorkoutCategory({ category: undefined, sets: legacyWorkout.sets })).toBe(
      'strength',
    );
  });

  it('显式 category 优先于推断', () => {
    expect(normalizeWorkoutCategory({ category: 'cardio', sets: legacyWorkout.sets })).toBe(
      'cardio',
    );
    expect(normalizeWorkoutCategory({ category: 'strength', sets: [] })).toBe('strength');
  });

  it('既无 category 又无组明细时推断为有氧', () => {
    expect(normalizeWorkoutCategory({ category: undefined, sets: [] })).toBe('cardio');
  });

  it('isCardioEntry 兼容老记录', () => {
    expect(isCardioEntry(legacyWorkout)).toBe(false);
    expect(isCardioEntry(strengthWorkout)).toBe(false);
    expect(isCardioEntry(cardioWorkout)).toBe(true);
  });

  it('withWorkoutCategory 只补齐 category，不改动其他字段', () => {
    expect(withWorkoutCategory(legacyWorkout)).toEqual({
      ...legacyWorkout,
      category: 'strength',
    });
  });
});

describe('老记录兼容（不得被静默丢弃）', () => {
  it('无 category 的老记录通过校验', () => {
    expect(validateWorkoutEntry(legacyWorkout)).toEqual({ valid: true, errors: [] });
  });

  it('经 Repository 存取后老记录仍然存在', () => {
    const repository = new WorkoutRepository(new InMemoryStorageAdapter());
    repository.saveByDate(DATE, [legacyWorkout]);

    expect(repository.getByDate(DATE)).toEqual([legacyWorkout]);
  });

  it('新老记录混存时全部保留', () => {
    const repository = new WorkoutRepository(new InMemoryStorageAdapter());
    repository.saveByDate(DATE, [legacyWorkout, strengthWorkout, cardioWorkout]);

    expect(repository.getByDate(DATE)).toHaveLength(3);
    expect(repository.getAll()).toHaveLength(3);
  });

  it('备份文件里的老训练记录不被判为非法', () => {
    const payload: BackupPayload = {
      version: 2,
      exportedAt: '2026-09-11T00:00:00.000Z',
      profile: null,
      familyMembers: [],
      diet: [],
      workout: [legacyWorkout],
      studyPlans: [],
      studyCheckins: [],
      mealPlans: [],
      travelPlans: [],
      transactions: [],
    };

    expect(validateBackupPayload(payload)).toEqual({ valid: true, errors: [] });
  });
});

describe('力量训练校验', () => {
  it('合法力量记录通过', () => {
    expect(validateWorkoutEntry(strengthWorkout).valid).toBe(true);
  });

  it('仍要求至少一组训练明细', () => {
    const result = validateWorkoutEntry({ ...strengthWorkout, sets: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.join('；')).toContain('至少需要一组训练明细');
  });

  it('组序号不连续被拒绝', () => {
    const result = validateWorkoutEntry({
      ...strengthWorkout,
      sets: [{ id: 'set-1', order: 3, reps: 10, weightKg: 80 }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('；')).toContain('序号不连续');
  });

  it('组明细数值超范围被拒绝', () => {
    const result = validateWorkoutEntry({
      ...strengthWorkout,
      sets: [{ id: 'set-1', order: 1, reps: 0, weightKg: 80 }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('；')).toContain('次数');
  });
});

describe('有氧训练校验', () => {
  it('合法有氧记录通过', () => {
    expect(validateWorkoutEntry(cardioWorkout)).toEqual({ valid: true, errors: [] });
  });

  it('缺少时长被拒绝', () => {
    const result = validateWorkoutEntry({
      ...cardioWorkout,
      durationMin: undefined,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('；')).toContain('运动时长不能为空');
  });

  it('时长为 0 或超范围被拒绝', () => {
    expect(validateWorkoutEntry({ ...cardioWorkout, durationMin: 0 }).valid).toBe(false);
    expect(validateWorkoutEntry({ ...cardioWorkout, durationMin: 2000 }).valid).toBe(false);
  });

  it('距离与消耗热量均为选填', () => {
    const result = validateWorkoutEntry({
      ...cardioWorkout,
      distanceKm: undefined,
      calories: undefined,
    });
    expect(result.valid).toBe(true);
  });

  it('距离超范围被拒绝', () => {
    expect(validateWorkoutEntry({ ...cardioWorkout, distanceKm: 5000 }).valid).toBe(false);
  });

  it('有氧记录携带组明细被拒绝', () => {
    const result = validateWorkoutEntry({ ...cardioWorkout, sets: legacyWorkout.sets });
    expect(result.valid).toBe(false);
    expect(result.errors.join('；')).toContain('有氧记录不应包含组明细');
  });
});

describe('category 取值校验', () => {
  it('非法类型被拒绝', () => {
    const result = validateWorkoutEntry({
      ...strengthWorkout,
      category: 'yoga' as never,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('；')).toContain('运动类型不合法');
  });

  it('category 缺省不视为非法', () => {
    const result = validateWorkoutEntry({ ...strengthWorkout, category: undefined });
    expect(result.valid).toBe(true);
  });
});

describe('workoutText 展示', () => {
  it('力量记录保持原有文案', () => {
    expect(workoutText(legacyWorkout)).toBe('60kg × 8');
    expect(workoutText(strengthWorkout)).toBe('80kg × 10 / 85kg × 8');
  });

  it('有氧记录展示时长 / 距离 / 消耗', () => {
    expect(workoutText(cardioWorkout)).toBe('30 分钟 · 5.2 公里 · 320 千卡');
  });

  it('有氧选填字段缺省时只展示时长', () => {
    expect(
      workoutText({ ...cardioWorkout, distanceKm: undefined, calories: undefined }),
    ).toBe('30 分钟');
  });
});

describe('常用食物校验', () => {
  const favoriteFood: FavoriteFood = {
    id: 'food-1',
    name: '牛奶',
    quantity: '1 杯',
    calories: 150,
    protein: 8,
    carbs: 12,
    fat: 5,
    useCount: 3,
  };

  it('合法记录通过', () => {
    expect(validateFavoriteFood(favoriteFood)).toEqual({ valid: true, errors: [] });
  });

  it('名称为空或数量为空被拒绝', () => {
    expect(validateFavoriteFood({ ...favoriteFood, name: '   ' }).valid).toBe(false);
    expect(validateFavoriteFood({ ...favoriteFood, quantity: '' }).valid).toBe(false);
  });

  it('使用次数缺失或为负被拒绝', () => {
    expect(
      validateFavoriteFood({ ...favoriteFood, useCount: undefined as never }).valid,
    ).toBe(false);
    expect(validateFavoriteFood({ ...favoriteFood, useCount: -1 }).valid).toBe(false);
  });

  it('营养字段可省略', () => {
    const result = validateFavoriteFood({
      id: 'food-2',
      name: '鸡蛋',
      quantity: '1 个',
      useCount: 1,
    });
    expect(result.valid).toBe(true);
  });

  it('营养字段超范围被拒绝', () => {
    const result = validateFavoriteFood({ ...favoriteFood, calories: -5 });
    expect(result.valid).toBe(false);
    expect(result.errors.join('；')).toContain('热量');
  });

  it('空对象被拒绝', () => {
    expect(validateFavoriteFood(null).valid).toBe(false);
  });
});
