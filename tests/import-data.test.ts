import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import type { BackupPayload } from '@/types/models';
import {
  DEFAULT_IMPORT_CONCURRENCY,
  IMPORT_DOMAINS,
  buildImportPlan,
  isDuplicatedResult,
  runImportPlan,
  type ImportPlan,
  type ImportRecord,
} from '@/utils/importData';
import {
  toCloudDiet,
  toCloudMeal,
  toCloudStudyCheckin,
  toCloudStudyPlan,
  toCloudTravelItem,
  toCloudTravelPlan,
  toCloudWorkout,
} from '@/utils/cloudMap';

const require = createRequire(import.meta.url);
const dietLib = require('../uniCloud-alipay/cloudfunctions/diet/lib');
const workoutLib = require('../uniCloud-alipay/cloudfunctions/workout/lib');
const studyLib = require('../uniCloud-alipay/cloudfunctions/study/lib');
const mealLib = require('../uniCloud-alipay/cloudfunctions/meal/lib');
const travelLib = require('../uniCloud-alipay/cloudfunctions/travel/lib');

/**
 * 老数据导入（数据认领）的守卫。
 *
 * 导入是**一次性、难复现**的操作（用户点一次按钮，错了要等下次），
 * 所以它比别处更需要自动化：这里守的是「枚举得全不全、顺序对不对、
 * 产物云端收不收、限并发与计数是否可信」。
 */

const ROOT_PAYLOAD: BackupPayload = {
  version: 2,
  exportedAt: '2026-09-14T00:00:00.000Z',
  profile: null,
  familyMembers: [],
  diet: [
    { id: 'diet-1', date: '2026-01-02', mealType: 'breakfast', foodName: '鸡蛋', quantity: '1 个' },
    { id: 'diet-2', date: '2026-01-03', mealType: 'lunch', foodName: '米饭', quantity: '1 碗' },
  ],
  workout: [
    {
      id: 'workout-1',
      date: '2026-01-02',
      category: 'strength',
      exerciseName: '深蹲',
      sets: [{ id: 'set-1', order: 0, reps: 10, weightKg: 60 }],
    },
  ],
  studyPlans: [
    {
      id: 'plan-1',
      title: '英语',
      subject: '单词',
      frequency: 'daily',
      targetTimes: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  studyCheckins: [{ id: 'checkin-1', planId: 'plan-1', date: '2026-01-02', note: '' }],
  mealPlans: [
    {
      id: 'meal-1',
      date: '2026-01-02',
      slot: 'lunch',
      dishName: '番茄炒蛋',
      ingredients: '',
      cook: '',
      done: false,
      note: '',
    },
  ],
  travelPlans: [
    {
      id: 'travel-1',
      title: '露营',
      startDate: '2026-01-05',
      endDate: '2026-01-06',
      destination: '郊外',
      members: [],
      budget: 0,
      status: 'planned',
      note: '',
      items: [
        // ⚠️ 刻意不带 `order`：M3 之前的老明细就是长这样，
        //    导入必须用数组下标给它兜底，否则全部挤到 0
        { id: 'item-1', time: '', activity: '搭帐篷', note: '', done: false },
        { id: 'item-2', time: '', activity: '生火', note: '', done: false },
      ],
    },
  ],
  transactions: [
    { id: 'txn-1', type: 'expense', amount: 58.5, category: '餐饮', date: '2026-01-02', note: '' },
  ],
};

const samplePayload = (): BackupPayload =>
  JSON.parse(JSON.stringify(ROOT_PAYLOAD)) as BackupPayload;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 掐表中最大同时在飞数量，用来验证限并发真的生效 */
async function trackConcurrency(
  plan: ImportPlan,
  concurrency: number,
): Promise<{ maxInFlight: number; outcome: Awaited<ReturnType<typeof runImportPlan>> }> {
  let inFlight = 0;
  let maxInFlight = 0;

  const outcome = await runImportPlan(
    plan,
    async (): Promise<unknown> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(1);
      inFlight -= 1;
      return { _id: 'x' };
    },
    { concurrency },
  );

  return { maxInFlight, outcome };
}

describe('buildImportPlan：枚举与依赖顺序', () => {
  it('8 个域齐全，且顺序是依赖安全的（父先于子）', () => {
    // 绝对值基准：不用 Set 相等之类的相对断言，改坏顺序要立刻失败
    expect([...IMPORT_DOMAINS]).toEqual([
      'diet',
      'workout',
      'studyPlan',
      'studyCheckin',
      'mealPlan',
      'travelPlan',
      'travelItem',
      'transaction',
    ]);

    const order = (domain: string): number => IMPORT_DOMAINS.indexOf(domain as never);
    // 云端有主从校验：计划不存在时 addCheckin / addItem 直接 404
    expect(order('studyPlan')).toBeLessThan(order('studyCheckin'));
    expect(order('travelPlan')).toBeLessThan(order('travelItem'));
  });

  it('计划记录按域分组有序地排在记录里（不会被子记录插队）', () => {
    const plan = buildImportPlan(samplePayload());
    const indices = plan.records.map((item) => IMPORT_DOMAINS.indexOf(item.domain));

    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('各域条数与总数对得上', () => {
    const plan = buildImportPlan(samplePayload());

    expect(plan.counts).toEqual({
      diet: 2,
      workout: 1,
      studyPlan: 1,
      studyCheckin: 1,
      mealPlan: 1,
      travelPlan: 1,
      travelItem: 2,
      transaction: 1,
    });
    expect(plan.total).toBe(10);
    expect(plan.records).toHaveLength(plan.total);
    expect(plan.skippedDuplicates).toBe(0);
  });

  it('空数据不会产生任何记录（导入按钮在空家庭上应当直接可用）', () => {
    const empty: BackupPayload = {
      ...samplePayload(),
      diet: [],
      workout: [],
      studyPlans: [],
      studyCheckins: [],
      mealPlans: [],
      travelPlans: [],
      transactions: [],
    };

    const plan = buildImportPlan(empty);
    expect(plan.total).toBe(0);
    expect(Object.values(plan.counts).every((value) => value === 0)).toBe(true);
  });
});

describe('buildImportPlan：出行明细的拆解', () => {
  it('明细从计划里拆出来，带上父计划 id 与数组下标', () => {
    const plan = buildImportPlan(samplePayload());
    const items = plan.records.filter((item) => item.domain === 'travelItem');

    expect(items).toHaveLength(2);
    expect(items.map((item) => (item.domain === 'travelItem' ? item.parentId : ''))).toEqual([
      'travel-1',
      'travel-1',
    ]);
    expect(items.map((item) => (item.domain === 'travelItem' ? item.fallbackOrder : -1))).toEqual([
      0, 1,
    ]);
  });

  it('⚠️ 老明细缺 order 时靠下标兜底（不兜底会全部挤到 0，顺序错乱）', () => {
    const plan = buildImportPlan(samplePayload());

    for (const item of plan.records) {
      if (item.domain !== 'travelItem') {
        continue;
      }
      // 这就是云函数 `validateItemPayload` 实际会收到的 `order`
      const payload = toCloudTravelItem(item.parentId, item.record, item.fallbackOrder);
      expect(payload.order).toBe(item.fallbackOrder);
    }
  });
});

describe('buildImportPlan：本机重复记录去重', () => {
  it('同一 id 出现两次只推一条，并把丢弃条数报出来（不静默）', () => {
    const payload = samplePayload();
    // 本机按日期分区存储，脏数据里「同一条记录躺在两个日期键下」是可能的
    payload.diet.push({ ...payload.diet[0], date: '2026-02-02' });

    const plan = buildImportPlan(payload);

    expect(plan.counts.diet).toBe(2);
    expect(plan.total).toBe(10);
    expect(plan.skippedDuplicates).toBe(1);
  });
});

/**
 * 云端收不收 —— 这类「前端产物 → 云函数入参校验器」的两层串联断言，
 * 能立刻抓到映射层与云端契约的字段名 / 类型漂移（M3 的映射层测试已验证有效）。
 */
function cloudAccepts(item: ImportRecord): { ok: boolean; msg?: string } {
  switch (item.domain) {
    case 'diet':
      return dietLib.validateDietPayload(toCloudDiet(item.record));
    case 'workout':
      return workoutLib.validateWorkoutPayload(toCloudWorkout(item.record));
    case 'studyPlan':
      return studyLib.validatePlanPayload(toCloudStudyPlan(item.record));
    case 'studyCheckin':
      return studyLib.validateCheckinPayload(toCloudStudyCheckin(item.record));
    case 'mealPlan':
      return mealLib.validateMealPayload(toCloudMeal(item.record));
    case 'travelPlan':
      return travelLib.validatePlanPayload(toCloudTravelPlan(item.record));
    case 'travelItem':
      return travelLib.validateItemPayload(
        toCloudTravelItem(item.parentId, item.record, item.fallbackOrder),
      );
    case 'transaction':
      // ⚠️ 刻意抛错而不是 `return { ok: true }`：
      //    `ledger/lib.js` 与 `toCloudTransaction` 在 M4 第 5 步才建，
      //    写成「默认通过」就是一个静默黑洞 —— 将来有人先跑了 transaction 的记录，
      //    测试会**假装通过**。抛错让缺口显性化。
      throw new Error('transaction 的契约守卫在 M4 第 5 步接入（ledger/lib.js 尚未创建）');
  }
}

describe('导入产物必须能被云端入参校验器接受', () => {
  it('打卡 / 学习 / 食谱 / 出行 共 7 个域的每一条记录都通过', () => {
    const plan = buildImportPlan(samplePayload());
    const checked = plan.records.filter((item) => item.domain !== 'transaction');

    expect(checked.length).toBeGreaterThan(0);
    for (const item of checked) {
      const result = cloudAccepts(item);
      expect(result.ok, `${item.domain} / ${item.record.id} 被云端拒绝：${result.msg}`).toBe(true);
    }
  });

  it('history 里的空串文本字段不会被判非法（null ↔ 空串是最易踩的坑）', () => {
    const plan = buildImportPlan(samplePayload());
    const meal = plan.records.find((item) => item.domain === 'mealPlan');

    expect(meal).toBeTruthy();
    const payload = toCloudMeal(
      (meal as Extract<ImportRecord, { domain: 'mealPlan' }>).record,
    );
    // 可空文本必须落 `''` 而不是 `null`，否则整条记录会被本机仓储静默丢弃
    expect(payload.ingredients).toBe('');
    expect(payload.note).toBe('');
  });
});

describe('runImportPlan：计数与容错', () => {
  it('全部成功：created 计满，duplicated / failed 为 0', async () => {
    const plan = buildImportPlan(samplePayload());
    const outcome = await runImportPlan(plan, async () => ({ _id: 'x' }));

    expect(outcome).toEqual({
      attempted: plan.total,
      created: plan.total,
      duplicated: 0,
      failed: 0,
      failures: [],
    });
  });

  it('幂等命中计入 duplicated（重复点导入时全是这个，不是失败）', async () => {
    const plan = buildImportPlan(samplePayload());
    const outcome = await runImportPlan(plan, async () => ({ _id: 'x', duplicated: true }));

    expect(outcome.duplicated).toBe(plan.total);
    expect(outcome.created).toBe(0);
    expect(outcome.failed).toBe(0);
  });

  it('单条失败不中断其余（脏数据不能卡住后面几百条）', async () => {
    const plan = buildImportPlan(samplePayload());
    const outcome = await runImportPlan(plan, async (item) => {
      if (item.record.id === 'diet-1') {
        throw new Error('分类不合法');
      }
      return { _id: 'x' };
    });

    expect(outcome.failed).toBe(1);
    expect(outcome.created).toBe(plan.total - 1);
    expect(outcome.failures).toEqual([
      { domain: 'diet', id: 'diet-1', message: '分类不合法' },
    ]);
  });

  it('失败清单能定位到具体记录（否则「失败 3 条」没法排查）', async () => {
    const plan = buildImportPlan(samplePayload());
    const outcome = await runImportPlan(plan, async (item) => {
      if (item.domain === 'travelItem') {
        throw new Error('未找到该出行计划');
      }
      return { _id: 'x' };
    });

    expect(outcome.failures.map((failure) => failure.id).sort()).toEqual(['item-1', 'item-2']);
    expect(outcome.failures.every((failure) => failure.domain === 'travelItem')).toBe(true);
  });

  it('空计划不会卡住（worker 数为 0 时也必须正常返回）', async () => {
    const plan = buildImportPlan({
      ...samplePayload(),
      diet: [],
      workout: [],
      studyPlans: [],
      studyCheckins: [],
      mealPlans: [],
      travelPlans: [],
      transactions: [],
    });

    const outcome = await runImportPlan(plan, async () => {
      throw new Error('不该被调到');
    });
    expect(outcome).toEqual({ attempted: 0, created: 0, duplicated: 0, failed: 0, failures: [] });
  });
});

describe('幂等命中的判定只认严格 true', () => {
  it('`duplicated` 为字符串 / 数字 / 缺失都不算命中（沿用项目里 done 的同一口径）', () => {
    expect(isDuplicatedResult({ duplicated: true })).toBe(true);
    expect(isDuplicatedResult({ _id: 'x' })).toBe(false);
    expect(isDuplicatedResult({ duplicated: 'true' })).toBe(false);
    expect(isDuplicatedResult({ duplicated: 1 })).toBe(false);
    expect(isDuplicatedResult(undefined)).toBe(false);
    expect(isDuplicatedResult(null)).toBe(false);
  });
});

describe('runImportPlan：限并发', () => {
  it('并发上限真的生效（缺省 6）', async () => {
    const plan = buildImportPlan(samplePayload());
    const { maxInFlight } = await trackConcurrency(plan, DEFAULT_IMPORT_CONCURRENCY);

    expect(maxInFlight).toBeLessThanOrEqual(DEFAULT_IMPORT_CONCURRENCY);
    // 同时必须是「并发」而不是串行，否则限并发的意义就没了
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('并发 1 时严格串行', async () => {
    const plan = buildImportPlan(samplePayload());
    const { maxInFlight } = await trackConcurrency(plan, 1);

    expect(maxInFlight).toBe(1);
  });

  it('并发值非法或越界时被收敛，不会把手机打爆也不会死锁', async () => {
    const plan = buildImportPlan(samplePayload());

    for (const value of [0, -5, Number.NaN]) {
      const { maxInFlight, outcome } = await trackConcurrency(plan, value);
      expect(maxInFlight, `并发 ${value} 应被收敛为 1`).toBe(1);
      expect(outcome.created).toBe(plan.total);
    }

    const { maxInFlight } = await trackConcurrency(plan, 1000);
    expect(maxInFlight).toBeLessThanOrEqual(plan.total);
  });

  it('进度回调条数与单调性（进度条倒退比没有进度条更糟）', async () => {
    const plan = buildImportPlan(samplePayload());
    const seen: number[] = [];

    await runImportPlan(plan, async () => ({ _id: 'x' }), {
      concurrency: 2,
      onProgress: (done) => seen.push(done),
    });

    expect(seen).toHaveLength(plan.total);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[seen.length - 1]).toBe(plan.total);
  });
});
