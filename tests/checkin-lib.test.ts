import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

import { validateDietEntry, validateWorkoutEntry } from '@/utils/validation';

// 云函数 lib.js 为 CommonJS 纯逻辑模块，用 createRequire 加载（避免无类型声明的 TS 报错）
const require = createRequire(import.meta.url);
const dietLib = require('../uniCloud-alipay/cloudfunctions/diet/lib');
const workoutLib = require('../uniCloud-alipay/cloudfunctions/workout/lib');

const DATE = '2026-09-11';

/** 合法的饮食入参 */
function dietInput(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'diet-3f2a1b4c-9d8e-4a7b-8c6d-1e2f3a4b5c6d',
    date: DATE,
    mealType: 'lunch',
    foodName: '鸡胸肉',
    quantity: '200g',
    calories: 300,
    protein: 45,
    ...overrides,
  };
}

/** 合法的力量训练入参 */
function strengthInput(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'workout-1a2b3c4d',
    date: DATE,
    category: 'strength',
    exerciseName: '卧推',
    sets: [{ id: 'set-1', order: 1, reps: 8, weightKg: 60 }],
    ...overrides,
  };
}

/** 合法的有氧训练入参 */
function cardioInput(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'workout-5e6f7a8b',
    date: DATE,
    category: 'cardio',
    exerciseName: '跑步',
    durationMin: 30,
    distanceKm: 5.2,
    ...overrides,
  };
}

describe('diet 云函数纯逻辑', () => {
  describe('validateClientId', () => {
    it('拒绝空值与非字符串', () => {
      expect(dietLib.validateClientId('').ok).toBe(false);
      expect(dietLib.validateClientId('   ').ok).toBe(false);
      expect(dietLib.validateClientId(undefined).ok).toBe(false);
      expect(dietLib.validateClientId(123).ok).toBe(false);
    });

    it('拒绝超长与非法字符', () => {
      expect(dietLib.validateClientId('a'.repeat(65)).ok).toBe(false);
      expect(dietLib.validateClientId('diet/../../etc').ok).toBe(false);
      expect(dietLib.validateClientId('diet 空格').ok).toBe(false);
    });

    it('接受前端 createId 生成的形态', () => {
      expect(dietLib.validateClientId('diet-3f2a1b4c-9d8e-4a7b').ok).toBe(true);
    });
  });

  describe('validateDietPayload', () => {
    it('合法入参通过并归一化营养字段', () => {
      const result = dietLib.validateDietPayload(dietInput());
      expect(result.ok).toBe(true);
      expect(result.value).toMatchObject({
        clientId: 'diet-3f2a1b4c-9d8e-4a7b-8c6d-1e2f3a4b5c6d',
        date: DATE,
        mealType: 'lunch',
        foodName: '鸡胸肉',
        quantity: '200g',
        calories: 300,
        protein: 45,
        memberId: null,
      });
    });

    it('未填写的营养字段归一为 null 而不是 undefined', () => {
      const result = dietLib.validateDietPayload(dietInput({ calories: undefined, protein: undefined }));
      expect(result.value.calories).toBeNull();
      expect(result.value.protein).toBeNull();
    });

    it('拒绝非法餐次与空食物名', () => {
      expect(dietLib.validateDietPayload(dietInput({ mealType: 'brunch' })).ok).toBe(false);
      expect(dietLib.validateDietPayload(dietInput({ foodName: '  ' })).ok).toBe(false);
      expect(dietLib.validateDietPayload(dietInput({ quantity: '' })).ok).toBe(false);
    });

    it('拒绝超长食物名', () => {
      expect(dietLib.validateDietPayload(dietInput({ foodName: 'x'.repeat(41) })).ok).toBe(false);
    });

    it('拒绝非法日期格式', () => {
      expect(dietLib.validateDietPayload(dietInput({ date: '2026/09/11' })).ok).toBe(false);
      expect(dietLib.validateDietPayload(dietInput({ date: '' })).ok).toBe(false);
    });

    it('拒绝负数营养值并给出字段名', () => {
      const result = dietLib.validateDietPayload(dietInput({ calories: -5 }));
      expect(result.ok).toBe(false);
      expect(result.msg).toContain('热量');
    });

    it('食物名与数量会 trim', () => {
      const result = dietLib.validateDietPayload(dietInput({ foodName: ' 米饭 ', quantity: ' 1碗 ' }));
      expect(result.value.foodName).toBe('米饭');
      expect(result.value.quantity).toBe('1碗');
    });
  });

  describe('mergeDietPatch', () => {
    it('未传的字段保留既有值', () => {
      const existing = dietLib.validateDietPayload(dietInput()).value;
      const merged = dietLib.mergeDietPatch(existing, { calories: 500 });
      expect(merged.value.calories).toBe(500);
      expect(merged.value.foodName).toBe('鸡胸肉');
      expect(merged.value.date).toBe(DATE);
    });

    it('显式传空可清空可选字段', () => {
      const existing = dietLib.validateDietPayload(dietInput()).value;
      const merged = dietLib.mergeDietPatch(existing, { calories: '' });
      expect(merged.value.calories).toBe('');
      expect(dietLib.validateDietPayload(merged.value).value.calories).toBeNull();
    });

    it('合并后复校能发现被改坏的字段', () => {
      const existing = dietLib.validateDietPayload(dietInput()).value;
      const merged = dietLib.mergeDietPatch(existing, { mealType: 'brunch' });
      expect(dietLib.validateDietPayload(merged.value).ok).toBe(false);
    });
  });

  describe('validateListQuery', () => {
    it('按单日查询', () => {
      expect(dietLib.validateListQuery({ date: DATE })).toEqual({ ok: true, value: { date: DATE } });
    });

    it('按区间查询', () => {
      const result = dietLib.validateListQuery({ from: '2026-09-01', to: '2026-09-11' });
      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ from: '2026-09-01', to: '2026-09-11' });
    });

    it('缺少查询条件被拒绝', () => {
      expect(dietLib.validateListQuery({}).ok).toBe(false);
    });

    it('起始日期晚于结束日期被拒绝', () => {
      expect(dietLib.validateListQuery({ from: '2026-09-11', to: '2026-09-01' }).ok).toBe(false);
    });

    it('日期格式非法被拒绝', () => {
      expect(dietLib.validateListQuery({ date: '09-11' }).ok).toBe(false);
      expect(dietLib.validateListQuery({ from: 'bad' }).ok).toBe(false);
    });
  });

  describe('validateFoodQuery', () => {
    it('默认返回 20 条上限', () => {
      expect(dietLib.validateFoodQuery({}).value).toEqual({ limit: 20, keyword: '' });
    });

    it('limit 越界被拒绝', () => {
      expect(dietLib.validateFoodQuery({ limit: 0 }).ok).toBe(false);
      expect(dietLib.validateFoodQuery({ limit: 101 }).ok).toBe(false);
    });

    it('关键词会 trim 且限长', () => {
      expect(dietLib.validateFoodQuery({ keyword: ' 牛奶 ' }).value.keyword).toBe('牛奶');
      expect(dietLib.validateFoodQuery({ keyword: 'x'.repeat(21) }).ok).toBe(false);
    });
  });
});

describe('workout 云函数纯逻辑', () => {
  describe('normalizeCategory', () => {
    it('显式 category 优先', () => {
      expect(workoutLib.normalizeCategory({ category: 'cardio', sets: [] })).toBe('cardio');
      expect(workoutLib.normalizeCategory({ category: 'strength', sets: [] })).toBe('strength');
    });

    it('无 category 时按「有组明细 = 力量」推断（老数据兼容）', () => {
      expect(workoutLib.normalizeCategory({ sets: [{ reps: 8, weightKg: 60 }] })).toBe('strength');
      expect(workoutLib.normalizeCategory({ sets: [] })).toBe('cardio');
      expect(workoutLib.normalizeCategory({})).toBe('cardio');
    });

    it('非法 category 值按缺省处理（由 validateWorkoutPayload 拦截）', () => {
      expect(workoutLib.normalizeCategory({ category: 'yoga', sets: [{ reps: 1 }] })).toBe('strength');
    });
  });

  describe('validateSets', () => {
    it('拒绝空数组与非数组', () => {
      expect(workoutLib.validateSets([]).ok).toBe(false);
      expect(workoutLib.validateSets(undefined).ok).toBe(false);
    });

    it('order 由服务端按下标重排，不信任客户端顺序', () => {
      const result = workoutLib.validateSets([
        { id: 'a', order: 9, reps: 8, weightKg: 60 },
        { id: 'b', order: 1, reps: 6, weightKg: 65 },
      ]);
      expect(result.value.map((s: any) => s.order)).toEqual([1, 2]);
      expect(result.value.map((s: any) => s.id)).toEqual(['a', 'b']);
    });

    it('缺 id 时补一个稳定 id（保证回传前端仍满足 WorkoutSet 形态）', () => {
      const result = workoutLib.validateSets([{ order: 1, reps: 8, weightKg: 60 }]);
      expect(result.value[0].id).toBe('set-1');
    });

    it('次数与重量超范围被拒绝且带组号', () => {
      const badReps = workoutLib.validateSets([{ reps: 0, weightKg: 60 }]);
      expect(badReps.ok).toBe(false);
      expect(badReps.msg).toContain('第 1 组');
      expect(workoutLib.validateSets([{ reps: 8, weightKg: 5000 }]).ok).toBe(false);
      expect(workoutLib.validateSets([{ reps: 8, weightKg: -1 }]).ok).toBe(false);
    });
  });

  describe('validateWorkoutPayload', () => {
    it('合法力量记录通过', () => {
      const result = workoutLib.validateWorkoutPayload(strengthInput());
      expect(result.ok).toBe(true);
      expect(result.value.category).toBe('strength');
      expect(result.value.sets).toHaveLength(1);
      expect(result.value.durationMin).toBeNull();
    });

    it('合法有氧记录通过', () => {
      const result = workoutLib.validateWorkoutPayload(cardioInput());
      expect(result.ok).toBe(true);
      expect(result.value.category).toBe('cardio');
      expect(result.value.durationMin).toBe(30);
      expect(result.value.distanceKm).toBe(5.2);
      expect(result.value.sets).toEqual([]);
    });

    it('有氧缺时长被拒绝', () => {
      const result = workoutLib.validateWorkoutPayload(cardioInput({ durationMin: undefined }));
      expect(result.ok).toBe(false);
      expect(result.msg).toContain('运动时长');
    });

    it('有氧时长为 0 或超范围被拒绝', () => {
      expect(workoutLib.validateWorkoutPayload(cardioInput({ durationMin: 0 })).ok).toBe(false);
      expect(workoutLib.validateWorkoutPayload(cardioInput({ durationMin: 2000 })).ok).toBe(false);
    });

    it('有氧携带组明细被拒绝', () => {
      const result = workoutLib.validateWorkoutPayload(
        cardioInput({ sets: [{ reps: 8, weightKg: 60 }] }),
      );
      expect(result.ok).toBe(false);
      expect(result.msg).toContain('组明细');
    });

    it('有氧的距离与消耗热量均为选填', () => {
      const result = workoutLib.validateWorkoutPayload(
        cardioInput({ distanceKm: undefined, calories: undefined }),
      );
      expect(result.ok).toBe(true);
      expect(result.value.distanceKm).toBeNull();
      expect(result.value.calories).toBeNull();
    });

    it('力量缺少组明细被拒绝', () => {
      expect(workoutLib.validateWorkoutPayload(strengthInput({ sets: [] })).ok).toBe(false);
    });

    it('非法 category 被拒绝', () => {
      const result = workoutLib.validateWorkoutPayload(strengthInput({ category: 'yoga' }));
      expect(result.ok).toBe(false);
      expect(result.msg).toContain('运动类型不合法');
    });

    it('消耗热量对力量也生效', () => {
      const result = workoutLib.validateWorkoutPayload(strengthInput({ calories: 250 }));
      expect(result.value.calories).toBe(250);
      expect(workoutLib.validateWorkoutPayload(strengthInput({ calories: -1 })).ok).toBe(false);
    });
  });

  describe('mergeWorkoutPatch', () => {
    it('未传的字段保留既有值', () => {
      const existing = workoutLib.validateWorkoutPayload(strengthInput()).value;
      const merged = workoutLib.mergeWorkoutPatch(existing, { exerciseName: '上斜卧推' });
      expect(merged.value.exerciseName).toBe('上斜卧推');
      expect(merged.value.sets).toHaveLength(1);
    });

    it('仅把 category 改成有氧时，复校能发现组明细矛盾', () => {
      const existing = workoutLib.validateWorkoutPayload(strengthInput()).value;
      const merged = workoutLib.mergeWorkoutPatch(existing, { category: 'cardio' });

      // 既有记录仍带着 strength 的组明细，且没有时长 —— 必须被拦下
      const result = workoutLib.validateWorkoutPayload(merged.value);
      expect(result.ok).toBe(false);
      expect(result.msg).toContain('组明细');
    });

    it('切成有氧并同步清空组明细、补上时长后通过', () => {
      const existing = workoutLib.validateWorkoutPayload(strengthInput()).value;
      const merged = workoutLib.mergeWorkoutPatch(existing, {
        category: 'cardio',
        sets: [],
        durationMin: 20,
      });
      expect(workoutLib.validateWorkoutPayload(merged.value).ok).toBe(true);
    });
  });

  describe('validateListQuery', () => {
    it('按单日与按区间查询', () => {
      expect(workoutLib.validateListQuery({ date: DATE }).value).toEqual({ date: DATE });
      expect(workoutLib.validateListQuery({ from: '2026-09-01' }).ok).toBe(true);
    });

    it('缺少条件与日期倒置被拒绝', () => {
      expect(workoutLib.validateListQuery({}).ok).toBe(false);
      expect(workoutLib.validateListQuery({ from: '2026-09-11', to: '2026-09-01' }).ok).toBe(
        false,
      );
    });
  });
});

describe('云端记录 → 前端形态（跨模块守卫）', () => {
  it('toClientDiet 的输出能被前端 validateDietEntry 接受', () => {
    const row = {
      _id: 'abc',
      clientId: 'diet-1',
      date: DATE,
      mealType: 'lunch',
      foodName: '鸡胸肉',
      quantity: '200g',
      calories: 300,
      protein: null,
      carbs: null,
      fat: null,
      memberId: null,
    };
    expect(validateDietEntry(dietLib.toClientDiet(row))).toEqual({ valid: true, errors: [] });
  });

  it('toClientWorkout 的输出能被前端 validateWorkoutEntry 接受（含缺 set.id 的老数据）', () => {
    const row = {
      clientId: 'workout-1',
      date: DATE,
      category: 'strength',
      exerciseName: '卧推',
      // 云端早期数据可能没有 set.id —— 必须在 toClient 阶段补回
      sets: [{ order: 1, reps: 8, weightKg: 60 }],
    };
    expect(validateWorkoutEntry(workoutLib.toClientWorkout(row))).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('toClientWorkout 对无 category 的老记录推断为力量且可被前端接受', () => {
    const row = {
      clientId: 'workout-legacy',
      date: DATE,
      exerciseName: '深蹲',
      sets: [{ id: 'set-1', order: 1, reps: 10, weightKg: 80 }],
    };
    const client = workoutLib.toClientWorkout(row);
    expect(client.category).toBe('strength');
    expect(validateWorkoutEntry(client).valid).toBe(true);
  });

  it('toClientWorkout 对有氧记录输出合法形态', () => {
    const row = {
      clientId: 'workout-cardio',
      date: DATE,
      category: 'cardio',
      exerciseName: '跑步',
      sets: [],
      durationMin: 30,
      distanceKm: 5.2,
      calories: 320,
    };
    const client = workoutLib.toClientWorkout(row);
    expect(validateWorkoutEntry(client)).toEqual({ valid: true, errors: [] });
  });

  it('toClientFood 输出营养字段缺省时不含 null', () => {
    const client = dietLib.toClientFood({ _id: 'f1', name: '牛奶', quantity: '1 杯', useCount: 3 });
    expect(client.calories).toBeUndefined();
    expect(client.useCount).toBe(3);
  });
});

describe('常用食物收集', () => {
  it('从饮食入参提炼常用食物', () => {
    const result = dietLib.validateFoodCollect({
      foodName: ' 牛奶 ',
      quantity: ' 1 杯 ',
      calories: 150,
      protein: 8,
    });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      name: '牛奶',
      quantity: '1 杯',
      calories: 150,
      protein: 8,
      carbs: null,
      fat: null,
    });
  });

  it('食物名为空被拒绝', () => {
    expect(dietLib.validateFoodCollect({ foodName: '' }).ok).toBe(false);
  });

  it('营养值非法被拒绝', () => {
    expect(dietLib.validateFoodCollect({ foodName: '牛奶', calories: -1 }).ok).toBe(false);
  });
});
