import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Transaction } from '@/types/models';
import {
  fromCloudTransaction,
  mapCloudTransactions,
  toCloudTransaction,
} from '@/utils/cloudMap';
import { validateTransaction } from '@/utils/validation';
import { createLedgerRemoteRepo } from '@/repositories/remote/LedgerRemoteRepo';

const require = createRequire(import.meta.url);
const ledgerLib = require('../uniCloud-alipay/cloudfunctions/ledger/lib');

const DATE = '2026-09-14';

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-1',
    type: 'expense',
    amount: 25.5,
    category: '餐饮',
    date: DATE,
    memberId: 'member-1',
    note: '午饭',
    ...overrides,
  };
}

describe('上行：前端收支记录 → `ledger` 云函数入参', () => {
  it('id 映射为 clientId，且**不上行** createdAt / updatedAt', () => {
    const payload = toCloudTransaction(txn());

    expect(payload).toEqual({
      clientId: 'txn-1',
      date: DATE,
      type: 'expense',
      amount: 25.5,
      category: '餐饮',
      memberId: 'member-1',
      note: '午饭',
    });
    // 时间戳由服务端 Date.now() 决定：上行会被客户端时钟偏差污染
    expect('createdAt' in payload).toBe(false);
    expect('updatedAt' in payload).toBe(false);
  });

  it('⚠️ memberId 缺省 / 空串一律上行为 null（**绝不落空串**）', () => {
    // 空串会让前端 optionalIdError 判非法 → 整条记录被 LedgerRepository 静默丢弃；
    // 而 `undefined` 会被 JSON 序列化丢掉、表达不出「用户清空了这个字段」
    for (const memberId of [undefined, '', null as unknown as undefined]) {
      const payload = toCloudTransaction(txn({ memberId }));

      expect(payload.memberId, `memberId=${String(memberId)} 应上行为 null`).toBeNull();
    }
  });

  it('可空文本（note / category）缺省 → 空串（绝不落 null）', () => {
    const payload = toCloudTransaction(
      txn({ note: undefined as unknown as string, category: undefined as unknown as string }),
    );

    expect(payload.note).toBe('');
    expect(payload.category).toBe('');
  });

  it('amount 非有限数时收敛成 0（让云端**报错**，而不是静默塞一个貌似合法的值）', () => {
    for (const amount of [Number.NaN, Infinity, -Infinity, undefined as unknown as number]) {
      expect(
        toCloudTransaction(txn({ amount })).amount,
        `amount=${String(amount)} 应收敛成 0`,
      ).toBe(0);
    }
    // 0 会被云端 validateTransactionPayload 明确拒掉（合法区间从 0.01 起）
    expect(ledgerLib.validateTransactionPayload(toCloudTransaction(txn({ amount: Number.NaN }))).ok).toBe(
      false,
    );
  });

  it('amount 是合法自由小数时原样上行（不四舍五入）', () => {
    expect(toCloudTransaction(txn({ amount: 12.345 })).amount).toBe(12.345);
    expect(toCloudTransaction(txn({ amount: 0.01 })).amount).toBe(0.01);
  });

  it('type 原样透传（本机校验器已保证取值合法）', () => {
    expect(toCloudTransaction(txn({ type: 'income' })).type).toBe('income');
    expect(toCloudTransaction(txn({ type: 'expense' })).type).toBe('expense');
  });
});

describe('下行：`ledger` 云函数记录 → 前端收支模型', () => {
  it('云端 null 的可空文本归一成空串', () => {
    const back = fromCloudTransaction({ clientId: 'txn-1', note: null, category: '餐饮' });

    expect(back.note).toBe('');
    expect(back.category).toBe('餐饮');
  });

  it('⚠️ memberId 为 null / 空串一律落 undefined（空串会被前端判非法）', () => {
    for (const memberId of [null, '', undefined]) {
      const back = fromCloudTransaction({ clientId: 'txn-1', memberId });

      expect(back.memberId, `memberId=${String(memberId)} 应落 undefined`).toBeUndefined();
    }
    expect(fromCloudTransaction({ clientId: 't', memberId: 'member-2' }).memberId).toBe('member-2');
  });

  it('非法 type 兜底 expense（不整条丢弃，且方向与云端一致）', () => {
    for (const type of ['transfer', '', null, 1]) {
      expect(
        fromCloudTransaction({ clientId: 't', type }).type,
        `type=${String(type)} 应兜底为 expense`,
      ).toBe('expense');
    }
    // 与云端 toClientTransaction 的兜底方向必须一致，否则两端对同一条脏数据
    // 会得出不同的月汇总
    expect(ledgerLib.toClientTransaction({ clientId: 't', type: 'transfer' }).type).toBe(
      ledgerLib.TRANSACTION_FALLBACK_TYPE,
    );
    expect(ledgerLib.TRANSACTION_FALLBACK_TYPE).toBe('expense');
  });

  it('兼容裸库文档（clientId / _id 均可作 id）', () => {
    expect(fromCloudTransaction({ _id: 'db-1' }).id).toBe('db-1');
    expect(fromCloudTransaction({ clientId: 'c-1', _id: 'db-1' }).id).toBe('c-1');
  });

  it('⚠️ 金额脏值时落 0（映射层不凭空造钱），交给 mapRows 显性丢弃', () => {
    for (const amount of [null, '', 'abc', Number.NaN, undefined]) {
      expect(
        Number.isFinite(fromCloudTransaction({ clientId: 't', amount }).amount),
        `amount=${String(amount)} 应是有限数`,
      ).toBe(true);
    }

    // 0 不在合法区间（≥ 0.01），所以脏行会被列表映射丢弃并打 warn ——
    // 这比「凭空凑一笔 0.01 元的支出」更诚实：金额是钱，不能造
    const mapped = fromCloudTransaction({ clientId: 't', amount: 'abc', category: '餐饮', date: DATE });
    expect(mapped.amount).toBe(0);
    expect(validateTransaction(mapped).valid).toBe(false);
  });
});

describe('列表映射（逐行校验 + 丢弃非法行）', () => {
  it('非数组入参返回空数组', () => {
    for (const value of [null, undefined, {}, 'x', 1]) {
      expect(mapCloudTransactions(value)).toEqual([]);
    }
  });

  it('保留合法行、丢弃非法行（缺分类 / 日期非法 / 金额越界 / 非对象）', () => {
    const rows = [
      { clientId: 'ok', date: DATE, type: 'expense', amount: 10, category: '餐饮', note: '' },
      { clientId: 'bad-no-category', date: DATE, type: 'expense', amount: 10, note: '' },
      { clientId: 'bad-date', date: '2026/09/14', type: 'expense', amount: 10, category: '餐饮' },
      { clientId: 'bad-amount', date: DATE, type: 'expense', amount: 0, category: '餐饮' },
      { clientId: 'bad-type-null-id', date: DATE, amount: 10, category: '餐饮' },
      null,
      'not-an-object',
    ];

    // bad-type-null-id 的 type 会被兜底成 expense，所以它是合法的 → 保留
    expect(mapCloudTransactions(rows).map((item) => item.id)).toEqual([
      'ok',
      'bad-type-null-id',
    ]);
  });
});

describe('往返一致性', () => {
  it('收支记录往返后字段一致（含 memberId）', () => {
    const original = txn();

    expect(fromCloudTransaction(toCloudTransaction(original))).toEqual(original);
  });

  it('无成员的记录往返后仍是「无成员」（不漂成空串）', () => {
    const original = txn({ memberId: undefined });

    const back = fromCloudTransaction(toCloudTransaction(original));

    expect(back.memberId).toBeUndefined();
    expect(back).toEqual(original);
  });

  it('空备注往返后仍为空串（不会漂成 null）', () => {
    const original = txn({ note: '', memberId: undefined });

    expect(fromCloudTransaction(toCloudTransaction(original))).toEqual(original);
  });
});

describe('与云函数的契约（两层串联守卫）', () => {
  it('前端上行 → 云函数 validateTransactionPayload 接受', () => {
    // 这条守的是「映射层的字段名 / 类型」与「云端入参契约」一致：
    // 任何一边改名或改类型，这里立刻失败，而不是等到真机上 400
    for (const entry of [txn(), txn({ type: 'income' }), txn({ memberId: undefined }), txn({ note: '' })]) {
      const checked = ledgerLib.validateTransactionPayload(toCloudTransaction(entry));

      expect(checked.ok, JSON.stringify(toCloudTransaction(entry))).toBe(true);
    }
  });

  it('云函数 toClientTransaction → 前端 fromCloudTransaction → 通过前端校验', () => {
    const clientShape = ledgerLib.toClientTransaction({
      _id: 'db-1',
      clientId: 'txn-1',
      date: DATE,
      type: 'transfer', // 脏数据
      amount: 0, // 越界，云端兜底到边界值
      category: '餐饮',
      memberId: null,
      note: null,
    });

    expect(validateTransaction(fromCloudTransaction(clientShape))).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('⚠️ 云端口径与前端校验器一致：memberId 落空串会被前端判非法', () => {
    // 反面验证：说明为什么映射层必须把空串收敛成 undefined，而不是「多此一举」
    const withEmptyId = {
      id: 'txn-1',
      date: DATE,
      type: 'expense',
      amount: 10,
      category: '餐饮',
      memberId: '',
      note: '',
    };

    expect(validateTransaction(withEmptyId).valid).toBe(false);
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

  it('listRange / create / update / remove 各自打对云函数与 action', async () => {
    const remote = createLedgerRemoteRepo();

    await remote.listRange('2026-09-01', '2026-09-30');
    expect(calls.at(-1)).toMatchObject({ name: 'ledger', action: 'list' });
    expect(calls.at(-1)?.data).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });

    await remote.create(txn());
    expect(calls.at(-1)).toMatchObject({ name: 'ledger', action: 'add' });
    expect(calls.at(-1)?.data).toMatchObject({ clientId: 'txn-1' });

    await remote.update(txn());
    expect(calls.at(-1)).toMatchObject({ name: 'ledger', action: 'update' });

    await remote.remove('txn-1', DATE);
    expect(calls.at(-1)).toMatchObject({ name: 'ledger', action: 'remove' });
    expect(calls.at(-1)?.data).toMatchObject({ clientId: 'txn-1', date: DATE });
  });

  it('⚠️ listRange 的区间两端都必须传（缺一端云端会 400）', async () => {
    await createLedgerRemoteRepo().listRange('2026-09-01', '2026-09-30');

    const data = calls.at(-1)?.data ?? {};
    expect(data.from).toBe('2026-09-01');
    expect(data.to).toBe('2026-09-30');
    // 用真实的云端校验器确认这一对入参是合法的（两端齐全）
    expect(ledgerLib.validateTransactionQuery(data).ok).toBe(true);
  });

  it('remove 不带 date 时不塞空字段（云端会退回用记录自身的日期）', async () => {
    await createLedgerRemoteRepo().remove('txn-1');

    expect(calls.at(-1)?.data).not.toHaveProperty('date');
  });
});
