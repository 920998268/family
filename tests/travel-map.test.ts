import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TravelItem, TravelPlan } from '@/types/models';
import {
  fromCloudTravelItem,
  fromCloudTravelPlan,
  mapCloudTravelItems,
  mapCloudTravelPlans,
  toCloudTravelItem,
  toCloudTravelPlan,
} from '@/utils/cloudMap';
import { validateTravelItem, validateTravelPlan } from '@/utils/validation';
import { createTravelPlanRemoteRepo } from '@/repositories/remote/TravelPlanRemoteRepo';
import { createTravelItemRemoteRepo } from '@/repositories/remote/TravelItemRemoteRepo';

const require = createRequire(import.meta.url);
const travelLib = require('../uniCloud-alipay/cloudfunctions/travel/lib');

const START = '2026-10-01';
const END = '2026-10-03';

function item(overrides: Partial<TravelItem> = {}): TravelItem {
  return {
    id: 'trip-1',
    order: 0,
    time: '上午 9:00',
    activity: '出发',
    note: '小区东门集合',
    done: false,
    ...overrides,
  };
}

function plan(overrides: Partial<TravelPlan> = {}): TravelPlan {
  return {
    id: 'travel-1',
    title: '周末露营',
    startDate: START,
    endDate: END,
    destination: '莫干山',
    members: ['member-1'],
    budget: 1200,
    status: 'planned',
    note: '记得带帐篷',
    items: [item()],
    ...overrides,
  };
}

describe('上行：前端出行 → `travel` 云函数入参', () => {
  it('计划：id → clientId，members 经归一化，且**不含 items**', () => {
    const payload = toCloudTravelPlan(plan());

    expect(payload).toEqual({
      clientId: 'travel-1',
      title: '周末露营',
      startDate: START,
      endDate: END,
      destination: '莫干山',
      members: ['member-1'],
      budget: 1200,
      status: 'planned',
      note: '记得带帐篷',
    });
    // ⚠️ items 绝不能随计划上行：那会退化成「整包覆盖」，两人同时编辑会互相覆盖
    expect('items' in payload).toBe(false);
  });

  it('计划：members 去重 + 剔除空值 + 保持顺序（与云端 normalizeMembers 同口径）', () => {
    const payload = toCloudTravelPlan(
      plan({ members: ['member-2', '', 'member-1', 'member-2', '  ', 'member-3'] }),
    );

    expect(payload.members).toEqual(['member-2', 'member-1', 'member-3']);
    // 与云端归一化结果逐项一致 —— 不一致会让两端数据反复「发现变化」而白白推送
    expect(travelLib.normalizeMembers(payload.members).value).toEqual(payload.members);
  });

  it('计划：members 非数组 → []（不整条丢弃）', () => {
    expect(toCloudTravelPlan(plan({ members: undefined as unknown as string[] })).members).toEqual(
      [],
    );
  });

  it('计划：budget 非有限数 → 0（云端只接受 0~1e8，undefined 会被拒）', () => {
    expect(toCloudTravelPlan(plan({ budget: Number.NaN })).budget).toBe(0);
  });

  it('明细：id → clientId，travelId 由调用方显式传入', () => {
    expect(toCloudTravelItem('travel-1', item())).toEqual({
      clientId: 'trip-1',
      travelId: 'travel-1',
      order: 0,
      time: '上午 9:00',
      activity: '出发',
      note: '小区东门集合',
      done: false,
    });
  });

  it('明细：老数据缺 order 时用调用方给的兜底下标', () => {
    // 与 sortTravelItems 的兜底口径一致（缺失时按数组下标理解），否则两端顺序会不同
    const legacy = item({ order: undefined });

    expect(toCloudTravelItem('travel-1', legacy, 3).order).toBe(3);
    // 有 order 时以字段为准，兜底值只在字段不可用时生效
    expect(toCloudTravelItem('travel-1', item({ order: 7 }), 3).order).toBe(7);
    expect(toCloudTravelItem('travel-1', item({ order: -1 }), 3).order).toBe(3);
  });
});

describe('下行：`travel` 云函数记录 → 前端模型', () => {
  it('计划：可空文本 null → 空串、members 归一、budget 缺省 0', () => {
    const back = fromCloudTravelPlan({
      clientId: 'travel-1',
      title: '周末露营',
      startDate: START,
      endDate: END,
      destination: null,
      members: ['member-1', 'member-1', 3, ''],
      budget: null,
      note: null,
    });

    expect(back.destination).toBe('');
    expect(back.note).toBe('');
    expect(back.members).toEqual(['member-1']);
    expect(back.budget).toBe(0);
  });

  it('计划：非法状态兜底 planned（不整条丢弃）', () => {
    expect(fromCloudTravelPlan({ clientId: 'travel-1', status: 'paused' }).status).toBe('planned');
  });

  it('⚠️ 计划：聚合的 items 一律丢弃（它不是明细的权威口径）', () => {
    // `listPlans` 的 items 是「全家庭一次查、上限 500 条」的便捷聚合，会被截断。
    // 若在这里保留，同步层可能把它当成「本地有、云端没有 ⇒ 判定被删」的依据，
    // 造成明细凭空消失 —— 所以刻意置空，让「忘了拉明细」表现为显性的「明细为空」。
    const back = fromCloudTravelPlan({
      clientId: 'travel-1',
      title: '周末露营',
      startDate: START,
      endDate: END,
      budget: 0,
      status: 'planned',
      items: [item(), item({ id: 'trip-2' })],
    });

    expect(back.items).toEqual([]);
  });

  it('计划：兼容裸库文档（clientId / _id 均可作 id）', () => {
    expect(fromCloudTravelPlan({ _id: 'db-1' }).id).toBe('db-1');
    expect(fromCloudTravelPlan({ clientId: 'c-1', _id: 'db-1' }).id).toBe('c-1');
  });

  it('明细：order 缺省 / 负数 / NaN 一律落 0（否则会被校验判非法而丢记录）', () => {
    expect(fromCloudTravelItem({ clientId: 'trip-1' }).order).toBe(0);
    expect(fromCloudTravelItem({ clientId: 'trip-1', order: -2 }).order).toBe(0);
    expect(fromCloudTravelItem({ clientId: 'trip-1', order: Number.NaN }).order).toBe(0);
    expect(fromCloudTravelItem({ clientId: 'trip-1', order: 2.7 }).order).toBe(2);
  });

  it('明细：可空文本 null → 空串，done 非布尔 → false', () => {
    const back = fromCloudTravelItem({
      clientId: 'trip-1',
      time: null,
      activity: '出发',
      note: null,
      done: 'yes',
    });

    expect(back.time).toBe('');
    expect(back.note).toBe('');
    expect(back.done).toBe(false);
  });
});

describe('列表映射（逐行校验 + 丢弃非法行）', () => {
  it('非数组入参返回空数组', () => {
    for (const value of [null, undefined, {}, 'x', 1]) {
      expect(mapCloudTravelPlans(value)).toEqual([]);
      expect(mapCloudTravelItems(value)).toEqual([]);
    }
  });

  it('计划：保留合法行、丢弃非法行（缺标题 / 日期区间反了 / 非对象）', () => {
    const rows = [
      { clientId: 'ok', title: '周末露营', startDate: START, endDate: END, budget: 0, status: 'planned' },
      { clientId: 'bad-no-title', startDate: START, endDate: END, budget: 0, status: 'planned' },
      {
        clientId: 'bad-range',
        title: '周末露营',
        startDate: END,
        endDate: START,
        budget: 0,
        status: 'planned',
      },
      null,
    ];

    expect(mapCloudTravelPlans(rows).map((row) => row.id)).toEqual(['ok']);
  });

  it('明细：保留合法行、丢弃脏行（活动为空 / 非对象）', () => {
    const rows = [
      { clientId: 'ok', order: 0, activity: '出发', done: false },
      { clientId: 'bad-empty-activity', order: 1, activity: '   ', done: false },
      'not-an-object',
    ];

    expect(mapCloudTravelItems(rows).map((row) => row.id)).toEqual(['ok']);
  });
});

describe('往返一致性', () => {
  it('计划往返后字段一致（items 除外，它不走计划通路）', () => {
    const original = plan();
    const back = fromCloudTravelPlan(toCloudTravelPlan(original));

    expect(back).toEqual({ ...original, items: [] });
  });

  it('明细往返后字段一致', () => {
    const original = item();

    expect(fromCloudTravelItem(toCloudTravelItem('travel-1', original))).toEqual(original);
  });
});

describe('与云函数的契约（两层串联守卫）', () => {
  it('前端上行 → 云函数 validatePlanPayload / validateItemPayload 均接受', () => {
    // 守住「映射层字段名 / 类型」与「云端入参契约」一致，
    // 任何一边改名都会在这里失败，而不是等到真机上 400
    expect(travelLib.validatePlanPayload(toCloudTravelPlan(plan())).ok).toBe(true);
    expect(travelLib.validateItemPayload(toCloudTravelItem('travel-1', item())).ok).toBe(true);
  });

  it('云函数 toClientPlan / toClientItem → 前端映射 → 通过前端校验', () => {
    const planShape = travelLib.toClientPlan(
      {
        _id: 'db-1',
        clientId: 'travel-1',
        title: '周末露营',
        startDate: START,
        endDate: END,
        destination: null,
        members: ['member-1', 'member-1'],
        budget: 1200,
        status: 'paused',
        note: null,
      },
      [],
    );
    const itemShape = travelLib.toClientItem({
      clientId: 'trip-1',
      order: '1',
      time: null,
      activity: '出发',
      note: null,
      done: true,
    });

    expect(validateTravelPlan(fromCloudTravelPlan(planShape))).toEqual({ valid: true, errors: [] });
    expect(validateTravelItem(fromCloudTravelItem(itemShape))).toEqual({ valid: true, errors: [] });
  });

  it('⚠️ 明细的 order 必须落成有限数：负数会被前端校验判非法', () => {
    // 反面验证：说明 fromCloudTravelItem 为什么要把负数收敛成 0，而不是原样透传
    expect(validateTravelItem(item({ order: -1 })).valid).toBe(false);
    expect(validateTravelItem(item({ order: Number.NaN })).valid).toBe(false);
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

  it('计划仓储：list / create / update / remove 打对 action', async () => {
    const remote = createTravelPlanRemoteRepo();

    await remote.list();
    expect(calls.at(-1)).toMatchObject({ name: 'travel', action: 'listPlans' });

    await remote.create(plan());
    expect(calls.at(-1)).toMatchObject({ name: 'travel', action: 'addPlan' });
    // 计划本体不含 items
    expect(calls.at(-1)?.data).not.toHaveProperty('items');

    await remote.update(plan());
    expect(calls.at(-1)).toMatchObject({ name: 'travel', action: 'updatePlan' });

    await remote.remove('travel-1');
    expect(calls.at(-1)).toMatchObject({ name: 'travel', action: 'removePlan' });
    expect(calls.at(-1)?.data).toMatchObject({ clientId: 'travel-1' });
  });

  it('明细仓储：listByPlan / create / update / toggle / remove 打对 action', async () => {
    const remote = createTravelItemRemoteRepo();

    await remote.listByPlan('travel-1');
    expect(calls.at(-1)).toMatchObject({ name: 'travel', action: 'listItems' });
    expect(calls.at(-1)?.data).toMatchObject({ travelId: 'travel-1' });

    await remote.create('travel-1', item());
    expect(calls.at(-1)).toMatchObject({ name: 'travel', action: 'addItem' });
    expect(calls.at(-1)?.data).toMatchObject({ clientId: 'trip-1', travelId: 'travel-1' });

    await remote.update('travel-1', item());
    expect(calls.at(-1)).toMatchObject({ name: 'travel', action: 'updateItem' });

    await remote.toggle('trip-1');
    expect(calls.at(-1)).toMatchObject({ name: 'travel', action: 'toggleItem' });

    await remote.remove('trip-1');
    expect(calls.at(-1)).toMatchObject({ name: 'travel', action: 'removeItem' });
  });

  it('⚠️ toggle 不传 done（服务端自己翻转，传了也不会被采纳）', async () => {
    await createTravelItemRemoteRepo().toggle('trip-1');

    expect(calls.at(-1)?.data).toEqual({ action: 'toggleItem', clientId: 'trip-1' });
  });
});
