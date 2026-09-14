import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { LEDGER_LIMITS } from '@/utils/limits';
import { validateTransaction } from '@/utils/validation';

// 云函数 lib.js 为 CommonJS 纯逻辑模块，用 createRequire 加载（避免无类型声明的 TS 报错）
const require = createRequire(import.meta.url);
const ledgerLib = require('../uniCloud-alipay/cloudfunctions/ledger/lib');

const DATE = '2026-09-14';

/** 合法的收支记录入参 */
function txnInput(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'txn-1',
    date: DATE,
    type: 'expense',
    amount: 25.5,
    category: '餐饮',
    memberId: 'member-1',
    note: '午饭',
    ...overrides,
  };
}

describe('ledgerLib.validateTransactionPayload', () => {
  it('接受合法入参并归一化（trim 文本、金额收敛成数字）', () => {
    const result = ledgerLib.validateTransactionPayload(
      txnInput({ category: '  餐饮  ', note: '  午饭  ', amount: '25.5' }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        clientId: 'txn-1',
        date: DATE,
        type: 'expense',
        amount: 25.5,
        category: '餐饮',
        memberId: 'member-1',
        note: '午饭',
      },
    });
  });

  it('缺 clientId / 日期格式非法 / 类型非法 / 分类为空时拒绝', () => {
    expect(ledgerLib.validateTransactionPayload(txnInput({ clientId: '' })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ date: '2026/09/14' })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ date: '' })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ type: 'transfer' })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ type: undefined })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ category: '   ' })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ category: undefined })).ok).toBe(false);
  });

  it('收支类型只接受 income / expense', () => {
    expect(ledgerLib.validateTransactionPayload(txnInput({ type: 'income' })).ok).toBe(true);
    expect(ledgerLib.validateTransactionPayload(txnInput({ type: 'expense' })).ok).toBe(true);

    for (const type of ['Transfer', 'INCOME', '', null, 1]) {
      expect(
        ledgerLib.validateTransactionPayload(txnInput({ type })).ok,
        `type=${String(type)} 应被拒绝`,
      ).toBe(false);
    }

    expect(ledgerLib.TRANSACTION_TYPES).toEqual(['income', 'expense']);
  });

  it('⚠️ 金额边界与前端 numberError(0.01, 100000000) 逐项一致', () => {
    expect(ledgerLib.validateTransactionPayload(txnInput({ amount: 0.01 })).ok).toBe(true);
    expect(ledgerLib.validateTransactionPayload(txnInput({ amount: 100000000 })).ok).toBe(true);

    // 恰好越界一格必须拒绝 —— 否则本地能存、云端拒收 → 重试 5 次后静默丢弃
    expect(ledgerLib.validateTransactionPayload(txnInput({ amount: 0 })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ amount: 0.009 })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ amount: 100000001 })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ amount: -1 })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ amount: Number.NaN })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ amount: Infinity })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ amount: 'abc' })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ amount: null })).ok).toBe(false);

    expect(ledgerLib.AMOUNT_MIN).toBe(0.01);
    expect(ledgerLib.AMOUNT_MAX).toBe(100000000);
  });

  it('金额不做四舍五入（自由小数原样落库）', () => {
    expect(ledgerLib.validateTransactionPayload(txnInput({ amount: 12.345 })).value.amount).toBe(
      12.345,
    );
    expect(ledgerLib.validateTransactionPayload(txnInput({ amount: 25.5 })).value.amount).toBe(25.5);
  });

  it('⚠️ 分类刻意不做白名单枚举（历史分类可能不在当前常量表内）', () => {
    // 用户改过 EXPENSE_CATEGORIES / INCOME_CATEGORIES 之后，历史记录里会留下
    // 表外的分类。若云端加白名单，这些记录会在「老数据导入」时**全部失败**。
    for (const category of ['餐饮', '交通', '宠物', '自定义分类', 'abc', '1']) {
      expect(
        ledgerLib.validateTransactionPayload(txnInput({ category })).ok,
        `分类 ${category} 应被接受`,
      ).toBe(true);
    }

    // 但「非空 + 上限」仍要守住
    expect(
      ledgerLib.validateTransactionPayload(txnInput({ category: 'a'.repeat(ledgerLib.CATEGORY_MAX + 1) }))
        .ok,
    ).toBe(false);
    expect(
      ledgerLib.validateTransactionPayload(txnInput({ category: 'a'.repeat(ledgerLib.CATEGORY_MAX) })).ok,
    ).toBe(true);
  });

  it('⚠️ 备注缺省 / null / 空串一律归一为**空串**而不是 null', () => {
    // 落 null 会让前端 validateTransaction（要求 typeof note === 'string'）
    // 判非法，整条记录被 LedgerRepository 静默丢弃 —— 最容易埋雷的一处
    const result = ledgerLib.validateTransactionPayload(
      txnInput({ note: undefined, category: '餐饮' }),
    );

    expect(result.ok).toBe(true);
    expect(result.value.note).toBe('');

    for (const note of [null, '', '   ']) {
      expect(ledgerLib.validateTransactionPayload(txnInput({ note })).value.note).toBe('');
    }
  });

  it('备注非字符串时拒绝，超长时拒绝（100 字）', () => {
    expect(ledgerLib.validateTransactionPayload(txnInput({ note: 123 })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ note: true })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ note: {} })).ok).toBe(false);

    expect(
      ledgerLib.validateTransactionPayload(txnInput({ note: 'a'.repeat(ledgerLib.NOTE_MAX + 1) })).ok,
    ).toBe(false);
    expect(
      ledgerLib.validateTransactionPayload(txnInput({ note: 'a'.repeat(ledgerLib.NOTE_MAX) })).ok,
    ).toBe(true);
  });

  it('⚠️ memberId 是 id 型可选字段，缺省落 null（不适用「可空文本落空串」规则）', () => {
    // 前端 optionalIdError 对 undefined / null 都判合法，但**空串会被判为「记账成员不合法」**
    for (const memberId of [undefined, null, '']) {
      const result = ledgerLib.validateTransactionPayload(txnInput({ memberId }));
      expect(result.ok).toBe(true);
      expect(result.value.memberId, `memberId=${String(memberId)} 应落 null`).toBeNull();
    }

    expect(ledgerLib.validateTransactionPayload(txnInput({ memberId: 'member-2' })).value.memberId).toBe(
      'member-2',
    );
    // 非字符串 / 超长一律拒绝
    expect(ledgerLib.validateTransactionPayload(txnInput({ memberId: 12 })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ memberId: {} })).ok).toBe(false);
    expect(
      ledgerLib.validateTransactionPayload(txnInput({ memberId: 'm'.repeat(ledgerLib.CLIENT_ID_MAX + 1) }))
        .ok,
    ).toBe(false);
  });

  it('clientId 非法字符 / 超长 / 带空白一律拒绝（与 diet / meal 同口径）', () => {
    expect(ledgerLib.validateTransactionPayload(txnInput({ clientId: 'txn-9' })).value.clientId).toBe(
      'txn-9',
    );
    expect(ledgerLib.validateTransactionPayload(txnInput({ clientId: 'txn 1' })).ok).toBe(false);
    expect(ledgerLib.validateTransactionPayload(txnInput({ clientId: '  txn-9  ' })).ok).toBe(false);
    expect(
      ledgerLib.validateTransactionPayload(txnInput({ clientId: 't'.repeat(ledgerLib.CLIENT_ID_MAX + 1) }))
        .ok,
    ).toBe(false);
    expect(ledgerLib.CLIENT_ID_MAX).toBe(64);
  });
});

describe('ledgerLib.mergeTransactionPatch', () => {
  const existing = {
    clientId: 'txn-1',
    date: DATE,
    type: 'expense',
    amount: 25.5,
    category: '餐饮',
    memberId: 'member-1',
    note: '午饭',
  };

  it('只覆盖显式传入的字段', () => {
    const merged = ledgerLib.mergeTransactionPatch(existing, { amount: 30 });

    expect(merged.value).toEqual({ ...existing, amount: 30 });
  });

  it('合并结果可交给 validateTransactionPayload 复校', () => {
    const merged = ledgerLib.mergeTransactionPatch(existing, { note: '晚饭' });

    expect(ledgerLib.validateTransactionPayload(merged.value)).toEqual({
      ok: true,
      value: { ...existing, note: '晚饭' },
    });
  });

  it('复校能发现「改坏了」的 patch（把金额改成 0）', () => {
    const merged = ledgerLib.mergeTransactionPatch(existing, { amount: 0 });

    expect(ledgerLib.validateTransactionPayload(merged.value).ok).toBe(false);
  });

  it('复校能发现「改坏了」的 patch（把类型改成非法值）', () => {
    const merged = ledgerLib.mergeTransactionPatch(existing, { type: 'transfer' });

    expect(ledgerLib.validateTransactionPayload(merged.value).ok).toBe(false);
  });

  it('patch 把备注清空 / 把成员清空时，复校后落空串与 null（清空是合法操作）', () => {
    const merged = ledgerLib.mergeTransactionPatch(existing, { note: '', memberId: '' });
    const checked = ledgerLib.validateTransactionPayload(merged.value);

    expect(checked.ok).toBe(true);
    expect(checked.value.note).toBe('');
    expect(checked.value.memberId).toBeNull();
  });

  it('⚠️ clientId 与 date 不随 patch 改变', () => {
    const merged = ledgerLib.mergeTransactionPatch(existing, {
      clientId: 'hacked',
      date: '2020-01-01',
    });

    expect(merged.value.clientId).toBe('txn-1');
    // 改了日期会让记录在旧日期区间的拉取通路里凭空消失（本地服务也不支持跨日期移动）
    expect(merged.value.date).toBe(DATE);
  });

  it('patch 显式传 undefined 时不覆盖（与「没传」同义）', () => {
    const merged = ledgerLib.mergeTransactionPatch(existing, { note: undefined, amount: undefined });

    expect(merged.value.note).toBe('午饭');
    expect(merged.value.amount).toBe(25.5);
  });
});

describe('ledgerLib.validateTransactionQuery（只支持日期区间，两端必填）', () => {
  it('接受合法区间', () => {
    expect(ledgerLib.validateTransactionQuery({ from: '2026-09-01', to: '2026-09-30' })).toEqual({
      ok: true,
      value: { from: '2026-09-01', to: '2026-09-30' },
    });
    // 单日区间（from === to）也合法：页面允许只看某一天的明细
    expect(ledgerLib.validateTransactionQuery({ from: DATE, to: DATE }).ok).toBe(true);
  });

  it('⚠️ from / to 缺任意一端都拒绝，且报「缺区间」而不是含糊的日期格式错误', () => {
    const queries = [
      {},
      { from: '2026-09-01' },
      { to: '2026-09-30' },
      { from: '', to: '2026-09-30' },
      { from: '2026-09-01', to: '  ' },
    ];

    for (const query of queries) {
      const result = ledgerLib.validateTransactionQuery(query);

      expect(result.ok, `${JSON.stringify(query)} 应被拒绝`).toBe(false);
      // 必须报「缺区间」而不是「结束日期格式应为 YYYY-MM-DD」：
      // 后者会把「调用方忘了传区间」误导成「日期写错了」，排查方向完全跑偏。
      // （单看 ok=true/false 是分不出这两种实现的 —— 日期校验也会拒掉缺的一端，
      //   所以这条断言是「两端必填」这个设计意图**唯一**的把关点。）
      expect(result.msg, JSON.stringify(query)).toContain('区间');
    }
  });

  it('日期格式非法 / 起始晚于结束都拒绝', () => {
    expect(ledgerLib.validateTransactionQuery({ from: '2026-9-1', to: '2026-09-30' }).ok).toBe(false);
    expect(ledgerLib.validateTransactionQuery({ from: '2026-09-01', to: '20260930' }).ok).toBe(false);
    // 起始晚于结束：会查出空集，静默表现为「这个月没有记录」
    expect(ledgerLib.validateTransactionQuery({ from: '2026-09-30', to: '2026-09-01' }).ok).toBe(false);
  });

  it('buildDateWhere 产出闭区间片段（gte(from) 且 lte(to)）', () => {
    const calls: Array<[string, string]> = [];
    const dbCmd = {
      gte: (value: string) => ({
        and: (other: { op: string; value: string }) => {
          calls.push([value, other.value]);
          return { op: 'range', value };
        },
      }),
      lte: (value: string) => ({ op: 'lte', value }),
    };

    const where = ledgerLib.buildDateWhere(dbCmd, { from: '2026-09-01', to: '2026-09-30' });

    expect(calls).toEqual([['2026-09-01', '2026-09-30']]);
    expect(where).toHaveProperty('date');
  });
});

describe('ledgerLib.toClientTransaction（云端记录 → 前端形态）', () => {
  it('输出能被前端 validateTransaction 接受', () => {
    const row = {
      _id: 'abc123',
      clientId: 'txn-1',
      date: DATE,
      type: 'expense',
      amount: 25.5,
      category: '餐饮',
      memberId: 'member-1',
      note: '午饭',
    };

    expect(validateTransaction(ledgerLib.toClientTransaction(row))).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('⚠️ 云端空文本落 null 时也能产出前端可接受的形态（note 落空串）', () => {
    const row = {
      clientId: 'txn-1',
      date: DATE,
      type: 'income',
      amount: 100,
      category: '工资',
      memberId: null,
      note: null, // 早期云端可能的落库形态
    };

    const mapped = ledgerLib.toClientTransaction(row);

    expect(mapped.note).toBe('');
    expect(mapped.memberId).toBeUndefined();
    expect(validateTransaction(mapped)).toEqual({ valid: true, errors: [] });
  });

  it('id 优先取 clientId，缺省回落到 _id', () => {
    expect(ledgerLib.toClientTransaction({ clientId: 'txn-1', _id: 'abc' }).id).toBe('txn-1');
    expect(ledgerLib.toClientTransaction({ _id: 'abc' }).id).toBe('abc');
    expect(ledgerLib.toClientTransaction({}).id).toBe('');
  });

  it('⚠️ 脏数据兜底：非法类型 → expense（不是 income），金额越界 → 边界值', () => {
    const mapped = ledgerLib.toClientTransaction({
      clientId: 'txn-x',
      type: 'transfer',
      amount: 0,
      category: '餐饮',
      date: DATE,
    });

    // 兜底成 expense 而不是列表首项 income：income 会让收入与结余凭空变大，
    // 把「数据坏了」伪装成「多了一笔收入」
    expect(mapped.type).toBe('expense');
    expect(ledgerLib.TRANSACTION_FALLBACK_TYPE).toBe('expense');
    expect(ledgerLib.TRANSACTION_TYPES[0]).toBe('income');
    expect(mapped.amount).toBe(ledgerLib.AMOUNT_MIN);
    // 兜底后仍是一条前端可接受的记录（而不是被仓储静默丢弃）
    expect(validateTransaction(mapped).valid).toBe(true);
  });

  it('金额为非数字脏类型时兜底到 AMOUNT_MIN，而不是产出 NaN', () => {
    for (const amount of ['abc', null, undefined, Number.NaN, Infinity, {}]) {
      const mapped = ledgerLib.toClientTransaction({ clientId: 'x', amount, category: '餐饮', date: DATE });

      expect(Number.isFinite(mapped.amount), `amount=${String(amount)} 应兜底为有限数`).toBe(true);
      expect(mapped.amount).toBe(ledgerLib.AMOUNT_MIN);
    }
  });

  it('缺字段不落 null，交给前端校验器明确拦下（不硬凑值）', () => {
    const mapped = ledgerLib.toClientTransaction({ clientId: 'x' });

    expect(mapped.date).toBe('');
    expect(mapped.category).toBe('');
    expect(mapped.note).toBe('');
    expect(mapped.memberId).toBeUndefined();
    expect(validateTransaction(mapped).valid).toBe(false);
  });
});

describe('ledgerLib 的长度上限被显式锁定', () => {
  it('数值与前端 LEDGER_LIMITS 一致（改动需同步两端与表单 maxlength）', () => {
    // ⚠️ 云端上限若比前端更严，本地合法记录会推不上去、重试 5 次后被丢弃。
    //    与 LEDGER_LIMITS 的逐项等价由 tests/ui-limits.test.ts 守卫，
    //    这里把数值本身钉死，防止无意改动时两边一起漂走。
    expect(ledgerLib.CATEGORY_MAX).toBe(20);
    expect(ledgerLib.NOTE_MAX).toBe(100);
    expect(ledgerLib.CLIENT_ID_MAX).toBe(64);
    expect(ledgerLib.NOTE_MAX).toBe(LEDGER_LIMITS.note);
    expect(ledgerLib.CATEGORY_MAX).toBe(LEDGER_LIMITS.category);
  });
});
