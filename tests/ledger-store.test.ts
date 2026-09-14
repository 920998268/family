import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  pullTransactions: vi.fn(),
  flush: vi.fn(),
  markDirty: vi.fn(),
  pendingCount: vi.fn(),
}));

/**
 * 只替换同步服务的取用入口，其余（service / repository 工厂）保持真实 ——
 * store 的本地路径与「本地优先」语义必须跑真代码。
 */
vi.mock('@/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services')>();
  return {
    ...actual,
    getCheckinSyncService: () => ({
      pullTransactions: mocks.pullTransactions,
      flush: mocks.flush,
      markDirty: mocks.markDirty,
      pendingCount: mocks.pendingCount,
    }),
  };
});

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { getStorageAdapter, setStorageAdapter } from '@/storage';
import { LedgerRepository } from '@/repositories/LedgerRepository';
import { useAuthStore } from '@/stores/auth';
import { useLedgerStore } from '@/stores/ledger';
import { monthRange } from '@/utils/date';
import type { Transaction } from '@/types/models';

const DATE = '2026-09-14';
const MONTH = '2026-09';
const NEXT_MONTH = '2026-10';
const TOKEN_KEY = 'uni_id_token';

function txn(id: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    type: 'expense',
    amount: 25.5,
    category: '餐饮',
    date: DATE,
    memberId: 'member-1',
    note: '午饭',
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

function ledgerRepo(): LedgerRepository {
  return new LedgerRepository(getStorageAdapter());
}

beforeEach(() => {
  setStorageAdapter(new InMemoryStorageAdapter());
  setActivePinia(createPinia());
  stubUni('token-test');
  // 默认就是「已登录 + 已加入家庭」的正常态；测前置条件的用例各自退出
  joinFamily('f-1');

  mocks.pullTransactions.mockReset().mockResolvedValue([]);
  mocks.flush.mockReset().mockResolvedValue({ attempted: 0, succeeded: 0, failed: 0, dropped: 0 });
  mocks.markDirty.mockReset();
  mocks.pendingCount.mockReset().mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * `monthRange` 是「按月拉取」的区间端点来源。它存在的唯一理由是：
 * 月末是 28/29/30/31 不确定，在页面里拼字符串迟早会拼错，
 * 而拼错的后果是**静默少拉几天**（月结余偏小、没有任何报错指向这里）。
 */
describe('monthRange：账本按月拉取的区间端点', () => {
  it('大小月各自算对月末', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2026-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(monthRange('2026-04')).toEqual({ from: '2026-04-01', to: '2026-04-30' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('二月：平年 28、闰年 29（`new Date(y, m, 0)` 自动正确）', () => {
    expect(monthRange('2026-02').to).toBe('2026-02-28');
    expect(monthRange('2024-02').to).toBe('2024-02-29');
    expect(monthRange('2000-02').to).toBe('2000-02-29');
    // 1900 不是闰年（能被 100 整除但不能被 400 整除）
    expect(monthRange('1900-02').to).toBe('1900-02-28');
  });

  it('区间两端都能被云端入参校验器接受（缺一端就是一次无界查询）', () => {
    const { from, to } = monthRange(MONTH);
    expect(from <= to).toBe(true);
    expect(from.startsWith(MONTH)).toBe(true);
    expect(to.startsWith(MONTH)).toBe(true);
  });

  it('格式非法一律抛错，不返回「看着正常但不对」的兜底区间', () => {
    for (const bad of ['', '2026', '2026-9', '2026-13', '2026-00', '2026/09', 'abcd-ef']) {
      expect(() => monthRange(bad), `${bad} 应抛错`).toThrow();
    }
  });
});

describe('账本 store：本地优先 + 按月拉取', () => {
  it('loadMonth 先用本地缓存立即渲染，云端结果回来后刷新', async () => {
    ledgerRepo().saveByDate(DATE, [txn('local-1', { note: '本地缓存' })]);
    mocks.pullTransactions.mockImplementation(async () => {
      const repo = ledgerRepo();
      repo.saveByDate(DATE, [txn('local-1', { note: '云端' }), txn('remote-1')]);
    });

    const store = useLedgerStore();
    store.loadMonth(MONTH);

    // 同步阶段就已经有画面，不等云端（秒开）
    expect(store.entries.map((entry) => entry.id)).toEqual(['local-1']);
    expect(store.entries[0].note).toBe('本地缓存');

    await vi.waitFor(() => {
      expect(store.entries.map((entry) => entry.id).sort()).toEqual(['local-1', 'remote-1']);
    });
    expect(store.entries.find((entry) => entry.id === 'local-1')?.note).toBe('云端');
  });

  /**
   * ⚠️ 这条是本模块的核心：账本是全项目唯一按**区间**拉取的域。
   * 只拉当天会让月汇总基于残缺数据算出明显偏小的数字，
   * 而界面上没有任何东西指向这里（用户只会觉得「账记错了」）。
   */
  it('⚠️ 云端调用拿到的是整月区间（不是单日、也不是无参）', async () => {
    const store = useLedgerStore();
    store.loadMonth(MONTH);

    await vi.waitFor(() => expect(mocks.pullTransactions).toHaveBeenCalled());
    expect(mocks.pullTransactions).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
  });

  it('只加载当前月份：别的月份的本地记录不进当前列表', () => {
    ledgerRepo().saveByDate(DATE, [txn('sep')]);
    ledgerRepo().saveByDate('2026-10-02', [txn('oct', { date: '2026-10-02' })]);

    const store = useLedgerStore();
    store.loadMonth(MONTH);

    expect(store.entries.map((entry) => entry.id)).toEqual(['sep']);
    expect(store.loadedMonth).toBe(MONTH);
  });

  it('云端失败时保留本地缓存，不把页面打空', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ledgerRepo().saveByDate(DATE, [txn('local-1')]);
    mocks.pullTransactions.mockRejectedValue(new Error('网络不可达'));

    const store = useLedgerStore();
    store.loadMonth(MONTH);

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(store.entries.map((entry) => entry.id)).toEqual(['local-1']);
    expect(store.syncing).toBe(false);
  });

  it('云端响应回来时用户已切到别的月份：不覆盖当前列表', async () => {
    ledgerRepo().saveByDate(DATE, [txn('sep')]);
    ledgerRepo().saveByDate('2026-10-02', [txn('oct', { date: '2026-10-02' })]);

    let releaseFirst: () => void = () => {};
    let calls = 0;
    mocks.pullTransactions.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        // 迟到的响应往 9 月写了一条
        ledgerRepo().saveByDate(DATE, [txn('sep'), txn('late')]);
      }
    });

    const store = useLedgerStore();
    store.loadMonth(MONTH);
    store.loadMonth(NEXT_MONTH);
    await vi.waitFor(() => expect(calls).toBe(2));

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.loadedMonth).toBe(NEXT_MONTH);
    expect(store.entries.map((entry) => entry.id)).toEqual(['oct']);
  });
});

describe('账本 store：云同步前置条件', () => {
  it('未登录时不发起云端拉取（本地照常显示）', async () => {
    stubUni('');
    ledgerRepo().saveByDate(DATE, [txn('local-1')]);

    const store = useLedgerStore();
    store.loadMonth(MONTH);
    await Promise.resolve();

    expect(mocks.pullTransactions).not.toHaveBeenCalled();
    expect(store.entries).toHaveLength(1);
  });

  it('已登录但未加入家庭时不发起云端拉取', async () => {
    joinFamily('');

    useLedgerStore().loadMonth(MONTH);
    await Promise.resolve();

    expect(mocks.pullTransactions).not.toHaveBeenCalled();
  });
});

describe('账本 store：写入登记待同步', () => {
  it('add / update / remove 各自登记 transaction 动作并触发重发', () => {
    const store = useLedgerStore();
    store.loadMonth(MONTH);

    const added = store.add(DATE, {
      type: 'expense',
      amount: 58.5,
      category: '餐饮',
      note: '买菜',
    });
    expect(store.entries.map((entry) => entry.id)).toEqual([added.id]);
    expect(mocks.markDirty).toHaveBeenCalledWith('transaction', 'add', {
      id: added.id,
      date: DATE,
    });
    expect(mocks.flush).toHaveBeenCalled();

    mocks.markDirty.mockClear();
    store.update(DATE, added.id, { amount: 60 });
    expect(store.entries[0].amount).toBe(60);
    expect(mocks.markDirty).toHaveBeenCalledWith('transaction', 'update', {
      id: added.id,
      date: DATE,
    });

    mocks.markDirty.mockClear();
    store.remove(DATE, added.id);
    expect(mocks.markDirty).toHaveBeenCalledWith('transaction', 'remove', {
      id: added.id,
      date: DATE,
    });
    expect(store.entries).toEqual([]);
  });

  it('未登录时登记标记但**不**触发重发（标记留着，等条件具备再推）', () => {
    stubUni('');
    const store = useLedgerStore();
    store.loadMonth(MONTH);

    const added = store.add(DATE, {
      type: 'expense',
      amount: 10,
      category: '餐饮',
      note: '',
    });

    // markDirty 无条件、flush 有前置条件 —— 写反了会让「先记账、后入家庭」的数据永不上云
    expect(mocks.markDirty).toHaveBeenCalledWith('transaction', 'add', {
      id: added.id,
      date: DATE,
    });
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(store.entries).toHaveLength(1);
  });

  it('按月加载时写入按日记录 → 该记录立刻出现在当前列表里', () => {
    const store = useLedgerStore();
    store.loadMonth(MONTH);

    const added = store.add(DATE, {
      type: 'income',
      amount: 300,
      category: '工资',
      note: '',
    });

    expect(store.entries.map((entry) => entry.id)).toEqual([added.id]);
  });

  it('loadAll 与 load(date) 仍各按自己的口径重读（编辑态按 id 查找依赖 loadAll）', () => {
    ledgerRepo().saveByDate(DATE, [txn('sep')]);
    ledgerRepo().saveByDate('2026-10-02', [txn('oct', { date: '2026-10-02' })]);

    const store = useLedgerStore();

    store.loadAll();
    expect(store.entries.map((entry) => entry.id).sort()).toEqual(['oct', 'sep']);
    expect(store.loadedMonth).toBeNull();

    store.load(DATE);
    expect(store.entries.map((entry) => entry.id)).toEqual(['sep']);
  });
});

describe('源码级守卫', () => {
  const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');

  it('账本页按月加载，且进入时补传待同步', () => {
    const source = read('src/pages/ledger/ledger.vue');

    // 只读本地的 loadAll 会让别的设备记的账永远不出现，而汇总卡是按月求和的
    expect(source).toContain('loadMonth(');
    expect(source).toContain('flushPendingCheckins');
    expect(source).toMatch(/onShow\(\(\) => \{[\s\S]{0,400}?flushPendingCheckins\(\)/);
  });

  it('⚠️ 编辑态日期只读（改日期会让保存 / 删除命中「找不到记录」）', () => {
    const source = read('src/pages/ledger/record.vue');

    expect(source, 'picker 缺少编辑态禁用').toMatch(/:disabled="editing"/);
    // 双保险：即使平台仍然回调了 change，也不能改写 date
    expect(source, 'onDateChange 未拦截编辑态').toMatch(
      /function onDateChange[\s\S]{0,200}?if \(editing\.value\) \{\s*return;/,
    );
  });

  it('⚠️ 备注挂上 maxlength（上限只在前端表单与云端，校验器里绝不能加）', () => {
    const source = read('src/pages/ledger/record.vue');
    expect(source).toContain(':maxlength="LEDGER_LIMITS.note"');
    expect(source).toContain("from '@/utils/limits'");
  });

  it('备份页有导入入口，且入口处做前置检查', () => {
    const source = read('src/pages/backup/backup.vue');

    expect(source).toContain('checkCloudImport');
    expect(source).toContain('runCloudImport');
    expect(source, '未做前置检查：未登录时会白跑几千条').toContain('cloudReady()');
  });

  it('store 不直接引用裸 uniCloud（云调用一律经服务层）', () => {
    for (const store of ['src/stores/ledger.ts', 'src/stores/backup.ts']) {
      const source = read(store);
      expect(/(^|[^.\w$])uniCloud\s*\./.test(source), `${store} 出现裸 uniCloud`).toBe(false);
    }
  });

  it('账本 store 走 checkinRuntime 的三件套，不各自散写前置条件', () => {
    const source = read('src/stores/ledger.ts');
    expect(source).toContain('isCheckinCloudReady');
    expect(source).toContain('markCheckinDirty');
    expect(source).toContain('flushPendingCheckins');
  });
});
