import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  pullStudyPlans: vi.fn(),
  pullStudyCheckins: vi.fn(),
  flush: vi.fn(),
  markDirty: vi.fn(),
  pendingCount: vi.fn(),
}));

/**
 * 只替换同步服务的取用入口，其余（各 service 工厂）保持真实 ——
 * store 的本地路径必须跑真代码，否则测不出「本地优先」。
 */
vi.mock('@/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services')>();
  return {
    ...actual,
    getCheckinSyncService: () => ({
      pullStudyPlans: mocks.pullStudyPlans,
      pullStudyCheckins: mocks.pullStudyCheckins,
      flush: mocks.flush,
      markDirty: mocks.markDirty,
      pendingCount: mocks.pendingCount,
    }),
  };
});

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { getStorageAdapter, setStorageAdapter } from '@/storage';
import { useAuthStore } from '@/stores/auth';
import { useStudyStore } from '@/stores/study';
import { StudyPlanRepository } from '@/repositories/StudyPlanRepository';
import { StudyCheckinRepository } from '@/repositories/StudyCheckinRepository';
import type { StudyCheckin, StudyPlan } from '@/types/models';

const DATE = '2026-09-12';
const NEXT_DATE = '2026-09-13';
const TOKEN_KEY = 'uni_id_token';

function plan(overrides: Partial<StudyPlan> = {}): StudyPlan {
  return {
    id: 'study-1',
    title: '每天背单词',
    subject: '英语',
    frequency: 'daily',
    targetTimes: 1,
    createdAt: '2026-09-12T03:20:00.000Z',
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

/** 云端地址栏：stub 全局 uni，token 决定 isLoggedIn */
function stubUni(token: string): void {
  (globalThis as any).uni = {
    getStorageSync: (key: string) => (key === TOKEN_KEY ? token : ''),
    setStorageSync: () => {},
    removeStorageSync: () => {},
  };
}

/** 模拟「已加入家庭」 */
function joinFamily(familyId = 'f-1'): void {
  useAuthStore().familyId = familyId;
}

function seedPlans(items: StudyPlan[]): void {
  new StudyPlanRepository(getStorageAdapter()).saveAll(items);
}

function seedCheckins(date: string, items: StudyCheckin[]): void {
  new StudyCheckinRepository(getStorageAdapter()).saveByDate(date, items);
}

beforeEach(() => {
  setStorageAdapter(new InMemoryStorageAdapter());
  setActivePinia(createPinia());
  stubUni('');
  for (const fn of Object.values(mocks)) {
    fn.mockReset();
  }
  mocks.pullStudyPlans.mockResolvedValue(undefined);
  mocks.pullStudyCheckins.mockResolvedValue(undefined);
  mocks.flush.mockResolvedValue({ attempted: 0, succeeded: 0, failed: 0, dropped: 0 });
});

describe('load：本地优先（同步阶段就有画面）', () => {
  it('未登录时只读本地，不触发云拉取', () => {
    seedPlans([plan()]);
    seedCheckins(DATE, [checkin()]);
    const store = useStudyStore();

    store.load(DATE);

    // 不等云端就已经有画面（秒开）
    expect(store.plans).toHaveLength(1);
    expect(store.checkins).toHaveLength(1);
    expect(store.loadedDate).toBe(DATE);
    expect(mocks.pullStudyPlans).not.toHaveBeenCalled();
    expect(mocks.pullStudyCheckins).not.toHaveBeenCalled();
  });

  it('已登录且有家庭时后台拉取**两条通路**（计划全量 + 打卡按日期）', async () => {
    stubUni('token-abc');
    joinFamily();
    const store = useStudyStore();

    store.load(DATE);

    await vi.waitFor(() => {
      expect(mocks.pullStudyPlans).toHaveBeenCalledTimes(1);
    });
    // 计划是全量拉取：**不带 date 参数**（学习与饮食/运动的关键差异）
    expect(mocks.pullStudyPlans).toHaveBeenCalledWith();
    expect(mocks.pullStudyCheckins).toHaveBeenCalledWith(DATE);
  });

  it('云端失败时保留本地缓存，不把页面打空', async () => {
    stubUni('token-abc');
    joinFamily();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.pullStudyPlans.mockRejectedValue(new Error('网络不可达'));
    seedPlans([plan()]);
    const store = useStudyStore();

    store.load(DATE);

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
    expect(store.plans).toHaveLength(1);
    expect(store.syncing).toBe(false);
  });
});

describe('写入：本地即刻生效 + 登记待同步', () => {
  it('addPlan：本地立即可见，并登记 studyPlan/add', () => {
    const store = useStudyStore();

    const created = store.addPlan({
      title: '每天背单词',
      subject: '英语',
      frequency: 'daily',
      targetTimes: 1,
    });

    expect(store.plans.map((item) => item.id)).toEqual([created.id]);
    // 计划不分日期，标记里的 date 传空串
    expect(mocks.markDirty).toHaveBeenCalledWith('studyPlan', 'add', {
      id: created.id,
      date: '',
    });
  });

  it('updatePlan：登记 studyPlan/update', () => {
    seedPlans([plan()]);
    const store = useStudyStore();
    store.loadPlans();

    store.updatePlan('study-1', { targetTimes: 3 });

    expect(mocks.markDirty).toHaveBeenCalledWith('studyPlan', 'update', {
      id: 'study-1',
      date: '',
    });
  });

  it('removePlan：登记 studyPlan/remove', () => {
    seedPlans([plan()]);
    const store = useStudyStore();
    store.loadPlans();

    store.removePlan('study-1');

    expect(mocks.markDirty).toHaveBeenCalledWith('studyPlan', 'remove', {
      id: 'study-1',
      date: '',
    });
  });

  it('⚠️ removePlan 级联后本地打卡列表同步刷新（不留已失效的打卡状态）', () => {
    seedPlans([plan()]);
    seedCheckins(DATE, [checkin()]);
    const store = useStudyStore();
    store.load(DATE);
    expect(store.hasChecked('study-1')).toBe(true);

    store.removePlan('study-1');

    expect(store.plans).toHaveLength(0);
    expect(store.checkins).toHaveLength(0);
    expect(store.hasChecked('study-1')).toBe(false);
  });

  it('checkin：本地立即标记为已打卡，并登记 studyCheckin/add', () => {
    seedPlans([plan()]);
    const store = useStudyStore();
    store.load(DATE);

    const created = store.checkin(DATE, { planId: 'study-1', note: '' });

    expect(store.hasChecked('study-1')).toBe(true);
    expect(mocks.markDirty).toHaveBeenCalledWith('studyCheckin', 'add', {
      id: created.id,
      date: DATE,
    });
  });

  it('removeCheckin：登记 studyCheckin/remove', () => {
    seedPlans([plan()]);
    seedCheckins(DATE, [checkin()]);
    const store = useStudyStore();
    store.load(DATE);

    store.removeCheckin(DATE, 'checkin-1');

    expect(store.hasChecked('study-1')).toBe(false);
    expect(mocks.markDirty).toHaveBeenCalledWith('studyCheckin', 'remove', {
      id: 'checkin-1',
      date: DATE,
    });
  });

  it('计划与打卡用两个 domain 分别登记（互不干扰）', () => {
    seedPlans([plan()]);
    const store = useStudyStore();
    store.load(DATE);

    store.addPlan({ title: '读书', subject: '语文', frequency: 'weekly', targetTimes: 2 });
    store.checkin(DATE, { planId: 'study-1', note: '' });

    const domains = mocks.markDirty.mock.calls.map((call) => call[0]).sort();
    expect(domains).toEqual(['studyCheckin', 'studyPlan']);
  });

  it('⚠️ markDirty 无条件：未登录时本地写入仍要留下痕迹', () => {
    // 若这里也被前置条件挡住，用户「先打卡、后加入家庭」的记录会永远不上云
    const store = useStudyStore();

    store.addPlan({ title: '读书', subject: '语文', frequency: 'daily', targetTimes: 1 });

    expect(mocks.markDirty).toHaveBeenCalled();
  });
});

describe('云端合并回写', () => {
  it('pull 写入仓储后 store 重新读取，合并结果可见', async () => {
    stubUni('token-abc');
    joinFamily();
    const planRepo = new StudyPlanRepository(getStorageAdapter());
    const checkinRepo = new StudyCheckinRepository(getStorageAdapter());
    // 模拟同步服务的行为：pull 把合并结果写回本地仓储
    mocks.pullStudyPlans.mockImplementation(async () => {
      planRepo.saveAll([plan({ id: 'cloud-1', title: '云端计划' })]);
    });
    mocks.pullStudyCheckins.mockImplementation(async (date: string) => {
      checkinRepo.saveByDate(date, [checkin({ id: 'cloud-c1', planId: 'cloud-1', date })]);
    });

    const store = useStudyStore();
    store.load(DATE);

    await vi.waitFor(() => {
      expect(store.plans.map((item) => item.id)).toEqual(['cloud-1']);
    });
    expect(store.checkins.map((item) => item.id)).toEqual(['cloud-c1']);
  });

  it('云端响应回来时用户已切到别的日期：不覆盖当前打卡列表', async () => {
    stubUni('token-abc');
    joinFamily();
    seedCheckins(NEXT_DATE, [checkin({ id: 'next-1', date: NEXT_DATE })]);
    mocks.pullStudyCheckins.mockResolvedValue(undefined);

    const store = useStudyStore();
    store.load(DATE);
    // 模拟请求还没回来，用户切到了次日
    store.loadCheckins(NEXT_DATE);

    await vi.waitFor(() => {
      expect(store.loadedDate).toBe(NEXT_DATE);
    });
    expect(store.checkins.map((item) => item.id)).toEqual(['next-1']);
  });
});
