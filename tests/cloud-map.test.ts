import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DietEntry, WorkoutEntry } from '@/types/models';
import {
  fromCloudDiet,
  fromCloudFood,
  fromCloudWorkout,
  mapCloudDiets,
  mapCloudFoods,
  mapCloudWorkouts,
  toCloudDiet,
  toCloudWorkout,
} from '@/utils/cloudMap';
import {
  validateDietEntry,
  validateFavoriteFood,
  validateWorkoutEntry,
} from '@/utils/validation';

const dietEntry = (overrides: Partial<DietEntry> = {}): DietEntry => ({
  id: 'diet-1',
  date: '2026-09-11',
  mealType: 'lunch',
  foodName: '鸡胸肉',
  quantity: '200g',
  ...overrides,
});

const strengthEntry = (overrides: Partial<WorkoutEntry> = {}): WorkoutEntry => ({
  id: 'workout-1',
  date: '2026-09-11',
  category: 'strength',
  exerciseName: '卧推',
  sets: [{ id: 'set-1', order: 1, reps: 8, weightKg: 60 }],
  ...overrides,
});

const cardioEntry = (overrides: Partial<WorkoutEntry> = {}): WorkoutEntry => ({
  id: 'workout-2',
  date: '2026-09-11',
  category: 'cardio',
  exerciseName: '跑步',
  sets: [],
  durationMin: 30,
  distanceKm: 5.2,
  ...overrides,
});

describe('toCloudDiet（前端 → diet 云函数）', () => {
  it('id 改名为 clientId，未填写的选填项显式写 null', () => {
    expect(toCloudDiet(dietEntry())).toEqual({
      clientId: 'diet-1',
      date: '2026-09-11',
      mealType: 'lunch',
      foodName: '鸡胸肉',
      quantity: '200g',
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
      memberId: null,
    });
  });

  it('已填写的营养值与成员原样透传', () => {
    const payload = toCloudDiet(
      dietEntry({ calories: 300, protein: 40, carbs: 5, fat: 8, memberId: 'm-1' }),
    );

    expect(payload).toMatchObject({
      calories: 300,
      protein: 40,
      carbs: 5,
      fat: 8,
      memberId: 'm-1',
    });
  });

  it('营养值为 0 不能退化成 null（0 是合法数值）', () => {
    expect(toCloudDiet(dietEntry({ calories: 0, fat: 0 }))).toMatchObject({
      calories: 0,
      fat: 0,
    });
  });

  it('空串 memberId 归一为 null，避免云端把空串当合法 id', () => {
    expect(toCloudDiet(dietEntry({ memberId: '' })).memberId).toBeNull();
  });
});

describe('toCloudWorkout（前端 → workout 云函数）', () => {
  it('力量记录：category 与组明细原样上行，有氧字段为 null', () => {
    const payload = toCloudWorkout(strengthEntry());

    expect(payload).toMatchObject({
      clientId: 'workout-1',
      category: 'strength',
      exerciseName: '卧推',
      durationMin: null,
      distanceKm: null,
      calories: null,
      memberId: null,
    });
    expect(payload.sets).toHaveLength(1);
  });

  it('有氧记录：sets 为空数组，时长与距离上行', () => {
    const payload = toCloudWorkout(cardioEntry());

    expect(payload).toMatchObject({
      category: 'cardio',
      durationMin: 30,
      distanceKm: 5.2,
    });
    expect(payload.sets).toEqual([]);
  });

  it('老记录没有 category 时，按「有组明细 = 力量」补全后再上行', () => {
    const legacy: WorkoutEntry = {
      id: 'workout-legacy',
      date: '2026-09-11',
      exerciseName: '深蹲',
      sets: [{ id: 'set-1', order: 1, reps: 10, weightKg: 80 }],
    };

    expect(toCloudWorkout(legacy).category).toBe('strength');
  });

  it('既无 category 也无组明细时推断为有氧', () => {
    const legacy: WorkoutEntry = {
      id: 'workout-legacy-2',
      date: '2026-09-11',
      exerciseName: '快走',
      sets: [],
      durationMin: 20,
    };

    expect(toCloudWorkout(legacy).category).toBe('cardio');
  });

  it('sets 缺失时不抛异常，按空数组上行', () => {
    const broken = { ...strengthEntry(), sets: undefined } as unknown as WorkoutEntry;

    expect(toCloudWorkout(broken).sets).toEqual([]);
  });
});

describe('fromCloudDiet（diet 云函数 → 前端）', () => {
  /** 服务端 `toClientDiet` 的真实产出形态：未填写字段是 null */
  const serverRow = {
    id: 'diet-1',
    date: '2026-09-11',
    mealType: 'lunch',
    foodName: '鸡胸肉',
    quantity: '200g',
    calories: 300,
    protein: null,
    carbs: null,
    fat: null,
  };

  it('把云端 null 还原为 undefined，产出物能通过前端校验', () => {
    const entry = fromCloudDiet(serverRow);

    expect(entry.protein).toBeUndefined();
    expect(entry.carbs).toBeUndefined();
    expect(entry.fat).toBeUndefined();
    expect(entry.calories).toBe(300);
    expect(validateDietEntry(entry)).toEqual({ valid: true, errors: [] });
  });

  it('还原 null 是必须的：云端裸记录直接交给前端校验会被判为非法', () => {
    // 守住这条规则——若 fromCloudDiet 改成透传 null，后半句立即失败
    // （前端 numberError 只放行 undefined，null 会命中「必须是数字」）
    expect(validateDietEntry(serverRow).valid).toBe(false);
    expect(validateDietEntry(fromCloudDiet(serverRow)).valid).toBe(true);
  });

  it('裸库文档（只有 _id / clientId）也能取到 id', () => {
    expect(fromCloudDiet({ _id: 'doc-1', date: '2026-09-11' }).id).toBe('doc-1');
    expect(fromCloudDiet({ clientId: 'c-1', date: '2026-09-11' }).id).toBe('c-1');
  });

  it('餐次非法时回退为 breakfast，不整条丢弃', () => {
    expect(fromCloudDiet({ ...serverRow, mealType: 'brunch' }).mealType).toBe('breakfast');
  });

  it('入参为空对象时不抛异常', () => {
    expect(() => fromCloudDiet(undefined)).not.toThrow();
    expect(fromCloudDiet(null).id).toBe('');
  });
});

describe('fromCloudWorkout（workout 云函数 → 前端）', () => {
  it('力量记录：order 一律按数组下标重排', () => {
    const entry = fromCloudWorkout({
      id: 'w-1',
      date: '2026-09-11',
      category: 'strength',
      exerciseName: '卧推',
      sets: [
        { id: 'a', order: 9, reps: 8, weightKg: 60 },
        { id: 'b', order: 3, reps: 10, weightKg: 50 },
      ],
      durationMin: null,
      distanceKm: null,
      calories: null,
    });

    expect(entry.sets.map((s) => s.order)).toEqual([1, 2]);
    expect(validateWorkoutEntry(entry)).toEqual({ valid: true, errors: [] });
  });

  it('组明细缺 id 时补 set-<n>（否则前端 isWorkoutSet 会判非法并丢弃整条）', () => {
    const entry = fromCloudWorkout({
      id: 'w-2',
      date: '2026-09-11',
      category: 'strength',
      exerciseName: '卧推',
      sets: [{ reps: 8, weightKg: 60 }],
    });

    expect(entry.sets[0].id).toBe('set-1');
    expect(validateWorkoutEntry(entry).valid).toBe(true);
  });

  it('有氧记录：时长 / 距离还原为数字，sets 为空数组', () => {
    const entry = fromCloudWorkout({
      id: 'w-3',
      date: '2026-09-11',
      category: 'cardio',
      exerciseName: '跑步',
      sets: [],
      durationMin: 30,
      distanceKm: 5.2,
      calories: 260,
    });

    expect(entry).toMatchObject({ category: 'cardio', durationMin: 30, distanceKm: 5.2 });
    expect(entry.sets).toEqual([]);
    expect(validateWorkoutEntry(entry)).toEqual({ valid: true, errors: [] });
  });

  it('老记录没有 category 时推断为力量，不被丢弃（兼容守卫）', () => {
    const entry = fromCloudWorkout({
      id: 'w-legacy',
      date: '2026-09-11',
      exerciseName: '深蹲',
      sets: [{ id: 'set-1', order: 1, reps: 10, weightKg: 80 }],
    });

    expect(entry.category).toBe('strength');
    expect(validateWorkoutEntry(entry).valid).toBe(true);
  });

  it('有氧的 null 时长还原为 undefined（不是 null），避免判为「时长不合法」', () => {
    const entry = fromCloudWorkout({
      id: 'w-4',
      date: '2026-09-11',
      category: 'cardio',
      exerciseName: '跑步',
      sets: [],
      durationMin: 30,
      distanceKm: null,
    });

    expect(entry.distanceKm).toBeUndefined();
    expect(validateWorkoutEntry(entry).valid).toBe(true);
  });
});

describe('fromCloudFood（常用食物）', () => {
  it('useCount 缺失时回退为 0，产出物通过校验', () => {
    const food = fromCloudFood({
      _id: 'f-1',
      name: '牛奶',
      quantity: '1 杯',
      calories: 150,
      useCount: null,
      lastUsedAt: 1730000000000,
    });

    expect(food.useCount).toBe(0);
    expect(food.lastUsedAt).toBe(1730000000000);
    expect(validateFavoriteFood(food)).toEqual({ valid: true, errors: [] });
  });

  it('数量为空的记录会被前端校验拦下（刻意的：无数量无法一键带出）', () => {
    const food = fromCloudFood({ _id: 'f-2', name: '水', quantity: '', useCount: 1 });

    expect(validateFavoriteFood(food).valid).toBe(false);
  });
});

describe('列表映射与非法行过滤', () => {
  it('非数组入参返回空数组', () => {
    expect(mapCloudDiets(undefined)).toEqual([]);
    expect(mapCloudWorkouts(null)).toEqual([]);
    expect(mapCloudFoods('oops')).toEqual([]);
  });

  it('混入非法行时只保留合法行（本地缓存/仓库用的是同一套校验）', () => {
    const rows = [
      { id: 'ok', date: '2026-09-11', mealType: 'lunch', foodName: '米饭', quantity: '1 碗' },
      { id: '', date: '2026-09-11', mealType: 'lunch', foodName: '米饭', quantity: '1 碗' },
      { id: 'bad-date', date: '2026/09/11', mealType: 'lunch', foodName: '米饭', quantity: '1 碗' },
      null,
    ];

    expect(mapCloudDiets(rows).map((e) => e.id)).toEqual(['ok']);
  });

  it('运动列表：合法力量 + 合法有氧都保留', () => {
    const rows = [
      {
        id: 'w-1',
        date: '2026-09-11',
        category: 'strength',
        exerciseName: '卧推',
        sets: [{ id: 'set-1', order: 1, reps: 8, weightKg: 60 }],
      },
      {
        id: 'w-2',
        date: '2026-09-11',
        category: 'cardio',
        exerciseName: '跑步',
        sets: [],
        durationMin: 30,
      },
    ];

    expect(mapCloudWorkouts(rows).map((e) => e.id)).toEqual(['w-1', 'w-2']);
  });

  it('常用食物列表：过滤掉没有数量的噪点记录', () => {
    const rows = [
      { _id: 'f-1', name: '牛奶', quantity: '1 杯', useCount: 3 },
      { _id: 'f-2', name: '水', quantity: '', useCount: 1 },
    ];

    expect(mapCloudFoods(rows).map((f) => f.name)).toEqual(['牛奶']);
  });
});

describe('云调用封装（源码级守卫）', () => {
  const SOURCE = readFileSync(join(process.cwd(), 'src/unicloud/index.ts'), 'utf8');

  /** 去掉注释，避免注释里对裸调用的说明被误判为真实代码 */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  }

  const code = stripComments(SOURCE);

  it('不得出现裸 uniCloud.xxx 调用（会命中框架静态快照）', () => {
    expect(/(^|[^.\w$])uniCloud\s*\./.test(code)).toBe(false);
  });

  it('云函数调用必须经 getCloud()', () => {
    expect(code.includes('getCloud().callFunction')).toBe(true);
  });

  it('确实声明了 diet / workout 两个云函数入口', () => {
    expect(code.includes("name: 'diet'")).toBe(true);
    expect(code.includes("name: 'workout'")).toBe(true);
  });
});

describe('云调用封装（行为）', () => {
  function stubCloudResult(result: unknown) {
    const callFunction = vi.fn().mockResolvedValue({ result });
    vi.stubGlobal('uniCloud', { callFunction });
    return callFunction;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('addCloudDiet 以 entry.id 作为 clientId 上报，action 为 add', async () => {
    const { addCloudDiet } = await import('@/unicloud');
    const callFunction = stubCloudResult({ code: 0, data: { _id: 'doc-1' } });

    await expect(addCloudDiet(dietEntry({ calories: 300 }))).resolves.toEqual({ _id: 'doc-1' });
    expect(callFunction).toHaveBeenCalledWith({
      name: 'diet',
      data: {
        action: 'add',
        clientId: 'diet-1',
        date: '2026-09-11',
        mealType: 'lunch',
        foodName: '鸡胸肉',
        quantity: '200g',
        calories: 300,
        protein: null,
        carbs: null,
        fat: null,
        memberId: null,
      },
    });
  });

  it('listCloudDiets 把云端返回映射成前端记录', async () => {
    const { listCloudDiets } = await import('@/unicloud');
    const callFunction = stubCloudResult({
      code: 0,
      data: [
        {
          id: 'diet-1',
          date: '2026-09-11',
          mealType: 'lunch',
          foodName: '鸡胸肉',
          quantity: '200g',
          calories: null,
        },
      ],
    });

    const list = await listCloudDiets('2026-09-11');

    expect(callFunction).toHaveBeenCalledWith({
      name: 'diet',
      data: { action: 'list', date: '2026-09-11' },
    });
    expect(list).toHaveLength(1);
    expect(list[0].calories).toBeUndefined();
  });

  it('removeCloudDiet 只上报 clientId，并透传幂等结果', async () => {
    const { removeCloudDiet } = await import('@/unicloud');
    const callFunction = stubCloudResult({ code: 0, data: { removed: false } });

    // 服务端「记录不存在」也返回 code 0，调用方据此区分「删掉了」与「本来就没有」
    await expect(removeCloudDiet('diet-1')).resolves.toEqual({ removed: false });
    expect(callFunction).toHaveBeenCalledWith({
      name: 'diet',
      data: { action: 'remove', clientId: 'diet-1' },
    });
  });

  it('addCloudDiet 透传服务端的 duplicated 幂等标记', async () => {
    const { addCloudDiet } = await import('@/unicloud');
    stubCloudResult({ code: 0, data: { _id: 'doc-1', duplicated: true } });

    await expect(addCloudDiet(dietEntry())).resolves.toEqual({
      _id: 'doc-1',
      duplicated: true,
    });
  });

  it('列表接口无关键字时不发送空 keyword 键', async () => {
    const { listCloudFavoriteFoods } = await import('@/unicloud');
    const callFunction = stubCloudResult({ code: 0, data: [] });

    await listCloudFavoriteFoods();
    expect(callFunction).toHaveBeenCalledWith({
      name: 'diet',
      data: { action: 'listFoods' },
    });
  });

  it('updateCloudDiet 发送完整记录：清空的字段写 null 而不是省略键', async () => {
    const { updateCloudDiet } = await import('@/unicloud');
    const callFunction = stubCloudResult({ code: 0 });

    await updateCloudDiet(dietEntry());

    // 云端 mergeDietPatch 以「键缺失 = 不修改」为准，省略键会导致用户清空的营养值被旧值顶回来
    expect(callFunction).toHaveBeenCalledWith({
      name: 'diet',
      data: {
        action: 'update',
        clientId: 'diet-1',
        date: '2026-09-11',
        mealType: 'lunch',
        foodName: '鸡胸肉',
        quantity: '200g',
        calories: null,
        protein: null,
        carbs: null,
        fat: null,
        memberId: null,
      },
    });
  });

  it('removeCloudWorkout 走 workout 云函数', async () => {
    const { removeCloudWorkout } = await import('@/unicloud');
    const callFunction = stubCloudResult({ code: 0, data: { removed: true } });

    await expect(removeCloudWorkout('workout-1')).resolves.toEqual({ removed: true });
    expect(callFunction).toHaveBeenCalledWith({
      name: 'workout',
      data: { action: 'remove', clientId: 'workout-1' },
    });
  });

  it('云函数返回非 0 时抛出上游文案', async () => {
    const { addCloudWorkout } = await import('@/unicloud');
    stubCloudResult({ code: 400, msg: '有氧记录不应包含组明细' });

    await expect(addCloudWorkout(cardioEntry())).rejects.toThrow('有氧记录不应包含组明细');
  });

  it('无文案时回退到带函数名与 action 的通用提示', async () => {
    const { listCloudWorkouts } = await import('@/unicloud');
    stubCloudResult({ code: 500 });

    await expect(listCloudWorkouts('2026-09-11')).rejects.toThrow(
      'workout 云函数 [list] 调用失败',
    );
  });

  it('addCloudWorkout 上报归一化后的 category 与组明细', async () => {
    const { addCloudWorkout } = await import('@/unicloud');
    const callFunction = stubCloudResult({ code: 0, data: { _id: 'doc-2' } });

    await addCloudWorkout(strengthEntry());

    expect(callFunction).toHaveBeenCalledWith({
      name: 'workout',
      data: {
        action: 'add',
        clientId: 'workout-1',
        date: '2026-09-11',
        category: 'strength',
        exerciseName: '卧推',
        sets: [{ id: 'set-1', order: 1, reps: 8, weightKg: 60 }],
        durationMin: null,
        distanceKm: null,
        calories: null,
        memberId: null,
      },
    });
  });
});
