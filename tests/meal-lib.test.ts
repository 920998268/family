import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { MEAL_TYPES } from '@/types/models';
import { validateMealPlan } from '@/utils/validation';
import { DIET_LIMITS } from '@/utils/limits';

// 云函数 lib.js 为 CommonJS 纯逻辑模块，用 createRequire 加载（避免无类型声明的 TS 报错）
const require = createRequire(import.meta.url);
const mealLib = require('../uniCloud-alipay/cloudfunctions/meal/lib');

const DATE = '2026-09-13';

/** 合法的食谱入参 */
function mealInput(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'meal-1',
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

describe('mealLib.validateMealPayload', () => {
  it('接受合法入参并归一化（trim 文本、done 收敛成布尔）', () => {
    const result = mealLib.validateMealPayload(
      mealInput({ dishName: '  番茄炒蛋  ', ingredients: ' 番茄、鸡蛋 ', cook: ' 妈妈 ' }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        clientId: 'meal-1',
        date: DATE,
        slot: 'dinner',
        dishName: '番茄炒蛋',
        ingredients: '番茄、鸡蛋',
        cook: '妈妈',
        done: false,
        note: '少放盐',
      },
    });
  });

  it('缺 clientId / 日期格式非法 / 餐次非法 / 菜品名为空时拒绝', () => {
    expect(mealLib.validateMealPayload(mealInput({ clientId: '' })).ok).toBe(false);
    expect(mealLib.validateMealPayload(mealInput({ date: '2026/09/13' })).ok).toBe(false);
    expect(mealLib.validateMealPayload(mealInput({ date: '' })).ok).toBe(false);
    expect(mealLib.validateMealPayload(mealInput({ dishName: '   ' })).ok).toBe(false);
  });

  it('餐次只接受 breakfast / lunch / dinner / snack，且与前端 MEAL_TYPES 完全一致', () => {
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack']) {
      expect(mealLib.validateMealPayload(mealInput({ slot })).ok).toBe(true);
    }
    for (const slot of ['brunch', '', undefined, 1, null]) {
      expect(
        mealLib.validateMealPayload(mealInput({ slot })).ok,
        `slot=${String(slot)} 应被拒绝`,
      ).toBe(false);
    }

    // 前端加了餐次而云端没加 → 该餐次的记录在本地可存、推云端必被拒（静默丢数据）
    expect(mealLib.MEAL_SLOTS).toEqual(MEAL_TYPES.map((item) => item.value));
  });

  it('⚠️ 可空的三个文本字段缺省 / null / 空串一律归一为**空串**而不是 null', () => {
    // 落 null 会让前端 validateMealPlan（要求 ingredients/cook/note 是字符串）
    // 判非法，整条食谱被 MealPlanRepository 静默丢弃 —— 这是最容易埋雷的一处
    const result = mealLib.validateMealPayload(
      mealInput({ ingredients: undefined, cook: null, note: '   ' }),
    );

    expect(result.ok).toBe(true);
    expect(result.value.ingredients).toBe('');
    expect(result.value.cook).toBe('');
    expect(result.value.note).toBe('');
  });

  it('可空文本非字符串时拒绝（数字 / 布尔不算文本）', () => {
    expect(mealLib.validateMealPayload(mealInput({ ingredients: 123 })).ok).toBe(false);
    expect(mealLib.validateMealPayload(mealInput({ cook: true })).ok).toBe(false);
    expect(mealLib.validateMealPayload(mealInput({ note: {} })).ok).toBe(false);
  });

  it('文本超长时拒绝（菜品 40 / 食材 200 / 掌勺人 20 / 备注 100）', () => {
    const tooLong = (max: number) => 'a'.repeat(max + 1);

    expect(mealLib.validateMealPayload(mealInput({ dishName: tooLong(mealLib.DISH_NAME_MAX) })).ok).toBe(
      false,
    );
    expect(
      mealLib.validateMealPayload(mealInput({ ingredients: tooLong(mealLib.INGREDIENTS_MAX) })).ok,
    ).toBe(false);
    expect(mealLib.validateMealPayload(mealInput({ cook: tooLong(mealLib.COOK_MAX) })).ok).toBe(
      false,
    );
    expect(mealLib.validateMealPayload(mealInput({ note: tooLong(mealLib.NOTE_MAX) })).ok).toBe(
      false,
    );

    // 恰好等于上限必须通过（边界值）
    expect(
      mealLib.validateMealPayload(mealInput({ dishName: 'a'.repeat(mealLib.DISH_NAME_MAX) })).ok,
    ).toBe(true);
    expect(
      mealLib.validateMealPayload(mealInput({ note: 'a'.repeat(mealLib.NOTE_MAX) })).ok,
    ).toBe(true);
  });

  it('⚠️ done 只认严格布尔 true，其余一律 false（不做「真值」猜测）', () => {
    expect(mealLib.validateMealPayload(mealInput({ done: true })).value.done).toBe(true);

    for (const done of [false, undefined, null, '', 1, 0, 'true', 'yes', {}]) {
      expect(
        mealLib.validateMealPayload(mealInput({ done })).value.done,
        `done=${JSON.stringify(done)} 应归一为 false`,
      ).toBe(false);
    }
  });

  it('归一化产出的 done 必定是布尔（前端 validateMealPlan 要求）', () => {
    for (const done of [true, false, undefined, 'x', 1]) {
      expect(typeof mealLib.validateMealPayload(mealInput({ done })).value.done).toBe('boolean');
    }
  });

  it('clientId 非法字符 / 超长 / 带空白一律拒绝（与 diet / study 同口径）', () => {
    expect(mealLib.validateMealPayload(mealInput({ clientId: 'meal-9' })).value.clientId).toBe(
      'meal-9',
    );
    // ⚠️ clientId 不做「先 trim 再校验」：正则直接作用在原值上，
    //    与 diet / workout / study 的 validateClientId 完全一致。
    //    带空白的 id 在实践中不会出现（`createId()` 只产出 [A-Za-z0-9_-]）。
    expect(mealLib.validateMealPayload(mealInput({ clientId: 'meal 1' })).ok).toBe(false);
    expect(mealLib.validateMealPayload(mealInput({ clientId: '  meal-9  ' })).ok).toBe(false);
    expect(
      mealLib.validateMealPayload(mealInput({ clientId: 'm'.repeat(mealLib.CLIENT_ID_MAX + 1) })).ok,
    ).toBe(false);
  });
});

describe('mealLib.mergeMealPatch', () => {
  const existing = {
    clientId: 'meal-1',
    date: DATE,
    slot: 'dinner',
    dishName: '番茄炒蛋',
    ingredients: '番茄、鸡蛋',
    cook: '妈妈',
    done: false,
    note: '少放盐',
  };

  it('只覆盖显式传入的字段', () => {
    const merged = mealLib.mergeMealPatch(existing, { cook: '爸爸' });

    expect(merged.value).toEqual({ ...existing, cook: '爸爸' });
  });

  it('合并结果可交给 validateMealPayload 复校', () => {
    const merged = mealLib.mergeMealPatch(existing, { done: true });

    expect(mealLib.validateMealPayload(merged.value)).toEqual({
      ok: true,
      value: { ...existing, done: true },
    });
  });

  it('复校能发现「改坏了」的 patch（把餐次改成非法值）', () => {
    const merged = mealLib.mergeMealPatch(existing, { slot: 'brunch' });

    expect(mealLib.validateMealPayload(merged.value).ok).toBe(false);
  });

  it('patch 把可空文本清空时，复校后落空串（清空是合法操作）', () => {
    const merged = mealLib.mergeMealPatch(existing, { ingredients: '', cook: '' });
    const checked = mealLib.validateMealPayload(merged.value);

    expect(checked.ok).toBe(true);
    expect(checked.value.ingredients).toBe('');
    expect(checked.value.cook).toBe('');
  });

  it('⚠️ clientId 与 date 不随 patch 改变', () => {
    const merged = mealLib.mergeMealPatch(existing, {
      clientId: 'hacked',
      date: '2020-01-01',
    });

    expect(merged.value.clientId).toBe('meal-1');
    // 改了日期会让记录在旧日期的拉取通路里凭空消失（本地服务也不支持跨日期移动）
    expect(merged.value.date).toBe(DATE);
  });

  it('patch 显式传 undefined 时不覆盖（与「没传」同义）', () => {
    const merged = mealLib.mergeMealPatch(existing, { cook: undefined, note: undefined });

    expect(merged.value.cook).toBe('妈妈');
    expect(merged.value.note).toBe('少放盐');
  });
});

describe('mealLib.validateMealQuery', () => {
  it('必须给出合法日期', () => {
    expect(mealLib.validateMealQuery({ date: DATE })).toEqual({
      ok: true,
      value: { date: DATE },
    });
    expect(mealLib.validateMealQuery({}).ok).toBe(false);
    expect(mealLib.validateMealQuery({ date: '' }).ok).toBe(false);
    expect(mealLib.validateMealQuery({ date: '2026-9-13' }).ok).toBe(false);
  });
});

describe('mealLib.toClientMeal（云端记录 → 前端形态）', () => {
  it('输出能被前端 validateMealPlan 接受', () => {
    const row = {
      _id: 'abc123',
      clientId: 'meal-1',
      date: DATE,
      slot: 'lunch',
      dishName: '番茄炒蛋',
      ingredients: '番茄、鸡蛋',
      cook: '妈妈',
      done: true,
      note: '少放盐',
    };

    expect(validateMealPlan(mealLib.toClientMeal(row))).toEqual({ valid: true, errors: [] });
  });

  it('⚠️ 云端空文本落 null 时也能产出前端可接受的形态（note/ingredients/cook 落空串）', () => {
    const row = {
      clientId: 'meal-1',
      date: DATE,
      slot: 'breakfast',
      dishName: '豆浆油条',
      ingredients: null, // 早期云端可能的落库形态
      cook: null,
      note: null,
      done: false,
    };

    const mapped = mealLib.toClientMeal(row);

    expect(mapped.ingredients).toBe('');
    expect(mapped.cook).toBe('');
    expect(mapped.note).toBe('');
    expect(validateMealPlan(mapped)).toEqual({ valid: true, errors: [] });
  });

  it('id 优先取 clientId，缺省回落到 _id', () => {
    expect(mealLib.toClientMeal({ clientId: 'meal-1', _id: 'abc' }).id).toBe('meal-1');
    expect(mealLib.toClientMeal({ _id: 'abc' }).id).toBe('abc');
    expect(mealLib.toClientMeal({}).id).toBe('');
  });

  it('脏数据兜底：非法餐次 → breakfast、done 非 true → false、缺字段不落 null', () => {
    const mapped = mealLib.toClientMeal({ clientId: 'meal-x', slot: 'brunch', done: 'yes' });

    expect(mapped.slot).toBe('breakfast');
    expect(mapped.done).toBe(false);
    expect(mapped.ingredients).toBe('');
    expect(mapped.cook).toBe('');
    expect(mapped.note).toBe('');
    expect(mapped.date).toBe('');
  });

  it('日期是数字等脏类型时落空串，交给前端校验器明确拦下（不硬凑值）', () => {
    expect(mealLib.toClientMeal({ clientId: 'x', date: '' }).date).toBe('');
    expect(validateMealPlan(mealLib.toClientMeal({ clientId: 'x' })).valid).toBe(false);
  });
});

describe('mealLib 的长度上限被显式锁定', () => {
  it('数值与前端 MEAL_LIMITS 一致（改动需同步两端与表单 maxlength）', () => {
    // ⚠️ 云端上限若比前端更严，本地合法记录会推不上去、重试 5 次后被丢弃。
    //    与 MEAL_LIMITS 的逐项等价由 tests/ui-limits.test.ts 守卫，
    //    这里把数值本身钉死，防止无意改动时两边一起漂走。
    expect(mealLib.DISH_NAME_MAX).toBe(40);
    expect(mealLib.INGREDIENTS_MAX).toBe(200);
    expect(mealLib.COOK_MAX).toBe(20);
    expect(mealLib.NOTE_MAX).toBe(100);
    expect(mealLib.CLIENT_ID_MAX).toBe(64);
  });

  it('食谱的食材上限与饮食模块的「数量」上限互不影响（同名常量各自独立）', () => {
    // 三个 lib 里都有叫 *_MAX 的常量但含义不同，这条守卫防止跨模块张冠李戴
    expect(mealLib.INGREDIENTS_MAX).not.toBe(DIET_LIMITS.quantity);
    expect(mealLib.INGREDIENTS_MAX).toBeGreaterThan(DIET_LIMITS.quantity);
  });
});
