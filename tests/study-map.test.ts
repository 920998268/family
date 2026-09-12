import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import type { StudyCheckin, StudyPlan } from '@/types/models';
import {
  fromCloudStudyCheckin,
  fromCloudStudyPlan,
  mapCloudStudyCheckins,
  mapCloudStudyPlans,
  toCloudStudyCheckin,
  toCloudStudyPlan,
} from '@/utils/cloudMap';
import { validateStudyCheckin, validateStudyPlan } from '@/utils/validation';

const require = createRequire(import.meta.url);
const studyLib = require('../uniCloud-alipay/cloudfunctions/study/lib');

const DATE = '2026-09-12';
const ISO = '2026-09-12T03:20:00.000Z';
const MS = Date.parse(ISO);

function plan(overrides: Partial<StudyPlan> = {}): StudyPlan {
  return {
    id: 'study-1',
    title: '每天背单词',
    subject: '英语',
    frequency: 'daily',
    targetTimes: 1,
    createdAt: ISO,
    ...overrides,
  };
}

function checkin(overrides: Partial<StudyCheckin> = {}): StudyCheckin {
  return {
    id: 'checkin-1',
    planId: 'study-1',
    date: DATE,
    note: '背了 50 个词',
    ...overrides,
  };
}

describe('上行：前端 → 云函数入参', () => {
  it('计划：id 映射为 clientId，且**不上行 createdAt**', () => {
    const payload = toCloudStudyPlan(plan());

    expect(payload).toEqual({
      clientId: 'study-1',
      title: '每天背单词',
      subject: '英语',
      frequency: 'daily',
      targetTimes: 1,
      memberId: null,
    });
    // 创建时间由服务端 Date.now() 决定：上行会被客户端时钟偏差污染排序
    expect('createdAt' in payload).toBe(false);
  });

  it('计划：memberId 缺省 / 空串一律上行 null（显式表达「未指定」）', () => {
    expect(toCloudStudyPlan(plan({ memberId: undefined })).memberId).toBeNull();
    expect(toCloudStudyPlan(plan({ memberId: '' })).memberId).toBeNull();
    expect(toCloudStudyPlan(plan({ memberId: 'member-1' })).memberId).toBe('member-1');
  });

  it('打卡：note 归一为字符串（空值 → 空串），与云端 normalizeNote 一致', () => {
    expect(toCloudStudyCheckin(checkin({ note: undefined as unknown as string })).note).toBe('');
    expect(toCloudStudyCheckin(checkin({ note: '  背单词  ' })).note).toBe('  背单词  ');
  });

  it('打卡：字段名映射正确', () => {
    expect(toCloudStudyCheckin(checkin())).toEqual({
      clientId: 'checkin-1',
      planId: 'study-1',
      date: DATE,
      note: '背了 50 个词',
      memberId: null,
    });
  });
});

describe('下行：云函数记录 → 前端模型', () => {
  it('计划：毫秒时间戳换算成 ISO 字符串', () => {
    expect(fromCloudStudyPlan({ clientId: 'study-1', createdAt: MS }).createdAt).toBe(ISO);
  });

  it('计划：已经是 ISO 时幂等（服务端 toClientPlan 已转过一次也不受影响）', () => {
    expect(fromCloudStudyPlan({ clientId: 'study-1', createdAt: ISO }).createdAt).toBe(ISO);
  });

  it('计划：createdAt 缺失 / 非法 → 空串（显式丢弃，不猜一个值）', () => {
    // 猜值（比如当前时间）会让计划列表排序静默错乱，比丢弃更难查
    expect(fromCloudStudyPlan({ clientId: 'study-1' }).createdAt).toBe('');
    expect(fromCloudStudyPlan({ clientId: 'study-1', createdAt: 'abc' }).createdAt).toBe('');
  });

  it('计划：frequency 非法时兜底 daily，不至于整条丢失', () => {
    expect(fromCloudStudyPlan({ clientId: 'x', frequency: 'monthly' }).frequency).toBe('daily');
  });

  it('计划：兼容裸库文档（clientId / _id 均可作 id）', () => {
    expect(fromCloudStudyPlan({ _id: 'db-1' }).id).toBe('db-1');
    expect(fromCloudStudyPlan({ clientId: 'c-1', _id: 'db-1' }).id).toBe('c-1');
  });

  it('⚠️ 打卡：云端 note 为 null 时归一成空串', () => {
    expect(fromCloudStudyCheckin({ clientId: 'c', note: null }).note).toBe('');
    expect(fromCloudStudyCheckin({ clientId: 'c' }).note).toBe('');
  });

  it('打卡：note 为字符串时原样保留', () => {
    expect(fromCloudStudyCheckin({ clientId: 'c', note: '读了 20 页' }).note).toBe('读了 20 页');
  });
});

describe('列表映射（逐行校验 + 丢弃非法行）', () => {
  it('非数组入参返回空数组', () => {
    for (const value of [null, undefined, {}, 'x', 1]) {
      expect(mapCloudStudyPlans(value)).toEqual([]);
      expect(mapCloudStudyCheckins(value)).toEqual([]);
    }
  });

  it('计划：保留合法行、丢弃非法行', () => {
    const rows = [
      { clientId: 'ok', title: '背单词', subject: '英语', frequency: 'daily', targetTimes: 1, createdAt: MS },
      { clientId: 'bad-no-title', subject: '英语', frequency: 'daily', targetTimes: 1, createdAt: MS },
      null,
      'not-an-object',
    ];

    const result = mapCloudStudyPlans(rows);

    expect(result.map((item) => item.id)).toEqual(['ok']);
  });

  it('打卡：保留合法行、丢弃 note 异常的脏行之外仍能保留合法行', () => {
    const rows = [
      { clientId: 'ok', planId: 'study-1', date: DATE, note: null },
      { clientId: 'bad-date', planId: 'study-1', date: '2026/09/12', note: '' },
    ];

    expect(mapCloudStudyCheckins(rows).map((item) => item.id)).toEqual(['ok']);
  });

  it('计划：targetTimes 缺失时落 0 → 被校验拦下而丢弃（显式，不猜值）', () => {
    const rows = [
      { clientId: 'x', title: '背单词', subject: '英语', frequency: 'daily', createdAt: MS },
    ];

    expect(mapCloudStudyPlans(rows)).toEqual([]);
  });
});

describe('往返一致性', () => {
  it('计划往返后除 createdAt 外字段一致', () => {
    const original = plan({ memberId: 'member-1' });
    const back = fromCloudStudyPlan(toCloudStudyPlan(original));

    expect(back).toEqual({ ...original, createdAt: '' });
  });

  it('打卡往返后字段一致', () => {
    const original = checkin();

    expect(fromCloudStudyCheckin(toCloudStudyCheckin(original))).toEqual(original);
  });
});

describe('两层映射串联（跨模块守卫）', () => {
  it('前端 fromCloudStudyPlan 的输出能被前端 validateStudyPlan 接受', () => {
    const row = {
      clientId: 'study-1',
      title: '每天背单词',
      subject: '英语',
      frequency: 'weekly',
      targetTimes: 3,
      memberId: null,
      createdAt: MS,
    };

    expect(validateStudyPlan(fromCloudStudyPlan(row))).toEqual({ valid: true, errors: [] });
  });

  it('前端 fromCloudStudyCheckin 的输出能被前端 validateStudyCheckin 接受', () => {
    const row = { clientId: 'checkin-1', planId: 'study-1', date: DATE, note: null };

    expect(validateStudyCheckin(fromCloudStudyCheckin(row))).toEqual({ valid: true, errors: [] });
  });

  it('云函数 toClientPlan → 前端 fromCloudStudyPlan → 通过前端校验（两层串联）', () => {
    // 服务端先转一次 ISO，前端再转一次（幂等）—— 两层都必须能被前端校验器接受
    const clientShape = studyLib.toClientPlan({
      _id: 'db-1',
      clientId: 'study-1',
      title: '每天背单词',
      subject: '英语',
      frequency: 'daily',
      targetTimes: 1,
      memberId: null,
      createdAt: MS,
    });

    expect(validateStudyPlan(fromCloudStudyPlan(clientShape))).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('云函数 toClientCheckin → 前端 fromCloudStudyCheckin → 通过前端校验（两层串联）', () => {
    const clientShape = studyLib.toClientCheckin({
      clientId: 'checkin-1',
      planId: 'study-1',
      date: DATE,
      note: null,
      memberId: null,
    });

    expect(validateStudyCheckin(fromCloudStudyCheckin(clientShape))).toEqual({
      valid: true,
      errors: [],
    });
  });
});
