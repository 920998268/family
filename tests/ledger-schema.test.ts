import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { LEDGER_LIMITS } from '@/utils/limits';

// 云函数 lib.js 为 CommonJS 纯逻辑模块，用 createRequire 加载（避免无类型声明的 TS 报错）
const require = createRequire(import.meta.url);
const ledgerLib = require('../uniCloud-alipay/cloudfunctions/ledger/lib');

const ROOT = process.cwd();
const readText = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8');
const readJson = (relativePath: string) =>
  JSON.parse(readText(relativePath)) as {
    bsonType: string;
    required: string[];
    permission: Record<string, boolean>;
    properties: Record<
      string,
      { bsonType: string | string[]; title?: string; maxLength?: number; enum?: unknown }
    >;
  };

const SCHEMA_FILE = 'uniCloud-alipay/database/transactions.schema.json';
const INDEX_FILE = 'uniCloud-alipay/cloudfunctions/ledger/index.js';
const LIB_FILE = 'uniCloud-alipay/cloudfunctions/ledger/lib.js';

const schema = readJson(SCHEMA_FILE);
const indexSource = readText(INDEX_FILE);
const libSource = readText(LIB_FILE);

/** 由云函数在服务端补齐、不由客户端传入的字段 */
const SERVER_FIELDS = ['familyId', 'createdByUid', 'createdAt', 'updatedAt'];

describe('transactions schema', () => {
  it('文件存在、可解析、有 properties 与 _id', () => {
    expect(schema.bsonType).toBe('object');
    expect(schema.properties).toBeTruthy();
    expect(schema.properties._id).toBeTruthy();
  });

  it('permission 全为 false（客户端不可直连，只能走云函数）', () => {
    expect(schema.permission).toEqual({
      read: false,
      create: false,
      update: false,
      delete: false,
    });
  });

  it('required 覆盖全部必写字段', () => {
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'familyId',
        'clientId',
        'date',
        'type',
        'amount',
        'category',
        'note',
      ]),
    );
  });

  it('createdAt / updatedAt 为毫秒时间戳', () => {
    expect(schema.properties.createdAt.bsonType).toBe('timestamp');
    expect(schema.properties.updatedAt.bsonType).toBe('timestamp');
    expect(schema.properties.createdAt.title).toContain('毫秒');
  });

  it('⚠️ note 必须是 string（不可为 null）', () => {
    // 落 null 会让前端 validateTransaction（要求 typeof note === 'string'）判非法，
    // 整条记录被 LedgerRepository 静默丢弃 —— 本地写入却是成功的
    expect(schema.properties.note.bsonType).toBe('string');
  });

  it('⚠️ memberId 是 id 型可选字段：string | null，且**不能落空串**', () => {
    // 与 note / category 相反：前端 optionalIdError 把空串判为**非法**，
    // 所以这里必须允许 null、并禁止空串（空串由 lib 的 normalizeOptionalId 归一为 null）
    expect(schema.properties.memberId.bsonType).toEqual(['string', 'null']);
    expect(schema.properties.memberId.title).toContain('空串');
  });

  it('type 是字符串、amount 是数值、date 是 10 位字符串', () => {
    expect(schema.properties.type.bsonType).toBe('string');
    expect(schema.properties.amount.bsonType).toEqual(['int', 'double']);
    expect(schema.properties.date.bsonType).toBe('string');
    expect(schema.properties.date.maxLength).toBe(10);
  });

  it('⚠️ category / type 都**不写 enum 白名单**（枚举一律由云函数 lib 校验）', () => {
    // `category`：历史上用户改过分类常量，库里会留下当前常量表以外的值，
    // 写 enum 会让这些记录在「老数据导入」时被 schema 层拒掉。
    // `type`：只有 income / expense 两个值，但 schema 的 enum 比 lib 校验**更严**，
    // 哪天前端加了第三种类型（例如 transfer），老 schema 会静默把记录挡在云外。
    // 现有 11 个 schema 文件也全部不使用 enum（已核对），这里保持一致。
    expect(schema.properties.category.enum).toBeUndefined();
    expect(schema.properties.type.enum).toBeUndefined();
    // 不给 schema 留后门：一旦有人补上 enum，这条会失败，逼人回来重新评估
    expect(Object.keys(schema.properties).filter((key) => schema.properties[key].enum)).toEqual([]);
  });
});

describe('落库字段 ↔ schema 一致性（防止代码与 schema 漂移）', () => {
  it('云函数写入的字段全部已在 schema 中声明', () => {
    const value = ledgerLib.validateTransactionPayload({
      clientId: 'txn-1',
      date: '2026-09-14',
      type: 'expense',
      amount: 25.5,
      category: '餐饮',
      memberId: 'member-1',
      note: '午饭',
    }).value;

    const declared = Object.keys(schema.properties);
    for (const key of [...Object.keys(value), ...SERVER_FIELDS]) {
      expect(declared, `${SCHEMA_FILE} 缺少字段 ${key}`).toContain(key);
    }
  });

  it('schema 的 maxLength 与 lib 的上限一致', () => {
    expect(schema.properties.clientId.maxLength).toBe(ledgerLib.CLIENT_ID_MAX);
    expect(schema.properties.category.maxLength).toBe(ledgerLib.CATEGORY_MAX);
    expect(schema.properties.note.maxLength).toBe(ledgerLib.NOTE_MAX);
  });

  it('⚠️ schema 的 maxLength 还必须对上「前端上限表」（只对 lib 会漏掉两端一起漂移）', () => {
    // 三角闭合（由 M3 第 4 步的 M6 变异抓出来的缺口）：
    // 只断言 schema === lib 时，把 schema 与 lib 一起改错照样通过 ——
    // 但用户能在前端输入更长的值，推云端被 schema 拒掉，记录永久留在本地且不报错。
    // 前端上限表 LEDGER_LIMITS 已被 `ui-limits.test.ts` 锁死在 lib 上，
    // 这里补上「schema ↔ 前端表」这条边。
    expect(schema.properties.category.maxLength).toBe(LEDGER_LIMITS.category);
    expect(schema.properties.note.maxLength).toBe(LEDGER_LIMITS.note);
  });

  it('⚠️ schema 不能比 lib 更严（更严会拒掉 lib 认可的合法记录）', () => {
    // clientId 不在前端上限表里（长度由 createId() 决定，前端没有 maxlength 能约束它），
    // 所以用一个方向性断言兜底；绝对数值由 ui-limits 的 toBe(64) 钉住。
    for (const [field, limit] of [
      ['clientId', ledgerLib.CLIENT_ID_MAX],
      ['category', ledgerLib.CATEGORY_MAX],
      ['note', ledgerLib.NOTE_MAX],
    ] as const) {
      expect(
        schema.properties[field].maxLength,
        `${SCHEMA_FILE} 的 ${field} 上限比 lib 更严，合法记录会被拒`,
      ).toBeGreaterThanOrEqual(limit);
    }
  });

  it('schema 声明了全部「客户端可传」的字段（不多不少）', () => {
    const clientFields = [
      'clientId',
      'date',
      'type',
      'amount',
      'category',
      'memberId',
      'note',
    ].sort();
    const declared = Object.keys(schema.properties)
      .filter((key) => key !== '_id' && !SERVER_FIELDS.includes(key))
      .sort();

    // 「不多」同样重要：schema 里多一个客户端永远不传的字段，说明设计里已经
    // 有个字段悄悄掉了（对应的前端模型改过、而 schema 没跟上）
    expect(declared).toEqual(clientFields);
  });
});

describe('ledger 云函数越权防护（源码级守卫）', () => {
  it('不允许从客户端入参读取 familyId（必须由服务端推导）', () => {
    const dangerous = /\b(event|evt|payload|input|body)\s*\.\s*familyId\b/;
    expect(dangerous.test(indexSource), '直接从客户端入参取了 familyId').toBe(false);
  });

  it('必须调用 resolveContext 获取家庭归属', () => {
    expect(indexSource.includes('resolveContext(')).toBe(true);
  });

  it('定位记录必须按 familyId + clientId', () => {
    expect(indexSource).toContain('where({ familyId, clientId })');
  });

  it('memberId 必须经 resolveMemberId 校验归属', () => {
    expect(indexSource).toContain('resolveMemberId(familyId,');
    // 新增与更新两条写入路径都要过一遍，不能只做一条
    const calls = indexSource.match(/resolveMemberId\(familyId,/g) ?? [];
    expect(calls.length, 'add / update 都应校验 memberId 归属').toBeGreaterThanOrEqual(2);
  });

  it('路由齐备：list / add / update / remove / listTombstones', () => {
    for (const action of ['list', 'add', 'update', 'remove', 'listTombstones']) {
      expect(indexSource, `缺少 ${action} 分支`).toContain(`case '${action}':`);
    }
  });

  it('⚠️ 不得出现批量导入 action（importAll 已在实施时被否决）', () => {
    // 导入改为复用既有 add（客户端限并发逐条下发），见方案文档 §2.1 决策 3：
    // 只给 ledger 加批量接口解决不了跨 6 个云函数的问题，
    // 给 6 个都加则要重传 5 个已部署的云函数。
    expect(indexSource).not.toMatch(/case 'importAll'/)
    expect(indexSource).not.toContain('importAll')
    for (const action of ['import', 'importTransactions', 'addBatch']) {
      expect(indexSource, `不应出现批量写入口 ${action}`).not.toContain(`'${action}'`);
    }
  });

  it('列表按日期区间查（账本的读取口径是「某个月」，见 §3.4）', () => {
    expect(indexSource).toContain('validateTransactionQuery(');
    expect(indexSource).toContain('buildDateWhere(dbCmd, query.value)');
    // 不能退化成按单日 —— 月汇总会基于残缺数据算出明显偏小的数字
    expect(indexSource, '不应把 list 退化成按单日查').not.toContain(
      'where({ familyId, date: query.value.date })',
    );
  });
});

describe('ledger 的删除与墓碑', () => {
  it('先删记录、再写墓碑（顺序反了会造成记录复活）', () => {
    const removeIndex = indexSource.indexOf('collection(TRANSACTIONS).doc(target._id).remove()');
    const tombstoneIndex = indexSource.indexOf("domain: 'transaction'");

    expect(removeIndex, '未删除记录本身').toBeGreaterThan(-1);
    expect(tombstoneIndex, '未写 transaction 墓碑').toBeGreaterThan(-1);
    expect(removeIndex, '必须先删记录、再写墓碑').toBeLessThan(tombstoneIndex);
  });

  it('⚠️ 墓碑写入必须在 if (target) 之外（记录不存在也要写，便于重试补写）', () => {
    const body = indexSource.slice(indexSource.indexOf('async function removeTransaction('));
    const block = body.slice(0, body.indexOf('\n}\n'));
    const ifBlock = block.match(/if \(target\) \{([\s\S]*?)\n {2}\}/);

    expect(block).toContain('recordTombstones(');
    expect(ifBlock, '未找到 if (target) 块').toBeTruthy();
    expect(ifBlock?.[1], '墓碑不能塞进 if (target) 里').not.toContain('recordTombstones');
  });

  it('墓碑带上日期（本地按日期分区存储，带上就能直接定位分区）', () => {
    expect(indexSource).toContain('(target && target.date)');
  });

  it('删除是幂等的（记录不存在也返回成功）', () => {
    // 返回 404 会让离线队列把已删成功的记录当成失败而无限重试
    expect(indexSource).toMatch(/removed:\s*!!target/);
  });

  it('listTombstones 只拉 transaction 一类', () => {
    expect(indexSource).toContain("domains: ['transaction']");
  });
});

describe('ledger 的更新不许改 date', () => {
  it('updateTransaction 的写入字段里不含 date', () => {
    const body = indexSource.slice(indexSource.indexOf('async function updateTransaction('));
    const block = body.slice(0, body.indexOf('\n}\n'));
    const updateCall = block.slice(block.indexOf('.update('));

    expect(
      updateCall,
      'update 不应写入 date（前端 TransactionPatch 不含 date，改了记录会在按区间拉取时凭空消失）',
    ).not.toMatch(/^\s*date:/m);
  });

  it('mergeTransactionPatch 里 date 取自 base 而非 patch（与上一条互为正反面）', () => {
    const body = libSource.slice(libSource.indexOf('function mergeTransactionPatch('));

    expect(body).toContain('date: base.date');
  });
});
