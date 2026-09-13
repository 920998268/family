import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { TRAVEL_STATUSES as FRONT_TRAVEL_STATUSES } from '@/types/models';
import { normalizeTravelMembers, sortTravelItems } from '@/utils/travel';
import { validateTravelPlan } from '@/utils/validation';

// 云函数 lib.js 为 CommonJS 纯逻辑模块，用 createRequire 加载（避免无类型声明的 TS 报错）
const require = createRequire(import.meta.url);
const travelLib = require('../uniCloud-alipay/cloudfunctions/travel/lib');
const studyLib = require('../uniCloud-alipay/cloudfunctions/study/lib');

const START = '2026-10-01';
const END = '2026-10-03';

/** 合法的出行计划入参 */
function planInput(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'travel-1',
    title: '周末露营',
    startDate: START,
    endDate: END,
    destination: '莫干山',
    members: ['member-1', 'member-2'],
    budget: 1200,
    status: 'planned',
    note: '记得带帐篷',
    ...overrides,
  };
}

/** 合法的行程明细入参 */
function itemInput(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'trip-1',
    travelId: 'travel-1',
    order: 0,
    time: '上午 9:00',
    activity: '出发',
    note: '集合点：小区东门',
    done: false,
    ...overrides,
  };
}

describe('travelLib.validatePlanPayload', () => {
  it('接受合法入参并归一化（trim 文本、预算转数值）', () => {
    const result = travelLib.validatePlanPayload(
      planInput({ title: '  周末露营  ', destination: ' 莫干山 ', budget: '1200' }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        clientId: 'travel-1',
        title: '周末露营',
        startDate: START,
        endDate: END,
        destination: '莫干山',
        members: ['member-1', 'member-2'],
        budget: 1200,
        status: 'planned',
        note: '记得带帐篷',
      },
    });
  });

  it('缺 clientId / 标题为空 / 日期格式非法时拒绝', () => {
    expect(travelLib.validatePlanPayload(planInput({ clientId: '' })).ok).toBe(false);
    expect(travelLib.validatePlanPayload(planInput({ title: '   ' })).ok).toBe(false);
    expect(travelLib.validatePlanPayload(planInput({ startDate: '2026/10/01' })).ok).toBe(false);
    expect(travelLib.validatePlanPayload(planInput({ endDate: '' })).ok).toBe(false);
  });

  it('开始日期不能晚于结束日期；同日是合法的（一日游）', () => {
    expect(travelLib.validatePlanPayload(planInput({ startDate: END, endDate: START })).ok).toBe(
      false,
    );
    expect(travelLib.validatePlanPayload(planInput({ startDate: START, endDate: START })).ok).toBe(
      true,
    );
  });

  it('标题 / 目的地 / 备注超长时拒绝，恰好等于上限时通过', () => {
    const tooLong = (max: number) => 'a'.repeat(max + 1);

    expect(travelLib.validatePlanPayload(planInput({ title: tooLong(travelLib.TITLE_MAX) })).ok).toBe(
      false,
    );
    expect(
      travelLib.validatePlanPayload(planInput({ destination: tooLong(travelLib.DESTINATION_MAX) })).ok,
    ).toBe(false);
    expect(travelLib.validatePlanPayload(planInput({ note: tooLong(travelLib.NOTE_MAX) })).ok).toBe(
      false,
    );

    expect(
      travelLib.validatePlanPayload(planInput({ title: 'a'.repeat(travelLib.TITLE_MAX) })).ok,
    ).toBe(true);
    expect(
      travelLib.validatePlanPayload(planInput({ destination: 'a'.repeat(travelLib.DESTINATION_MAX) }))
        .ok,
    ).toBe(true);
    expect(travelLib.validatePlanPayload(planInput({ note: 'a'.repeat(travelLib.NOTE_MAX) })).ok).toBe(
      true,
    );
  });

  it('⚠️ 目的地 / 备注缺省 / null / 空串归一为**空串**而不是 null', () => {
    // 落 null 会让前端 validateTravelPlan（要求 destination/note 是字符串）判非法，
    // 整条出行计划被 TravelRepository 静默丢弃
    const result = travelLib.validatePlanPayload(
      planInput({ destination: undefined, note: null }),
    );

    expect(result.ok).toBe(true);
    expect(result.value.destination).toBe('');
    expect(result.value.note).toBe('');
  });

  it('可空文本非字符串时拒绝', () => {
    expect(travelLib.validatePlanPayload(planInput({ destination: 123 })).ok).toBe(false);
    expect(travelLib.validatePlanPayload(planInput({ note: [] })).ok).toBe(false);
  });

  it('状态只接受四个值，且与前端 TRAVEL_STATUSES 完全一致', () => {
    for (const status of ['planned', 'ongoing', 'done', 'cancelled']) {
      expect(travelLib.validatePlanPayload(planInput({ status })).ok).toBe(true);
    }
    for (const status of ['finished', '', undefined, null, 1]) {
      expect(
        travelLib.validatePlanPayload(planInput({ status })).ok,
        `status=${String(status)} 应被拒绝`,
      ).toBe(false);
    }

    // 前端加了状态而云端没加 → 该状态的计划在本地能存、推云端必被拒（静默丢数据）
    expect(travelLib.TRAVEL_STATUSES).toEqual(FRONT_TRAVEL_STATUSES.map((item) => item.value));
  });
});

describe('travelLib.normalizeMembers（与前端 normalizeTravelMembers 同口径）', () => {
  it('去重 + 剔除空值/非字符串，保持原顺序', () => {
    expect(travelLib.normalizeMembers(['m1', 'm2', 'm1', '', 'm3']).value).toEqual([
      'm1',
      'm2',
      'm3',
    ]);
    expect(travelLib.normalizeMembers(['  m1  ', 'm1']).value).toEqual(['m1']);
    expect(travelLib.normalizeMembers([1, 'm1', null, undefined, 'm2']).value).toEqual(['m1', 'm2']);
  });

  it('非数组（含缺省）归一为空数组，而不是报错丢弃整条计划', () => {
    for (const value of [undefined, null, '', 'm1,m2', {}, 5]) {
      expect(travelLib.normalizeMembers(value)).toEqual({ ok: true, value: [] });
    }
  });

  it('⚠️ 与前端 normalizeTravelMembers 在穷举输入上逐一致（两端归一化不得分叉）', () => {
    // 两端归一化结果不同的话，同一份数据在本地与云端会长得不一样，
    // 同步时反复「发现变化」而白白推送
    const cases: unknown[] = [
      undefined,
      null,
      'not-array',
      {},
      0,
      [],
      ['m1'],
      ['m1', 'm1'],
      ['m1', '', 'm2'],
      ['  m1  ', 'm1', 'm2'],
      [1, 'm1', null, 'm1'],
      ['m2', 'm1', 'm2', 'm3', ''],
    ];

    for (const input of cases) {
      expect(travelLib.normalizeMembers(input).value, `输入 ${JSON.stringify(input)}`).toEqual(
        normalizeTravelMembers(input),
      );
    }
  });

  it('多出来的「成员不存在也不剔除」语义与前端一致（成员被移出家庭不该让计划变形）', () => {
    const members = ['已被移出家庭的成员', 'member-1'];

    expect(travelLib.normalizeMembers(members).value).toEqual(normalizeTravelMembers(members));
    expect(travelLib.normalizeMembers(members).value).toHaveLength(2);
  });

  it('⚠️ 超长成员标识是云端独有的防御（前端只 trim 不判长）', () => {
    // 这条刻意与前端不一致，故不放进上面的等价断言里。
    // createId 产出的 id 约 41 字符，正常永远触发不到。
    const longId = 'm'.repeat(travelLib.CLIENT_ID_MAX + 1);

    expect(travelLib.normalizeMembers([longId]).ok).toBe(false);
    expect(normalizeTravelMembers([longId])).toEqual([longId]);
  });

  it('成员数超过防御性上限时拒绝', () => {
    const many = Array.from({ length: travelLib.MEMBERS_MAX + 1 }, (_, index) => `m-${index}`);

    expect(travelLib.normalizeMembers(many).ok).toBe(false);
    expect(travelLib.normalizeMembers(many.slice(0, travelLib.MEMBERS_MAX)).ok).toBe(true);
  });
});

describe('travelLib.normalizeBudget', () => {
  it('缺省 / 空值 → 0（不是 null）', () => {
    for (const value of [undefined, null, '']) {
      expect(travelLib.normalizeBudget(value)).toEqual({ ok: true, value: 0 });
    }
  });

  it('接受 0 与上限，拒绝负数 / 超上限 / 非数字', () => {
    expect(travelLib.normalizeBudget(0).value).toBe(0);
    expect(travelLib.normalizeBudget(travelLib.BUDGET_MAX).value).toBe(travelLib.BUDGET_MAX);

    for (const value of [-1, travelLib.BUDGET_MAX + 1, 'abc', NaN, Infinity]) {
      expect(
        travelLib.normalizeBudget(value).ok,
        `budget=${String(value)} 应被拒绝`,
      ).toBe(false);
    }
  });

  it('数字字符串按数值处理（表单可能给出字符串）', () => {
    expect(travelLib.normalizeBudget('350.5').value).toBe(350.5);
  });
});

describe('travelLib.mergePlanPatch', () => {
  const existing = {
    clientId: 'travel-1',
    title: '周末露营',
    startDate: START,
    endDate: END,
    destination: '莫干山',
    members: ['member-1', 'member-2'],
    budget: 1200,
    status: 'planned',
    note: '记得带帐篷',
  };

  it('只覆盖显式传入的字段', () => {
    const merged = travelLib.mergePlanPatch(existing, { status: 'ongoing' });

    expect(merged.value).toEqual({ ...existing, status: 'ongoing' });
  });

  it('合并结果可交给 validatePlanPayload 复校', () => {
    const merged = travelLib.mergePlanPatch(existing, { budget: 2000 });

    expect(travelLib.validatePlanPayload(merged.value)).toEqual({
      ok: true,
      value: { ...existing, budget: 2000 },
    });
  });

  it('复校能发现「改坏了」的 patch（把开始日期改晚了）', () => {
    const merged = travelLib.mergePlanPatch(existing, { startDate: '2026-10-05' });

    expect(travelLib.validatePlanPayload(merged.value).ok).toBe(false);
  });

  it('只改状态不影响 members 等其他字段（数组字段不被误清空）', () => {
    const merged = travelLib.mergePlanPatch(existing, { status: 'done' });

    expect(merged.value.members).toEqual(['member-1', 'member-2']);
  });

  it('members 整体替换时会再去重归一', () => {
    const merged = travelLib.mergePlanPatch(existing, { members: ['m1', 'm1', '', 'm2'] });
    const checked = travelLib.validatePlanPayload(merged.value);

    expect(checked.ok).toBe(true);
    expect(checked.value.members).toEqual(['m1', 'm2']);
  });

  it('⚠️ clientId 不随 patch 改变（幂等键不可由客户端篡改）', () => {
    const merged = travelLib.mergePlanPatch(existing, { clientId: 'hacked' });

    expect(merged.value.clientId).toBe('travel-1');
  });
});

describe('travelLib.validateItemPayload', () => {
  it('接受合法入参并归一化', () => {
    expect(travelLib.validateItemPayload(itemInput({ activity: ' 出发 ' }))).toEqual({
      ok: true,
      value: {
        clientId: 'trip-1',
        travelId: 'travel-1',
        order: 0,
        time: '上午 9:00',
        activity: '出发',
        note: '集合点：小区东门',
        done: false,
      },
    });
  });

  it('缺少所属计划时拒绝（主从约束的前提）', () => {
    for (const travelId of ['', '   ', undefined, null, 1]) {
      expect(
        travelLib.validateItemPayload(itemInput({ travelId })).ok,
        `travelId=${String(travelId)} 应被拒绝`,
      ).toBe(false);
    }
  });

  it('活动不能为空，且超长拒绝', () => {
    expect(travelLib.validateItemPayload(itemInput({ activity: '  ' })).ok).toBe(false);
    expect(
      travelLib.validateItemPayload(itemInput({ activity: 'a'.repeat(travelLib.ITEM_ACTIVITY_MAX + 1) }))
        .ok,
    ).toBe(false);
  });

  it('⚠️ 时间 / 备注缺省 / null / 空串归一为**空串**而不是 null', () => {
    const result = travelLib.validateItemPayload(itemInput({ time: undefined, note: null }));

    expect(result.ok).toBe(true);
    expect(result.value.time).toBe('');
    expect(result.value.note).toBe('');
  });

  it('时间 / 备注超长时拒绝', () => {
    expect(
      travelLib.validateItemPayload(itemInput({ time: 'a'.repeat(travelLib.ITEM_TIME_MAX + 1) })).ok,
    ).toBe(false);
    expect(
      travelLib.validateItemPayload(itemInput({ note: 'a'.repeat(travelLib.ITEM_NOTE_MAX + 1) })).ok,
    ).toBe(false);
  });

  it('⚠️ order 缺省不报错（默认 0），负数 / 非数字拒绝，小数向下取整', () => {
    // order 是 M3 才引入的字段，缺省只可能来自老数据或调用方漏传 ——
    // 两者都不该让整条明细被丢弃（静默丢数据）
    expect(travelLib.validateItemPayload(itemInput({ order: undefined })).value.order).toBe(0);
    expect(travelLib.validateItemPayload(itemInput({ order: null })).value.order).toBe(0);
    expect(travelLib.validateItemPayload(itemInput({ order: '' })).value.order).toBe(0);

    expect(travelLib.validateItemPayload(itemInput({ order: 3 })).value.order).toBe(3);
    expect(travelLib.validateItemPayload(itemInput({ order: '3' })).value.order).toBe(3);
    expect(travelLib.validateItemPayload(itemInput({ order: 2.7 })).value.order).toBe(2);

    for (const order of [-1, 'abc', NaN, Infinity]) {
      expect(
        travelLib.validateItemPayload(itemInput({ order })).ok,
        `order=${String(order)} 应被拒绝`,
      ).toBe(false);
    }
  });

  it('⚠️ done 只认严格布尔 true，其余一律 false', () => {
    expect(travelLib.validateItemPayload(itemInput({ done: true })).value.done).toBe(true);

    for (const done of [false, undefined, null, '', 1, 'true']) {
      expect(
        travelLib.validateItemPayload(itemInput({ done })).value.done,
        `done=${JSON.stringify(done)} 应归一为 false`,
      ).toBe(false);
    }
  });
});

describe('travelLib.mergeItemPatch', () => {
  const existing = {
    clientId: 'trip-1',
    travelId: 'travel-1',
    order: 2,
    time: '上午 9:00',
    activity: '出发',
    note: '集合点：小区东门',
    done: false,
  };

  it('只覆盖显式传入的字段', () => {
    expect(travelLib.mergeItemPatch(existing, { done: true }).value).toEqual({
      ...existing,
      done: true,
    });
  });

  it('合并结果可交给 validateItemPayload 复校', () => {
    const merged = travelLib.mergeItemPatch(existing, { order: 5 });

    expect(travelLib.validateItemPayload(merged.value).value.order).toBe(5);
  });

  it('复校能发现「改坏了」的 patch（把活动清空）', () => {
    const merged = travelLib.mergeItemPatch(existing, { activity: '   ' });

    expect(travelLib.validateItemPayload(merged.value).ok).toBe(false);
  });

  it('⚠️ clientId 与 travelId 都不随 patch 改变', () => {
    // 明细换计划会让「按计划拉取」的两个端点都看不到它，等于凭空消失
    const merged = travelLib.mergeItemPatch(existing, {
      clientId: 'hacked',
      travelId: 'travel-9',
    });

    expect(merged.value.clientId).toBe('trip-1');
    expect(merged.value.travelId).toBe('travel-1');
  });
});

describe('travelLib.validateItemQuery', () => {
  it('必须给出所属计划', () => {
    expect(travelLib.validateItemQuery({ travelId: 'travel-1' })).toEqual({
      ok: true,
      value: { travelId: 'travel-1' },
    });
    expect(travelLib.validateItemQuery({}).ok).toBe(false);
    expect(travelLib.validateItemQuery({ travelId: '  ' }).ok).toBe(false);
  });
});

describe('travelLib 云端记录 → 前端形态', () => {
  const planRow = {
    _id: 'abc123',
    clientId: 'travel-1',
    title: '周末露营',
    startDate: START,
    endDate: END,
    destination: '莫干山',
    members: ['member-1', 'member-2'],
    budget: 1200,
    status: 'planned',
    note: '记得带帐篷',
  };

  const itemRow = {
    _id: 'def456',
    clientId: 'trip-1',
    travelId: 'travel-1',
    order: 1,
    time: '上午 9:00',
    activity: '出发',
    note: '集合点：小区东门',
    done: false,
  };

  it('toClientItem 的输出能被前端 validateTravelPlan 接受（放进计划里校验）', () => {
    const plan = travelLib.toClientPlan(planRow, [travelLib.toClientItem(itemRow)]);

    expect(validateTravelPlan(plan)).toEqual({ valid: true, errors: [] });
  });

  it('⚠️ items 缺省时落空数组（前端要求 Array.isArray）', () => {
    expect(travelLib.toClientPlan(planRow).items).toEqual([]);
    expect(travelLib.toClientPlan(planRow, undefined).items).toEqual([]);
    expect(travelLib.toClientPlan(planRow, null).items).toEqual([]);
    expect(validateTravelPlan(travelLib.toClientPlan(planRow)).valid).toBe(true);
  });

  it('toClientPlan 对脏数据兜底：非法状态 → planned、非法 budget → 0、数组字段不落 null', () => {
    const mapped = travelLib.toClientPlan({
      clientId: 'travel-x',
      status: 'finished',
      budget: 'abc',
      members: 'not-array',
    });

    expect(mapped.status).toBe('planned');
    expect(mapped.budget).toBe(0);
    expect(mapped.members).toEqual([]);
    expect(mapped.items).toEqual([]);
    expect(mapped.note).toBe('');
    expect(mapped.destination).toBe('');
  });

  it('members 里的非字符串项被剔除（与 normalizeMembers 同口径）', () => {
    const mapped = travelLib.toClientPlan({ clientId: 'x', members: ['m1', 2, null, 'm2'] });

    expect(mapped.members).toEqual(['m1', 'm2']);
  });

  it('toClientItem 始终给出有限的 order（云端返回顺序不保证稳定）', () => {
    expect(travelLib.toClientItem({ clientId: 'trip-9' }).order).toBe(0);
    expect(travelLib.toClientItem({ clientId: 'trip-9', order: null }).order).toBe(0);
    expect(travelLib.toClientItem({ clientId: 'trip-9', order: 'abc' }).order).toBe(0);
    expect(travelLib.toClientItem({ clientId: 'trip-9', order: 4.9 }).order).toBe(4);
  });

  it('toClientItem 的空文本落空串而不是 null', () => {
    const mapped = travelLib.toClientItem({ clientId: 'trip-9', time: null, note: null });

    expect(mapped.time).toBe('');
    expect(mapped.note).toBe('');
    expect(mapped.activity).toBe('');
    expect(mapped.done).toBe(false);
  });

  it('拉取到的明细经 toClientItem 后可按 order 还原顺序（与第 2 步的 sortTravelItems 联锁）', () => {
    const rows = [
      { clientId: 'trip-c', order: 2, activity: 'C' },
      { clientId: 'trip-a', order: 0, activity: 'A' },
      { clientId: 'trip-b', order: 1, activity: 'B' },
    ];

    const sorted = sortTravelItems(rows.map(travelLib.toClientItem));

    expect(sorted.map((item) => item.id)).toEqual(['trip-a', 'trip-b', 'trip-c']);
  });
});

describe('travelLib.deleteInBatches（级联删除的循环控制）', () => {
  /** 按给定批次序列返回，跑完后一直返回 0 */
  function batched(sequence: number[]) {
    let index = 0;
    let calls = 0;
    const deleteBatch = async () => {
      calls += 1;
      const value = sequence[index] ?? 0;
      index += 1;
      return value;
    };
    return { deleteBatch, calls: () => calls };
  }

  it('一次删完就停（第二批返回 0 即终止）', async () => {
    const { deleteBatch, calls } = batched([5]);

    await expect(travelLib.deleteInBatches(deleteBatch)).resolves.toEqual({
      deleted: 5,
      rounds: 2,
      truncated: false,
    });
    expect(calls()).toBe(2);
  });

  it('⚠️ 达到轮次上限仍未删完 → truncated（调用方不得继续删主记录）', async () => {
    const { deleteBatch, calls } = batched([100, 100, 100, 100, 100]);

    const result = await travelLib.deleteInBatches(deleteBatch, { maxRounds: 3 });

    expect(result).toEqual({ deleted: 300, rounds: 3, truncated: true });
    expect(calls(), '轮次上限必须真正生效').toBe(3);
  });

  it('删除动作返回非数字时按 0 处理并停止（不让脏返回值造成死循环）', async () => {
    const deleteBatch = async () => undefined as unknown as number;

    await expect(travelLib.deleteInBatches(deleteBatch, { maxRounds: 5 })).resolves.toEqual({
      deleted: 0,
      rounds: 1,
      truncated: false,
    });
  });

  it('⚠️ 与 study/lib.js 的同名函数在穷举序列上行为完全一致（两份拷贝不得漂移）', async () => {
    // 自包含约束不允许 travel 引用 study 的 lib，只能各自复制一份；
    // 而这段控制流一旦写错就会留下孤儿明细（计划没了、明细还在，界面渲染不出来）。
    // 所以用「行为等价」把它锁住 —— 改一处务必改另一处。
    const cases: Array<[number[], number | undefined]> = [
      [[5], undefined],
      [[], undefined],
      [[100, 100, 100], undefined],
      [[100, 100, 0], 3],
      [[100, 100, 100, 100, 100], 3],
      [[1, 1, 1, 1, 1, 1], 2],
    ];

    for (const [sequence, maxRounds] of cases) {
      const options = maxRounds === undefined ? undefined : { maxRounds };
      const label = `序列 ${sequence.join(',')} / maxRounds=${String(maxRounds)}`;

      expect(await travelLib.deleteInBatches(batched(sequence).deleteBatch, options), label).toEqual(
        await studyLib.deleteInBatches(batched(sequence).deleteBatch, options),
      );
    }

    expect(travelLib.MAX_CASCADE_ROUNDS).toBe(studyLib.MAX_CASCADE_ROUNDS);
  });

  it('级联轮次上限被显式锁定', () => {
    expect(travelLib.MAX_CASCADE_ROUNDS).toBe(20);
  });
});

describe('travelLib 的长度上限被显式锁定', () => {
  it('数值与前端 TRAVEL_LIMITS 一致（改动需同步两端与表单 maxlength）', () => {
    expect(travelLib.TITLE_MAX).toBe(40);
    expect(travelLib.DESTINATION_MAX).toBe(40);
    expect(travelLib.NOTE_MAX).toBe(200);
    expect(travelLib.ITEM_TIME_MAX).toBe(20);
    expect(travelLib.ITEM_ACTIVITY_MAX).toBe(40);
    expect(travelLib.ITEM_NOTE_MAX).toBe(100);
    expect(travelLib.CLIENT_ID_MAX).toBe(64);
  });

  it('预算上限与前端 validateTravelPlan 的数值边界一致', () => {
    expect(travelLib.BUDGET_MIN).toBe(0);
    expect(travelLib.BUDGET_MAX).toBe(100000000);
  });
});
