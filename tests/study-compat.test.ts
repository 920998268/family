import { describe, expect, it } from 'vitest';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { StudyPlanRepository } from '@/repositories/StudyPlanRepository';
import { StudyCheckinRepository } from '@/repositories/StudyCheckinRepository';
import { StudyService } from '@/services/StudyService';
import { toIsoString, toMillis } from '@/utils/date';
import { normalizeStudyNote } from '@/utils/study';
import { validateStudyCheckin, validateStudyPlan } from '@/utils/validation';
import type { StudyCheckin, StudyPlan } from '@/types/models';

const ISO = '2026-09-12T03:20:00.000Z';
const MS = Date.parse(ISO);

/** 老形态的计划：字段齐全、createdAt 是 ISO 字符串、没有 memberId */
function legacyPlan(overrides: Partial<StudyPlan> = {}): StudyPlan {
  return {
    id: 'study-legacy',
    title: '每天背单词',
    subject: '英语',
    frequency: 'daily',
    targetTimes: 1,
    createdAt: ISO,
    ...overrides,
  };
}

/** 老形态的打卡：note 是空串（本地一直这么存） */
function legacyCheckin(overrides: Partial<StudyCheckin> = {}): StudyCheckin {
  return {
    id: 'checkin-legacy',
    planId: 'study-legacy',
    date: '2026-09-12',
    note: '',
    ...overrides,
  };
}

describe('toMillis：把「ISO 字符串 或 毫秒数」统一解析成毫秒', () => {
  it('ISO 字符串转成对应毫秒', () => {
    expect(toMillis(ISO)).toBe(MS);
  });

  it('毫秒数字原样透传', () => {
    expect(toMillis(MS)).toBe(MS);
  });

  it('0 是合法时间戳，不能退化成 null', () => {
    // 0 会被当成 falsy 误判成「空值」，是这类函数最常见的写法错误
    expect(toMillis(0)).toBe(0);
  });

  it('空值与非法输入一律返回 null', () => {
    for (const value of ['', '   ', null, undefined, 'abc', {}, []]) {
      expect(toMillis(value), `输入 ${JSON.stringify(value)} 应返回 null`).toBeNull();
    }
  });

  it('NaN / Infinity 返回 null（不能当作有效数字透传）', () => {
    expect(toMillis(Number.NaN)).toBeNull();
    expect(toMillis(Infinity)).toBeNull();
  });
});

describe('toIsoString：把「ISO 字符串 或 毫秒数」统一格式化成 ISO', () => {
  it('毫秒转成 ISO 字符串', () => {
    expect(toIsoString(MS)).toBe(ISO);
  });

  it('已经是 ISO 字符串时幂等（支持「读取时兼容两种格式」）', () => {
    expect(toIsoString(ISO)).toBe(ISO);
  });

  it('往返一致', () => {
    expect(toMillis(toIsoString(MS))).toBe(MS);
    expect(toIsoString(toMillis(ISO))).toBe(ISO);
  });

  it('⚠️ 解析失败返回空串，而不是抛错、也不是硬凑一个值', () => {
    // 返回空串会被 validateStudyPlan 明确拦下（显式丢弃）；
    // 若返回一个看着像日期的错误值，计划会通过校验、排序却静默错乱
    expect(toIsoString('not-a-date')).toBe('');
    expect(toIsoString(undefined)).toBe('');
    expect(toIsoString(Number.NaN)).toBe('');
  });
});

describe('换算结果必须能被校验器接受（形态守卫）', () => {
  it('毫秒经 toIsoString 后，计划通过 validateStudyPlan', () => {
    const plan = legacyPlan({ createdAt: toIsoString(MS) });

    expect(validateStudyPlan(plan).valid).toBe(true);
  });

  it('换算失败产生的空串会被明确拦下，而不是混进排序', () => {
    const plan = legacyPlan({ createdAt: toIsoString('bad') });

    const result = validateStudyPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('创建时间不合法');
  });

  it('createdAt 不只是「非空」，还必须可解析', () => {
    // 计划列表按 createdAt 排序，不可解析的值会静默错序
    expect(validateStudyPlan(legacyPlan({ createdAt: 'abc' })).valid).toBe(false);
    expect(validateStudyPlan(legacyPlan({ createdAt: '2026-09-12' })).valid).toBe(true);
  });
});

describe('normalizeStudyNote：云端 null 不能直接透传给前端校验', () => {
  it('null / undefined 归一成空串', () => {
    expect(normalizeStudyNote(null)).toBe('');
    expect(normalizeStudyNote(undefined)).toBe('');
  });

  it('字符串原样返回（含空串）', () => {
    expect(normalizeStudyNote('背了 50 个词')).toBe('背了 50 个词');
    expect(normalizeStudyNote('')).toBe('');
  });

  it('其它类型转字符串，而不是丢弃记录', () => {
    expect(normalizeStudyNote(3)).toBe('3');
    expect(normalizeStudyNote(false)).toBe('false');
  });

  it('⚠️ 不归一化的话整条打卡会被判非法（这就是必须归一化的原因）', () => {
    const raw = { ...legacyCheckin(), note: null } as unknown as StudyCheckin;
    expect(validateStudyCheckin(raw).valid).toBe(false);

    const normalized = { ...raw, note: normalizeStudyNote(raw.note) };
    expect(validateStudyCheckin(normalized).valid).toBe(true);
  });
});

describe('老数据兼容（升级不丢历史记录）', () => {
  it('老形态的计划与打卡能通过校验', () => {
    expect(validateStudyPlan(legacyPlan()).valid).toBe(true);
    expect(validateStudyCheckin(legacyCheckin()).valid).toBe(true);
  });

  it('经 Repository 存取后老记录仍然存在', () => {
    const storage = new InMemoryStorageAdapter();
    const planRepo = new StudyPlanRepository(storage);
    const checkinRepo = new StudyCheckinRepository(storage);

    planRepo.saveAll([legacyPlan()]);
    checkinRepo.saveByDate('2026-09-12', [legacyCheckin()]);

    expect(planRepo.getAll()).toHaveLength(1);
    expect(checkinRepo.getByDate('2026-09-12')).toHaveLength(1);
  });

  it('混合新老记录时全部保留', () => {
    const storage = new InMemoryStorageAdapter();
    const planRepo = new StudyPlanRepository(storage);

    planRepo.saveAll([
      legacyPlan({ id: 'study-legacy' }),
      legacyPlan({ id: 'study-new', createdAt: toIsoString(Date.now()) }),
    ]);

    expect(planRepo.getAll().map((plan) => plan.id).sort()).toEqual([
      'study-legacy',
      'study-new',
    ]);
  });
});

describe('排序守卫：换算后的 ISO 仍保持时间序', () => {
  it('localeCompare 降序 == 时间降序（listPlans 依赖这一点）', () => {
    const early = toIsoString(Date.parse('2026-09-01T00:00:00.000Z'));
    const late = toIsoString(Date.parse('2026-09-10T00:00:00.000Z'));

    expect([early, late].sort((a, b) => b.localeCompare(a))).toEqual([late, early]);
  });

  it('同频率计划按创建时间从新到旧排列', () => {
    const storage = new InMemoryStorageAdapter();
    const service = new StudyService(
      new StudyPlanRepository(storage),
      new StudyCheckinRepository(storage),
    );
    const planRepo = new StudyPlanRepository(storage);

    planRepo.saveAll([
      legacyPlan({ id: 'old', createdAt: toIsoString(Date.parse('2026-09-01T00:00:00.000Z')) }),
      legacyPlan({ id: 'new', createdAt: toIsoString(Date.parse('2026-09-10T00:00:00.000Z')) }),
    ]);

    expect(service.listPlans().map((plan) => plan.id)).toEqual(['new', 'old']);
  });
});
