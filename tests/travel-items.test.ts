import { describe, expect, it } from 'vitest';

import { TravelRepository } from '@/repositories/TravelRepository';
import { TravelService } from '@/services/TravelService';
import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import type { TravelItem, TravelPlan } from '@/types/models';
import { MEAL_LIMITS, TRAVEL_LIMITS } from '@/utils/limits';
import { TRAVEL_PLANS_KEY } from '@/utils/storageKeys';
import {
  computeItemDiff,
  normalizeTravelItems,
  normalizeTravelMembers,
  sortTravelItems,
  type TravelItemInput,
} from '@/utils/travel';
import { validateTravelPlan } from '@/utils/validation';

/**
 * M3 第 2 步的跨端原语。
 *
 * 三条守卫对应三件必须先解决的事（详见 `src/utils/travel.ts` 文件头）：
 * ① 明细 id 必须稳定（改造前每次 update 都给全部明细换 id）；
 * ② 明细顺序必须显式表达（拆表后数组位置不再存在）；
 * ③ 提交必须能算出增 / 改 / 删（否则云端就是整包覆盖）。
 */

/** 确定性 id 生成器：把「生成了什么 id」变成可断言的事实 */
function createIdGenerator(): (prefix: string) => string {
  let count = 0;
  return (prefix: string) => {
    count += 1;
    return `${prefix}-new-${count}`;
  };
}

function item(partial: Partial<TravelItem> & { id: string }): TravelItem {
  return { order: 0, time: '', activity: '活动', note: '', done: false, ...partial };
}

function draft(partial: Partial<TravelItemInput> = {}): TravelItemInput {
  return { time: '', activity: '活动', note: '', done: false, ...partial };
}

function createStorage(): InMemoryStorageAdapter {
  return new InMemoryStorageAdapter();
}

describe('normalizeTravelMembers：去重 + 剔除空值 + 保持顺序', () => {
  it('重复成员只保留第一次出现', () => {
    expect(normalizeTravelMembers(['m1', 'm2', 'm1', 'm3', 'm2'])).toEqual(['m1', 'm2', 'm3']);
  });

  it('剔除空串、纯空白与非字符串', () => {
    expect(normalizeTravelMembers(['m1', '', '   ', null, 1, { id: 'm2' }, 'm2'])).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('去掉首尾空白后再判重', () => {
    expect(normalizeTravelMembers([' m1 ', 'm1'])).toEqual(['m1']);
  });

  it('非数组一律归一为空数组（调用方传 undefined 不该让保存失败）', () => {
    expect(normalizeTravelMembers(undefined)).toEqual([]);
    expect(normalizeTravelMembers('m1')).toEqual([]);
    expect(normalizeTravelMembers({ 0: 'm1' })).toEqual([]);
  });
});

describe('normalizeTravelItems：稳定 id + 下标 order', () => {
  it('保留草稿里已有的 id，只为新行生成', () => {
    const generateId = createIdGenerator();
    const items = normalizeTravelItems(
      [draft({ id: 'trip-1' }), draft(), draft({ id: 'trip-3' })],
      generateId,
    );

    expect(items.map((entry) => entry.id)).toEqual(['trip-1', 'trip-new-1', 'trip-3']);
  });

  it('空白字符串 id 视为「没有 id」', () => {
    const items = normalizeTravelItems([draft({ id: '   ' })], createIdGenerator());
    expect(items[0].id).toBe('trip-new-1');
  });

  it('order 按数组下标写入', () => {
    const items = normalizeTravelItems([draft(), draft(), draft()], createIdGenerator());
    expect(items.map((entry) => entry.order)).toEqual([0, 1, 2]);
  });

  it('字段形态收敛：文本非字符串 → 空串，done 非 true → false', () => {
    const items = normalizeTravelItems(
      [
        {
          id: 'trip-1',
          time: undefined as unknown as string,
          activity: undefined as unknown as string,
          note: 5 as unknown as string,
          done: 'yes' as unknown as boolean,
        },
      ],
      createIdGenerator(),
    );

    expect(items[0]).toMatchObject({ time: '', activity: '', note: '', done: false });
  });
});

describe('computeItemDiff：把整份明细翻译成记录级的增 / 改 / 删', () => {
  it('原集合为空 → 全部新增', () => {
    const diff = computeItemDiff([], [draft({ activity: '洱海' })], createIdGenerator());

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]).toMatchObject({ id: 'trip-new-1', order: 0, activity: '洱海' });
    expect(diff.updated).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('完全一致 → 全部 unchanged，不产生任何写入', () => {
    const original = [item({ id: 'trip-1', order: 0 }), item({ id: 'trip-2', order: 1 })];
    const diff = computeItemDiff(
      original,
      [draft({ id: 'trip-1' }), draft({ id: 'trip-2' })],
      createIdGenerator(),
    );

    expect(diff.unchanged).toEqual(['trip-1', 'trip-2']);
    expect(diff.added).toEqual([]);
    expect(diff.updated).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('改字段 → updated，且保留原 id', () => {
    const original = [item({ id: 'trip-1', order: 0, activity: '洱海' })];
    const diff = computeItemDiff(
      original,
      [draft({ id: 'trip-1', activity: '洱海景区' })],
      createIdGenerator(),
    );

    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0]).toMatchObject({ id: 'trip-1', activity: '洱海景区' });
    expect(diff.unchanged).toEqual([]);
  });

  it('勾选完成（只变 done）也算一次更新', () => {
    const original = [item({ id: 'trip-1', order: 0 })];
    const diff = computeItemDiff(
      original,
      [draft({ id: 'trip-1', done: true })],
      createIdGenerator(),
    );

    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].done).toBe(true);
  });

  it('提交里消失的明细 → removed', () => {
    const original = [item({ id: 'trip-1', order: 0 }), item({ id: 'trip-2', order: 1 })];
    const diff = computeItemDiff(original, [draft({ id: 'trip-1' })], createIdGenerator());

    expect(diff.removed).toEqual(['trip-2']);
    expect(diff.unchanged).toEqual(['trip-1']);
  });

  it('提交为空 → 原有明细全部删除', () => {
    const original = [item({ id: 'trip-1', order: 0 }), item({ id: 'trip-2', order: 1 })];
    const diff = computeItemDiff(original, [], createIdGenerator());

    expect(diff.removed).toEqual(['trip-1', 'trip-2']);
  });

  it('新增行的 order 取它的下标', () => {
    const original = [item({ id: 'trip-1', order: 0 })];
    const diff = computeItemDiff(
      original,
      [draft({ id: 'trip-1' }), draft({ activity: '古城' })],
      createIdGenerator(),
    );

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].order).toBe(1);
  });

  it('带未知 id 的新行**沿用该 id**（客户端生成的 id 是权威的，便于幂等重放）', () => {
    const diff = computeItemDiff([], [draft({ id: 'trip-client-made' })], createIdGenerator());

    expect(diff.added[0].id).toBe('trip-client-made');
  });

  it('同一 id 在提交里重复出现 → 第二条起分配新 id，不会两条写同一条记录', () => {
    const original = [item({ id: 'trip-1', order: 0 })];
    const diff = computeItemDiff(
      original,
      [draft({ id: 'trip-1' }), draft({ id: 'trip-1', activity: '另一条' })],
      createIdGenerator(),
    );

    expect(diff.unchanged).toEqual(['trip-1']);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].id).toBe('trip-new-1');
  });

  it('调换顺序 → 位置变化的明细进 updated', () => {
    const original = [
      item({ id: 'trip-1', order: 0, activity: '洱海' }),
      item({ id: 'trip-2', order: 1, activity: '古城' }),
    ];
    const diff = computeItemDiff(
      original,
      [draft({ id: 'trip-2', activity: '古城' }), draft({ id: 'trip-1', activity: '洱海' })],
      createIdGenerator(),
    );

    expect(diff.updated.map((entry) => entry.id)).toEqual(['trip-2', 'trip-1']);
    expect(diff.updated.map((entry) => entry.order)).toEqual([0, 1]);
    expect(diff.unchanged).toEqual([]);
  });

  it('⚠️ 中间插入一行会让其后所有明细被判为 updated（刻意的，顺序要真的写下去）', () => {
    const original = [
      item({ id: 'trip-1', order: 0 }),
      item({ id: 'trip-2', order: 1 }),
      item({ id: 'trip-3', order: 2 }),
    ];
    const diff = computeItemDiff(
      original,
      [draft({ id: 'trip-1' }), draft({ activity: '新插入' }), draft({ id: 'trip-2' }), draft({ id: 'trip-3' })],
      createIdGenerator(),
    );

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].order).toBe(1);
    expect(diff.updated.map((entry) => entry.id)).toEqual(['trip-2', 'trip-3']);
    expect(diff.updated.map((entry) => entry.order)).toEqual([2, 3]);
    expect(diff.unchanged).toEqual(['trip-1']);
  });

  it('★ 老数据没有 order 字段：原地不动时必须是 unchanged，不能被误判为更新', () => {
    const legacy: TravelItem[] = [
      { id: 'trip-1', time: '', activity: '活动', note: '', done: false },
      { id: 'trip-2', time: '', activity: '活动', note: '', done: false },
    ];
    const diff = computeItemDiff(
      legacy,
      [draft({ id: 'trip-1' }), draft({ id: 'trip-2' })],
      createIdGenerator(),
    );

    expect(diff.unchanged).toEqual(['trip-1', 'trip-2']);
    expect(diff.updated).toEqual([]);
  });
});

describe('sortTravelItems：按 order 稳定排序', () => {
  it('按 order 升序还原顺序', () => {
    const items = [item({ id: 'c', order: 2 }), item({ id: 'a', order: 0 }), item({ id: 'b', order: 1 })];
    expect(sortTravelItems(items).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('缺失 order 的老数据按下标参与排序，不会被挤到最前', () => {
    const items: TravelItem[] = [
      { id: 'legacy-1', time: '', activity: '活动', note: '', done: false },
      item({ id: 'ordered', order: 5 }),
      { id: 'legacy-2', time: '', activity: '活动', note: '', done: false },
    ];

    expect(sortTravelItems(items).map((entry) => entry.id)).toEqual([
      'legacy-1',
      'legacy-2',
      'ordered',
    ]);
  });
});

describe('老数据兼容：order 缺失不能被静默丢弃', () => {
  const legacyItem = { id: 'trip-1', time: '', activity: '洱海', note: '', done: false };

  function planWith(items: unknown[]): Record<string, unknown> {
    return {
      id: 'travel-1',
      title: '周末出行',
      startDate: '2026-09-20',
      endDate: '2026-09-21',
      destination: '大理',
      members: ['m1'],
      budget: 1000,
      status: 'planned',
      note: '',
      items,
    };
  }

  it('没有 order 的明细仍然通过校验（必填会让历史数据在读取时全部消失）', () => {
    expect(validateTravelPlan(planWith([legacyItem])).valid).toBe(true);
  });

  it('order 非法（负数 / NaN）要被拦下', () => {
    expect(validateTravelPlan(planWith([{ ...legacyItem, order: -1 }])).valid).toBe(false);
    expect(validateTravelPlan(planWith([{ ...legacyItem, order: Number.NaN }])).valid).toBe(false);
  });

  it('order 合法时通过', () => {
    expect(validateTravelPlan(planWith([{ ...legacyItem, order: 2 }])).valid).toBe(true);
  });

  it('仓库读取历史数据时不会把它丢掉', () => {
    const storage = createStorage();
    storage.setItem(TRAVEL_PLANS_KEY, JSON.stringify([planWith([legacyItem])]));

    const plans = new TravelRepository(storage).getAll();
    expect(plans).toHaveLength(1);
    expect(plans[0].items).toHaveLength(1);
    expect(plans[0].items[0].id).toBe('trip-1');
  });
});

describe('TravelService：本地写入的明细身份与顺序', () => {
  function createService(): { service: TravelService; storage: InMemoryStorageAdapter } {
    const storage = createStorage();
    return { service: new TravelService(new TravelRepository(storage)), storage };
  }

  function addPlan(service: TravelService): TravelPlan {
    return service.add({
      title: '周末出行',
      startDate: '2026-09-20',
      endDate: '2026-09-21',
      destination: '大理',
      members: ['m1', 'm1', 'm2'],
      budget: 1000,
      status: 'planned',
      note: '',
      items: [
        { time: '上午 9:00', activity: '洱海', note: '', done: false },
        { time: '下午 15:00', activity: '大理古城', note: '', done: false },
      ],
    });
  }

  it('新增时补 order、成员去重', () => {
    const { service } = createService();
    const plan = addPlan(service);

    expect(plan.members).toEqual(['m1', 'm2']);
    expect(plan.items.map((entry) => entry.order)).toEqual([0, 1]);
    expect(plan.items.every((entry) => entry.id.startsWith('trip-'))).toBe(true);
  });

  it('★ 编辑计划时明细 id 必须保持不变（改造前每次 update 都会换掉全部 id）', () => {
    const { service } = createService();
    const plan = addPlan(service);
    const before = plan.items.map((entry) => entry.id);

    const updated = service.update(plan.id, {
      items: [
        { id: before[0], time: '上午 9:00', activity: '洱海景区', note: '', done: false },
        { id: before[1], time: '下午 15:00', activity: '大理古城', note: '带相机', done: false },
      ],
    });

    expect(updated.items.map((entry) => entry.id)).toEqual(before);
    expect(updated.items[0].activity).toBe('洱海景区');
    expect(updated.items[1].note).toBe('带相机');
  });

  it('★ 勾选某条明细后，其余明细的 id 与内容不受影响', () => {
    const { service } = createService();
    const plan = addPlan(service);
    const before = plan.items.map((entry) => entry.id);

    const after = service.toggleItem(plan.id, before[1]);

    expect(after.items.map((entry) => entry.id)).toEqual(before);
    expect(after.items[0].done).toBe(false);
    expect(after.items[1].done).toBe(true);
  });

  it('重复勾选会翻转回来，且 id 始终不变', () => {
    const { service } = createService();
    const plan = addPlan(service);
    const before = plan.items.map((entry) => entry.id);

    service.toggleItem(plan.id, before[0]);
    const after = service.toggleItem(plan.id, before[0]);

    expect(after.items.map((entry) => entry.id)).toEqual(before);
    expect(after.items[0].done).toBe(false);
  });

  it('编辑计划但不传 items 时，原有明细原样保留（含 id）', () => {
    const { service } = createService();
    const plan = addPlan(service);
    const before = plan.items.map((entry) => entry.id);

    const updated = service.update(plan.id, { title: '国庆出行' });

    expect(updated.items.map((entry) => entry.id)).toEqual(before);
    expect(updated.title).toBe('国庆出行');
  });

  /**
   * `setItemDone` 是**设值**而不是翻转 —— 它是为「服务端翻转后回写权威值」准备的：
   * 云端 `toggleItem` 返回的才是最终状态，本地那次翻转只是乐观展示。
   * 若误把它写成翻转，回写就会把状态再翻一次（勾选变未勾选）。
   */
  it('★ setItemDone 是设值、不是翻转（连设两次 true 结果仍是 true）', () => {
    const { service } = createService();
    const plan = addPlan(service);
    const target = plan.items[0].id;

    service.setItemDone(target, true);
    const plan2 = service.setItemDone(target, true);

    expect(plan2?.items[0].done).toBe(true);
    // 其它明细不受影响
    expect(plan2?.items[1].done).toBe(false);

    const plan3 = service.setItemDone(target, false);
    expect(plan3?.items[0].done).toBe(false);
    expect(plan3?.items[1].done).toBe(false);
  });

  it('setItemDone 不影响明细 id 与顺序', () => {
    const { service } = createService();
    const plan = addPlan(service);
    const before = plan.items.map((entry) => entry.id);

    const after = service.setItemDone(before[1], true);

    expect(after?.items.map((entry) => entry.id)).toEqual(before);
    expect(after?.items.map((entry) => entry.order)).toEqual([0, 1]);
  });

  it('setItemDone 找不到该明细时返回 undefined 且不抛错（明细可能刚被别处删掉）', () => {
    const { service } = createService();
    addPlan(service);

    expect(() => service.setItemDone('不存在的明细', true)).not.toThrow();
    expect(service.setItemDone('不存在的明细', true)).toBeUndefined();
  });

  it('传入的成员里混入脏值时归一化，不影响保存', () => {
    const { service } = createService();
    const plan = addPlan(service);

    const updated = service.update(plan.id, {
      members: ['m3', '', 'm3', 'm1'] as string[],
    });

    expect(updated.members).toEqual(['m3', 'm1']);
  });
});

describe('M3 新增的长度上限常量：先锁住合理区间', () => {
  it('食谱与出行的上限都落在 10~200 之间', () => {
    const all: Array<[string, number]> = [
      ['菜名', MEAL_LIMITS.dishName],
      ['食材', MEAL_LIMITS.ingredients],
      ['掌勺人', MEAL_LIMITS.cook],
      ['食谱备注', MEAL_LIMITS.note],
      ['出行标题', TRAVEL_LIMITS.title],
      ['目的地', TRAVEL_LIMITS.destination],
      ['出行备注', TRAVEL_LIMITS.note],
      ['行程时间', TRAVEL_LIMITS.itemTime],
      ['行程活动', TRAVEL_LIMITS.itemActivity],
      ['行程备注', TRAVEL_LIMITS.itemNote],
    ];

    for (const [label, value] of all) {
      expect(value, `${label} 上限应 ≥ 10`).toBeGreaterThanOrEqual(10);
      expect(value, `${label} 上限应 ≤ 200`).toBeLessThanOrEqual(200);
    }
  });
});
