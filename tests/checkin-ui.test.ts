import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { FavoriteFood, WorkoutEntry } from '@/types/models';
import {
  favoriteFoodText,
  nutritionText,
  workoutCategoryLabel,
  workoutSummary,
  workoutText,
} from '@/utils/format';

const strength = (overrides: Partial<WorkoutEntry> = {}): WorkoutEntry => ({
  id: 'w-1',
  date: '2026-09-12',
  category: 'strength',
  exerciseName: '杠铃卧推',
  sets: [
    { id: 'set-1', order: 1, reps: 8, weightKg: 60 },
    { id: 'set-2', order: 2, reps: 6, weightKg: 65 },
  ],
  ...overrides,
});

const cardio = (overrides: Partial<WorkoutEntry> = {}): WorkoutEntry => ({
  id: 'w-2',
  date: '2026-09-12',
  category: 'cardio',
  exerciseName: '跑步',
  sets: [],
  durationMin: 30,
  distanceKm: 5.2,
  calories: 320,
  ...overrides,
});

const food = (overrides: Partial<FavoriteFood> = {}): FavoriteFood => ({
  id: 'f-1',
  name: '牛奶',
  quantity: '1 杯',
  calories: 150,
  useCount: 3,
  ...overrides,
});

describe('workoutSummary（列表副标题）', () => {
  it('力量记录带上组数汇总，方便一眼看出练了几组', () => {
    expect(workoutSummary(strength())).toBe('2 组 · 60kg × 8 / 65kg × 6');
  });

  it('单组力量记录同样带汇总', () => {
    const entry = strength({ sets: [{ id: 'set-1', order: 1, reps: 8, weightKg: 60 }] });

    expect(workoutSummary(entry)).toBe('1 组 · 60kg × 8');
  });

  it('有氧记录就是时长 / 距离 / 热量，不额外加组数', () => {
    expect(workoutSummary(cardio())).toBe('30 分钟 · 5.2 公里 · 320 千卡');
  });

  it('有氧只填时长时不出现多余分隔符', () => {
    expect(workoutSummary(cardio({ distanceKm: undefined, calories: undefined }))).toBe('30 分钟');
  });

  it('老记录没有 category 时按组明细推断为力量', () => {
    const legacy = {
      id: 'w-legacy',
      date: '2026-09-12',
      exerciseName: '深蹲',
      sets: [{ id: 'set-1', order: 1, reps: 10, weightKg: 80 }],
    } as WorkoutEntry;

    expect(workoutSummary(legacy)).toBe('1 组 · 80kg × 10');
  });

  it('不改变 workoutText 的既有输出（列表外的展示不受影响）', () => {
    expect(workoutText(strength())).toBe('60kg × 8 / 65kg × 6');
    expect(workoutText(cardio())).toBe('30 分钟 · 5.2 公里 · 320 千卡');
  });
});

describe('workoutCategoryLabel', () => {
  it('按类型给出中文标签', () => {
    expect(workoutCategoryLabel(strength())).toBe('力量');
    expect(workoutCategoryLabel(cardio())).toBe('有氧');
  });

  it('老记录按组明细推断', () => {
    const legacy = {
      id: 'w-legacy',
      date: '2026-09-12',
      exerciseName: '快走',
      sets: [],
      durationMin: 20,
    } as WorkoutEntry;

    expect(workoutCategoryLabel(legacy)).toBe('有氧');
  });
});

describe('nutritionText / favoriteFoodText', () => {
  it('nutritionText 现在也接受常用食物（字段同构）', () => {
    // 单位串本身带前导空格（' 千卡'），输出是「热量 150 千卡」
    expect(nutritionText(food())).toBe('热量 150 千卡');
  });

  it('常用食物摘要 = 数量 + 营养', () => {
    expect(favoriteFoodText(food({ protein: 8, carbs: 12 }))).toBe(
      '1 杯 · 热量 150 千卡 · 蛋白质 8g · 碳水 12g',
    );
  });

  it('没填营养时只显示数量', () => {
    expect(favoriteFoodText(food({ calories: undefined }))).toBe('1 杯');
  });
});

describe('UI 源码守卫', () => {
  const read = (relativePath: string) =>
    readFileSync(join(process.cwd(), relativePath), 'utf8');

  it('运动表单有类型切换，并区分力量 / 有氧两组字段', () => {
    const source = read('src/components/WorkoutForm.vue');

    expect(source).toContain('WORKOUT_CATEGORIES');
    expect(source).toContain('categoryNames');
    // 有氧专属字段
    expect(source).toContain('durationMin');
    expect(source).toContain('distanceKm');
    // 力量才展示组明细
    expect(source).toMatch(/v-if="!isCardio"/);
  });

  it('运动表单的提交统一走纯函数校验，不再直接 emit 原始输入', () => {
    const source = read('src/components/WorkoutForm.vue');

    expect(source).toContain('buildWorkoutDraft');
    // 旧写法是直接 emit 拼出来的对象，容易出现「有氧缺时长」这类漏校验
    expect(source).not.toMatch(/emit\('save',\s*\{\s*exerciseName:\s*exerciseName\.value/);
  });

  it('饮食表单有「常用」入口与一键带出', () => {
    const source = read('src/components/DietForm.vue');

    expect(source).toContain('useFavoriteFoodStore');
    expect(source).toContain('toggleFavorites');
    expect(source).toContain('applyFavorite');
    expect(source).toContain('favoriteFoodText');
  });

  it('运动列表按类型展示，力量记录带组数汇总', () => {
    const source = read('src/pages/checkin/workout.vue');

    expect(source).toContain('workoutSummary');
    expect(source).toContain('workoutCategoryLabel');
    expect(source).not.toContain('workoutText(entry)');
  });
});
