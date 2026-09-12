import { describe, expect, it } from 'vitest';

import { buildWorkoutDraft, optionalNumber } from '@/utils/workoutForm';

const strengthBase = {
  category: 'strength' as const,
  exerciseName: '杠铃卧推',
  sets: [{ reps: '8', weightKg: '60' }],
};

const cardioBase = {
  category: 'cardio' as const,
  exerciseName: '跑步',
  sets: [] as Array<{ reps: unknown; weightKg: unknown }>,
  durationMin: '30',
};

describe('optionalNumber（选填数值归一化）', () => {
  it('空值一律为 undefined', () => {
    expect(optionalNumber(undefined)).toBeUndefined();
    expect(optionalNumber(null)).toBeUndefined();
    expect(optionalNumber('')).toBeUndefined();
  });

  it('空串必须排除：Number(\'\') 是 0，会被当成有效值一路传下去', () => {
    expect(optionalNumber('')).not.toBe(0);
  });

  it('数字字符串会被转换', () => {
    expect(optionalNumber('12')).toBe(12);
    expect(optionalNumber('5.2')).toBe(5.2);
  });

  it('0 是合法值，不能退化成 undefined', () => {
    expect(optionalNumber(0)).toBe(0);
    expect(optionalNumber('0')).toBe(0);
  });

  it('非数字与 NaN 返回 undefined', () => {
    expect(optionalNumber('abc')).toBeUndefined();
    expect(optionalNumber(Number.NaN)).toBeUndefined();
    expect(optionalNumber(Infinity)).toBeUndefined();
  });
});

describe('buildWorkoutDraft：力量', () => {
  it('整理出规范的组明细并补上 category', () => {
    const result = buildWorkoutDraft({
      ...strengthBase,
      sets: [
        { reps: '8', weightKg: '60' },
        { reps: '6', weightKg: '65' },
      ],
    });

    expect(result).toEqual({
      ok: true,
      draft: {
        exerciseName: '杠铃卧推',
        category: 'strength',
        sets: [
          { reps: 8, weightKg: 60 },
          { reps: 6, weightKg: 65 },
        ],
        calories: undefined,
      },
    });
  });

  it('动作名去掉首尾空格', () => {
    const result = buildWorkoutDraft({ ...strengthBase, exerciseName: '  深蹲  ' });

    expect(result.ok && result.draft.exerciseName).toBe('深蹲');
  });

  it('动作名为空时给出提示', () => {
    expect(buildWorkoutDraft({ ...strengthBase, exerciseName: '   ' })).toEqual({
      ok: false,
      msg: '请填写训练动作',
    });
  });

  it('次数为 0 或空串时给出提示', () => {
    expect(buildWorkoutDraft({ ...strengthBase, sets: [{ reps: '0', weightKg: '60' }] })).toEqual({
      ok: false,
      msg: '请填写有效的组数和重量',
    });
    // 空输入框经 v-model.number 会变成空串
    expect(buildWorkoutDraft({ ...strengthBase, sets: [{ reps: '', weightKg: '60' }] })).toEqual({
      ok: false,
      msg: '请填写有效的组数和重量',
    });
  });

  it('重量为负数时给出提示（自重训练允许 0）', () => {
    expect(
      buildWorkoutDraft({ ...strengthBase, sets: [{ reps: '8', weightKg: '-1' }] }),
    ).toEqual({ ok: false, msg: '请填写有效的组数和重量' });

    expect(
      buildWorkoutDraft({ ...strengthBase, sets: [{ reps: '8', weightKg: '0' }] }).ok,
    ).toBe(true);
  });

  it('一组都没有时给出提示', () => {
    expect(buildWorkoutDraft({ ...strengthBase, sets: [] })).toEqual({
      ok: false,
      msg: '请至少填写一组',
    });
  });

  it('不携带有氧字段（避免与云端落库形态不一致）', () => {
    const result = buildWorkoutDraft({
      ...strengthBase,
      durationMin: '30',
      distanceKm: '5',
    });

    expect(result.ok && 'durationMin' in result.draft).toBe(false);
    expect(result.ok && 'distanceKm' in result.draft).toBe(false);
  });
});

describe('buildWorkoutDraft：有氧', () => {
  it('时长必填，距离与热量按选填处理', () => {
    const result = buildWorkoutDraft({ ...cardioBase, distanceKm: '5.2', calories: '320' });

    expect(result).toEqual({
      ok: true,
      draft: {
        exerciseName: '跑步',
        category: 'cardio',
        sets: [],
        durationMin: 30,
        distanceKm: 5.2,
        calories: 320,
      },
    });
  });

  it('不携带组明细：带上会被云端判为形态矛盾', () => {
    const result = buildWorkoutDraft({
      ...cardioBase,
      sets: [{ reps: '1', weightKg: '0' }],
    });

    expect(result.ok && result.draft.sets).toEqual([]);
  });

  it('距离 / 热量留空时为 undefined，不是 0 也不是空串', () => {
    const result = buildWorkoutDraft({ ...cardioBase, distanceKm: '', calories: '' });

    expect(result.ok && result.draft.distanceKm).toBeUndefined();
    expect(result.ok && result.draft.calories).toBeUndefined();
  });

  it('时长为空 / 0 / 非法时给出提示', () => {
    for (const durationMin of ['', '0', 'abc', undefined]) {
      expect(buildWorkoutDraft({ ...cardioBase, durationMin })).toEqual({
        ok: false,
        msg: '请填写运动时长（分钟）',
      });
    }
  });

  it('项目名为空时给出提示', () => {
    expect(buildWorkoutDraft({ ...cardioBase, exerciseName: '' })).toEqual({
      ok: false,
      msg: '请填写运动项目',
    });
  });
});

describe('buildWorkoutDraft 的输出能被校验器接受', () => {
  it('力量与有氧的产出物都通过 validateWorkoutEntry', async () => {
    const { validateWorkoutEntry } = await import('@/utils/validation');

    const strength = buildWorkoutDraft(strengthBase);
    const cardio = buildWorkoutDraft(cardioBase);

    expect(strength.ok).toBe(true);
    expect(cardio.ok).toBe(true);

    // 表单产出的是 draft（没有 id / date），补上后再校验整体形态
    if (strength.ok) {
      expect(
        validateWorkoutEntry({
          ...strength.draft,
          id: 'w-1',
          date: '2026-09-12',
          sets: strength.draft.sets.map((set, index) => ({
            ...set,
            id: `set-${index + 1}`,
            order: index + 1,
          })),
        }).valid,
      ).toBe(true);
    }
    if (cardio.ok) {
      expect(
        validateWorkoutEntry({ ...cardio.draft, id: 'w-2', date: '2026-09-12' }).valid,
      ).toBe(true);
    }
  });
});
