import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { validateStudyCheckin, validateStudyPlan } from '@/utils/validation';
import { toIsoString as frontendToIsoString } from '@/utils/date';
import { normalizeStudyNote } from '@/utils/study';

// 云函数 lib.js 为 CommonJS 纯逻辑模块，用 createRequire 加载（避免无类型声明的 TS 报错）
const require = createRequire(import.meta.url);
const studyLib = require('../uniCloud-alipay/cloudfunctions/study/lib');

const DATE = '2026-09-12';
const MS = Date.parse('2026-09-12T03:20:00.000Z');

/** 合法的计划入参 */
function planInput(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'study-1',
    title: '每天背单词',
    subject: '英语',
    frequency: 'daily',
    targetTimes: 1,
    ...overrides,
  };
}

/** 合法的打卡入参 */
function checkinInput(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'checkin-1',
    planId: 'study-1',
    date: DATE,
    note: '背了 50 个词',
    ...overrides,
  };
}

describe('studyLib.validatePlanPayload', () => {
  it('接受合法入参并归一化（trim 文本、数字转数值、缺省成员置 null）', () => {
    const result = studyLib.validatePlanPayload(
      planInput({ title: '  每天背单词  ', targetTimes: '5' }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        clientId: 'study-1',
        title: '每天背单词',
        subject: '英语',
        frequency: 'daily',
        targetTimes: 5,
        memberId: null,
      },
    });
  });

  it('缺 clientId / 标题 / 学习内容时拒绝', () => {
    expect(studyLib.validatePlanPayload(planInput({ clientId: '' })).ok).toBe(false);
    expect(studyLib.validatePlanPayload(planInput({ title: '   ' })).ok).toBe(false);
    expect(studyLib.validatePlanPayload(planInput({ subject: '' })).ok).toBe(false);
  });

  it('频率只接受 daily / weekly', () => {
    for (const frequency of ['daily', 'weekly']) {
      expect(studyLib.validatePlanPayload(planInput({ frequency })).ok).toBe(true);
    }
    for (const frequency of ['monthly', '', undefined, 1]) {
      expect(studyLib.validatePlanPayload(planInput({ frequency })).ok).toBe(false);
    }
  });

  it('目标次数边界：1~1000 合法，0 / 1001 / 空 / 非数字拒绝', () => {
    expect(studyLib.validatePlanPayload(planInput({ targetTimes: 1 })).ok).toBe(true);
    expect(studyLib.validatePlanPayload(planInput({ targetTimes: 1000 })).ok).toBe(true);

    for (const targetTimes of [0, -1, 1001, '', null, 'abc', Number.NaN]) {
      expect(
        studyLib.validatePlanPayload(planInput({ targetTimes })).ok,
        `targetTimes=${String(targetTimes)} 应被拒绝`,
      ).toBe(false);
    }
  });

  it('文本超长时拒绝', () => {
    const tooLong = 'a'.repeat(studyLib.TITLE_MAX + 1);
    expect(studyLib.validatePlanPayload(planInput({ title: tooLong })).ok).toBe(false);
    expect(
      studyLib.validatePlanPayload(planInput({ subject: 'b'.repeat(studyLib.SUBJECT_MAX + 1) })).ok,
    ).toBe(false);
  });

  it('memberId 缺省 / 空串归一为 null，非法类型拒绝', () => {
    expect(studyLib.validatePlanPayload(planInput({ memberId: '' })).value.memberId).toBeNull();
    expect(studyLib.validatePlanPayload(planInput({ memberId: null })).value.memberId).toBeNull();
    expect(studyLib.validatePlanPayload(planInput({ memberId: 'member-1' })).value.memberId).toBe(
      'member-1',
    );
    expect(studyLib.validatePlanPayload(planInput({ memberId: 123 })).ok).toBe(false);
  });
});

describe('studyLib.mergePlanPatch', () => {
  const existing = {
    clientId: 'study-1',
    title: '每天背单词',
    subject: '英语',
    frequency: 'daily',
    targetTimes: 1,
    memberId: null,
  };

  it('只覆盖显式传入的字段', () => {
    const merged = studyLib.mergePlanPatch(existing, { targetTimes: 3 });

    expect(merged.value).toEqual({
      clientId: 'study-1',
      title: '每天背单词',
      subject: '英语',
      frequency: 'daily',
      targetTimes: 3,
      memberId: null,
    });
  });

  it('合并结果可交给 validatePlanPayload 复校', () => {
    const merged = studyLib.mergePlanPatch(existing, { frequency: 'weekly' });

    expect(studyLib.validatePlanPayload(merged.value).ok).toBe(true);
  });

  it('复校能发现「改坏了」的 patch（把频率改成非法值）', () => {
    const merged = studyLib.mergePlanPatch(existing, { frequency: 'monthly' });

    expect(studyLib.validatePlanPayload(merged.value).ok).toBe(false);
  });

  it('clientId 不随 patch 改变（幂等键不可由客户端篡改）', () => {
    const merged = studyLib.mergePlanPatch(existing, { clientId: 'hacked' });

    expect(merged.value.clientId).toBe('study-1');
  });
});

describe('studyLib.validateCheckinPayload', () => {
  it('接受合法入参', () => {
    expect(studyLib.validateCheckinPayload(checkinInput())).toEqual({
      ok: true,
      value: {
        clientId: 'checkin-1',
        planId: 'study-1',
        date: DATE,
        note: '背了 50 个词',
        memberId: null,
      },
    });
  });

  it('缺少所属计划时拒绝', () => {
    expect(studyLib.validateCheckinPayload(checkinInput({ planId: '' })).ok).toBe(false);
    expect(studyLib.validateCheckinPayload(checkinInput({ planId: undefined })).ok).toBe(false);
  });

  it('日期格式非法时拒绝', () => {
    expect(studyLib.validateCheckinPayload(checkinInput({ date: '2026/09/12' })).ok).toBe(false);
    expect(studyLib.validateCheckinPayload(checkinInput({ date: '' })).ok).toBe(false);
  });

  it('⚠️ 备注缺省 / null 归一为**空串**而不是 null', () => {
    // 落 null 会让前端 validateStudyCheckin（要求 note 是字符串）判非法，
    // 整条打卡被前端静默丢弃 —— 这是最容易埋雷的一处
    expect(studyLib.validateCheckinPayload(checkinInput({ note: undefined })).value.note).toBe('');
    expect(studyLib.validateCheckinPayload(checkinInput({ note: null })).value.note).toBe('');
    expect(studyLib.validateCheckinPayload(checkinInput({ note: '   ' })).value.note).toBe('');
  });

  it('备注非字符串 / 超长时拒绝', () => {
    expect(studyLib.validateCheckinPayload(checkinInput({ note: 123 })).ok).toBe(false);
    expect(
      studyLib.validateCheckinPayload(checkinInput({ note: 'x'.repeat(studyLib.NOTE_MAX + 1) })).ok,
    ).toBe(false);
  });
});

describe('studyLib.validateCheckinQuery', () => {
  it('必须给出合法日期', () => {
    expect(studyLib.validateCheckinQuery({ date: DATE })).toEqual({
      ok: true,
      value: { date: DATE },
    });
    expect(studyLib.validateCheckinQuery({}).ok).toBe(false);
    expect(studyLib.validateCheckinQuery({ date: 'bad' }).ok).toBe(false);
  });
});

describe('studyLib.toIsoString（与前端实现等价）', () => {
  it('毫秒转 ISO', () => {
    expect(studyLib.toIsoString(MS)).toBe('2026-09-12T03:20:00.000Z');
  });

  it('已是 ISO 时幂等', () => {
    expect(studyLib.toIsoString('2026-09-12T03:20:00.000Z')).toBe('2026-09-12T03:20:00.000Z');
  });

  it('非法输入返回空串（而不是硬凑一个值）', () => {
    for (const value of ['', 'abc', null, undefined, Number.NaN, Infinity, {}]) {
      expect(studyLib.toIsoString(value), `输入 ${String(value)} 应返回空串`).toBe('');
    }
  });

  it('与前端 src/utils/date.ts 的 toIsoString 行为一致（防止两端漂移）', () => {
    for (const value of [MS, '2026-09-12T03:20:00.000Z', '', 'abc', null, undefined]) {
      expect(studyLib.toIsoString(value), `输入 ${String(value)} 两端应一致`).toBe(
        frontendToIsoString(value),
      );
    }
  });
});

describe('studyLib.normalizeNote', () => {
  it('缺省与空值归一为空串，字符串 trim 后返回', () => {
    expect(studyLib.normalizeNote(undefined).value).toBe('');
    expect(studyLib.normalizeNote(null).value).toBe('');
    expect(studyLib.normalizeNote('  背单词  ').value).toBe('背单词');
  });

  it('与前端 normalizeStudyNote 对空值的处理一致', () => {
    for (const value of [undefined, null]) {
      expect(studyLib.normalizeNote(value).value).toBe(normalizeStudyNote(value));
    }
  });
});

describe('云端记录 → 前端形态（跨模块守卫）', () => {
  it('toClientPlan 的输出能被前端 validateStudyPlan 接受', () => {
    const row = {
      _id: 'abc',
      clientId: 'study-1',
      title: '每天背单词',
      subject: '英语',
      frequency: 'daily',
      targetTimes: 1,
      memberId: null,
      createdAt: MS, // 云端是毫秒时间戳
    };

    expect(validateStudyPlan(studyLib.toClientPlan(row))).toEqual({ valid: true, errors: [] });
  });

  it('toClientCheckin 的输出能被前端 validateStudyCheckin 接受（note 为 null 的云端数据）', () => {
    const row = {
      clientId: 'checkin-1',
      planId: 'study-1',
      date: DATE,
      note: null, // 云端空备注
      memberId: null,
    };

    expect(validateStudyCheckin(studyLib.toClientCheckin(row))).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('toClientPlan 对缺字段的脏数据也能产出可被前端接受的形态', () => {
    const plan = studyLib.toClientPlan({ clientId: 'study-x' });

    expect(validateStudyPlan(plan).valid).toBe(false); // 缺 title/subject 本就该被拒
    expect(plan.createdAt).toBe(''); // 而 createdAt 落空串，是「显式丢弃」而非错序
  });

  it('toClientPlan 缺失 createdAt 时给出空串（而不是当前时间等误导值）', () => {
    expect(studyLib.toClientPlan({ clientId: 'study-1', createdAt: undefined }).createdAt).toBe('');
  });

  it('toClientPlan 的频率非法时兜底为 daily（老数据 / 脏数据不至于整条丢失）', () => {
    expect(studyLib.toClientPlan({ clientId: 'x', frequency: 'monthly' }).frequency).toBe('daily');
  });
});

describe('studyLib.deleteInBatches（级联删除的循环控制）', () => {
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

    await expect(studyLib.deleteInBatches(deleteBatch)).resolves.toEqual({
      deleted: 5,
      rounds: 2,
      truncated: false,
    });
    expect(calls()).toBe(2);
  });

  it('单批有上限时继续删，直到某一批为 0', async () => {
    // 模拟「云数据库单次 remove 有条数上限」：100/100/100 之后才删空
    const { deleteBatch, calls } = batched([100, 100, 100]);

    const result = await studyLib.deleteInBatches(deleteBatch);

    expect(result).toEqual({ deleted: 300, rounds: 4, truncated: false });
    expect(calls()).toBe(4);
  });

  it('一开始就没得删时只跑一轮', async () => {
    const { deleteBatch, calls } = batched([]);

    await expect(studyLib.deleteInBatches(deleteBatch)).resolves.toEqual({
      deleted: 0,
      rounds: 1,
      truncated: false,
    });
    expect(calls()).toBe(1);
  });

  it('⚠️ 达到轮次上限仍未删完 → truncated（调用方不得继续删主记录）', async () => {
    // 一直返回 100，永远删不完；必须靠轮次上限兜住，否则死循环
    const { deleteBatch, calls } = batched([100, 100, 100, 100, 100]);

    const result = await studyLib.deleteInBatches(deleteBatch, { maxRounds: 3 });

    expect(result.deleted).toBe(300);
    expect(result.rounds).toBe(3);
    expect(result.truncated).toBe(true);
    expect(calls(), '轮次上限必须真正生效').toBe(3);
  });

  it('恰好在上限轮删完时不算 truncated', async () => {
    const { deleteBatch } = batched([100, 100, 0]);

    const result = await studyLib.deleteInBatches(deleteBatch, { maxRounds: 3 });

    expect(result).toEqual({ deleted: 200, rounds: 3, truncated: false });
  });

  it('删除动作返回非数字时按 0 处理并停止（不让脏返回值造成死循环）', async () => {
    const deleteBatch = async () => undefined as unknown as number;

    await expect(
      studyLib.deleteInBatches(deleteBatch, { maxRounds: 5 }),
    ).resolves.toEqual({ deleted: 0, rounds: 1, truncated: false });
  });
});

describe('长度上限与前端 UI 的一致性', () => {
  it('上限值被显式锁定（改动需同步前端 maxlength）', () => {
    // ⚠️ 云端上限若比前端更严，本地合法记录会推不上去、重试 5 次后被丢弃。
    //    前端表单目前**还没有** maxlength（M2-B 第 7 步补），这里先锁住数值，
    //    避免后续无意改动造成两端不一致。
    expect(studyLib.TITLE_MAX).toBe(40);
    expect(studyLib.SUBJECT_MAX).toBe(40);
    expect(studyLib.NOTE_MAX).toBe(100);
    expect(studyLib.CLIENT_ID_MAX).toBe(64);
  });
});
