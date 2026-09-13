import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MealPlan } from '@/types/models';
import { fromCloudMeal, mapCloudMealPlans, toCloudMeal } from '@/utils/cloudMap';
import { validateMealPlan } from '@/utils/validation';
import { createMealPlanRemoteRepo } from '@/repositories/remote/MealPlanRemoteRepo';

const require = createRequire(import.meta.url);
const mealLib = require('../uniCloud-alipay/cloudfunctions/meal/lib');

const DATE = '2026-09-13';

function meal(overrides: Partial<MealPlan> = {}): MealPlan {
  return {
    id: 'meal-1',
    date: DATE,
    slot: 'dinner',
    dishName: '番茄炒蛋',
    ingredients: '番茄、鸡蛋',
    cook: '妈妈',
    done: false,
    note: '少放盐',
    ...overrides,
  };
}

describe('上行：前端食谱 → `meal` 云函数入参', () => {  it('id 映射为 clientId，且**不上行** createdAt / updatedAt', () => {
    const payload = toCloudMeal(meal());

    expect(payload).toEqual({
      clientId: 'meal-1',
      date: DATE,
      slot: 'dinner',
      dishName: '番茄炒蛋',
      ingredients: '番茄、鸡蛋',
      cook: '妈妈',
      done: false,
      note: '少放盐',
    });
    // 时间戳由服务端 Date.now() 决定：上行会被客户端时钟偏差污染
    expect('createdAt' in payload).toBe(false);
    expect('updatedAt' in payload).toBe(false);
  });

  it('可空文本缺省 → 空串（绝不落 null）', () => {
    // 落 null 会让云端校验器与前端校验器都判非法 → 整条记录被静默丢弃
    const payload = toCloudMeal(
      meal({
        ingredients: undefined as unknown as string,
        cook: undefined as unknown as string,
        note: undefined as unknown as string,
      }),
    );

    expect(payload.ingredients).toBe('');
    expect(payload.cook).toBe('');
    expect(payload.note).toBe('');
  });

  it('done 非布尔一律收敛成 false（不做「真值」猜测）', () => {
    expect(toCloudMeal(meal({ done: undefined as unknown as boolean })).done).toBe(false);
    expect(toCloudMeal(meal({ done: true })).done).toBe(true);
  });
});

describe('下行：`meal` 云函数记录 → 前端食谱模型', () => {
  it('云端 null 的可空文本归一成空串', () => {
    const back = fromCloudMeal({ clientId: 'meal-1', ingredients: null, cook: null, note: null });

    expect(back.ingredients).toBe('');
    expect(back.cook).toBe('');
    expect(back.note).toBe('');
  });

  it('非法餐次兜底 breakfast（不整条丢弃）', () => {
    expect(fromCloudMeal({ clientId: 'm', slot: 'brunch' }).slot).toBe('breakfast');
  });

  it('done 非布尔 → false', () => {
    expect(fromCloudMeal({ clientId: 'm', done: 1 }).done).toBe(false);
    expect(fromCloudMeal({ clientId: 'm', done: 'true' }).done).toBe(false);
  });

  it('兼容裸库文档（clientId / _id 均可作 id）', () => {
    expect(fromCloudMeal({ _id: 'db-1' }).id).toBe('db-1');
    expect(fromCloudMeal({ clientId: 'c-1', _id: 'db-1' }).id).toBe('c-1');
  });
});

describe('列表映射（逐行校验 + 丢弃非法行）', () => {
  it('非数组入参返回空数组', () => {
    for (const value of [null, undefined, {}, 'x', 1]) {
      expect(mapCloudMealPlans(value)).toEqual([]);
    }
  });

  it('保留合法行、丢弃非法行（缺菜品名 / 日期非法 / 非对象）', () => {
    const rows = [
      { clientId: 'ok', date: DATE, slot: 'lunch', dishName: '红烧肉', done: false },
      { clientId: 'bad-no-dish', date: DATE, slot: 'lunch', done: false },
      { clientId: 'bad-date', date: '2026/09/13', slot: 'lunch', dishName: '红烧肉', done: false },
      null,
      'not-an-object',
    ];

    expect(mapCloudMealPlans(rows).map((item) => item.id)).toEqual(['ok']);
  });
});

describe('往返一致性', () => {
  it('食谱往返后字段一致', () => {
    const original = meal();

    expect(fromCloudMeal(toCloudMeal(original))).toEqual(original);
  });

  it('空文本往返后仍为空串（不会漂成 null）', () => {
    const original = meal({ ingredients: '', cook: '', note: '' });

    expect(fromCloudMeal(toCloudMeal(original))).toEqual(original);
  });
});

describe('与云函数的契约（两层串联守卫）', () => {
  it('前端上行 → 云函数 validateMealPayload 接受', () => {
    // 这条守的是「映射层的字段名 / 类型」与「云端入参契约」一致：
    // 任何一边改名或改类型，这里立刻失败，而不是等到真机上 400
    expect(mealLib.validateMealPayload(toCloudMeal(meal())).ok).toBe(true);
  });

  it('云函数 toClientMeal → 前端 fromCloudMeal → 通过前端校验', () => {
    const clientShape = mealLib.toClientMeal({
      _id: 'db-1',
      clientId: 'meal-1',
      date: DATE,
      slot: 'brunch',
      dishName: '番茄炒蛋',
      ingredients: null,
      cook: null,
      done: false,
      note: null,
    });

    expect(validateMealPlan(fromCloudMeal(clientShape))).toEqual({ valid: true, errors: [] });
  });

  it('⚠️ 云端口径与前端校验器一致：可空文本落 null 会被前端判非法', () => {
    // 这条是反面验证：说明为什么映射层必须把 null 归一成 ''，
    // 而不是「多此一举」
    const withNulls = { id: 'meal-1', date: DATE, slot: 'lunch', dishName: '红烧肉', ingredients: null, cook: '', done: false, note: '' };

    expect(validateMealPlan(withNulls).valid).toBe(false);
  });
});

describe('远端仓储接线（防止 action 名写错）', () => {
  const calls: Array<{ name: string; action: string; data: Record<string, unknown> }> = [];

  beforeEach(() => {
    calls.length = 0;
    (globalThis as any).uniCloud = {
      callFunction: vi.fn(async (options: { name: string; data: Record<string, unknown> }) => {
        calls.push({
          name: options.name,
          action: String(options.data.action),
          data: options.data,
        });
        return { result: { code: 0, data: [] } };
      }),
    };
  });

  afterEach(() => {
    delete (globalThis as any).uniCloud;
    vi.restoreAllMocks();
  });

  it('listByDate / create / update / remove 各自打对云函数与 action', async () => {
    const remote = createMealPlanRemoteRepo();

    await remote.listByDate(DATE);
    expect(calls.at(-1)).toMatchObject({ name: 'meal', action: 'list' });
    expect(calls.at(-1)?.data).toMatchObject({ date: DATE });

    await remote.create(meal());
    expect(calls.at(-1)).toMatchObject({ name: 'meal', action: 'add' });
    expect(calls.at(-1)?.data).toMatchObject({ clientId: 'meal-1' });

    await remote.update(meal());
    expect(calls.at(-1)).toMatchObject({ name: 'meal', action: 'update' });

    await remote.remove('meal-1', DATE);
    expect(calls.at(-1)).toMatchObject({ name: 'meal', action: 'remove' });
    expect(calls.at(-1)?.data).toMatchObject({ clientId: 'meal-1', date: DATE });
  });

  it('remove 不带 date 时不塞空字段（云端会退回用记录自身的日期）', async () => {
    await createMealPlanRemoteRepo().remove('meal-1');

    expect(calls.at(-1)?.data).not.toHaveProperty('date');
  });
});
