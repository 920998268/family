import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// 公共模块 lib.js 为 CommonJS 纯逻辑（不碰数据库），可直接 require 做单测。
// ⚠️ 不要 require 同目录的 index.js —— 它依赖全局 uniCloud，加载即报错。
const require = createRequire(import.meta.url);
const lib = require('../uniCloud-alipay/cloudfunctions/common/checkin-shared/lib');

const FAMILY = 'family-1';
const NOW = Date.parse('2026-09-12T04:00:00.000Z');

function build(overrides: Record<string, unknown> = {}) {
  return lib.buildTombstoneDocs({
    familyId: FAMILY,
    domain: 'diet',
    entries: [{ clientId: 'd-1', date: '2026-09-12' }],
    deletedAt: NOW,
    uid: 'uid-1',
    ...overrides,
  });
}

describe('墓碑文档构造（buildTombstoneDocs）', () => {
  it('生成一条完整的墓碑文档', () => {
    const docs = build();

    expect(docs).toHaveLength(1);
    expect(docs[0]).toEqual({
      familyId: FAMILY,
      domain: 'diet',
      clientId: 'd-1',
      date: '2026-09-12',
      deletedAt: NOW,
      createdByUid: 'uid-1',
    });
  });

  it('级联删除：一次为多条记录生成墓碑（删计划时带上全部打卡）', () => {
    const docs = build({
      domain: 'studyCheckin',
      entries: [
        { clientId: 'c-1', date: '2026-09-01' },
        { clientId: 'c-2', date: '2026-09-02' },
        { clientId: 'c-3', date: '2026-09-03' },
      ],
    });

    expect(docs.map((doc: { clientId: string }) => doc.clientId)).toEqual(['c-1', 'c-2', 'c-3']);
    expect(new Set(docs.map((doc: { domain: string }) => doc.domain))).toEqual(
      new Set(['studyCheckin']),
    );
  });

  it('批内按 clientId 去重（同一打卡被收集多次只写一条）', () => {
    const docs = build({
      entries: [
        { clientId: 'c-1', date: '2026-09-01' },
        { clientId: 'c-1', date: '2026-09-01' },
        { clientId: 'c-2', date: '2026-09-02' },
      ],
    });

    expect(docs.map((doc: { clientId: string }) => doc.clientId)).toEqual(['c-1', 'c-2']);
  });

  it('过滤缺 clientId 的条目（空串 / undefined / null 项）', () => {
    const docs = build({
      entries: [
        { clientId: '', date: '2026-09-01' },
        { date: '2026-09-01' },
        null,
        { clientId: 'c-1' },
      ],
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].clientId).toBe('c-1');
  });

  it('date 非字符串一律归一成空串（学习计划没有日期）', () => {
    const docs = build({ domain: 'studyPlan', entries: [{ clientId: 'p-1', date: undefined }] });

    expect(docs[0].date).toBe('');
  });

  it('deletedAt 非法时落 0，而不是丢弃整批（墓碑缺失无痕，比落 0 危险）', () => {
    const docs = build({ deletedAt: Number.NaN });

    expect(docs).toHaveLength(1);
    expect(docs[0].deletedAt).toBe(0);
  });

  it('domain 非法或 familyId 缺失时返回空数组（绝不写出脏墓碑）', () => {
    expect(build({ domain: 'unknown' })).toEqual([]);
    expect(build({ domain: undefined })).toEqual([]);
    expect(build({ familyId: '' })).toEqual([]);
    expect(build({ familyId: undefined })).toEqual([]);
  });

  it('entries 不是数组时安全返回空', () => {
    expect(build({ entries: undefined })).toEqual([]);
    expect(build({ entries: 'c-1' })).toEqual([]);
  });
});

describe('墓碑保留窗口（tombstoneWindowStart）', () => {
  it('默认窗口是 180 天', () => {
    const start = lib.tombstoneWindowStart(NOW);

    expect(NOW - start).toBe(180 * 24 * 60 * 60 * 1000);
  });

  it('可传入自定义窗口天数', () => {
    const start = lib.tombstoneWindowStart(NOW, 30);

    expect(NOW - start).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('now 非法时按 0 处理（不会返回 NaN 把查询搞崩）', () => {
    expect(Number.isFinite(lib.tombstoneWindowStart(Number.NaN))).toBe(true);
    expect(Number.isFinite(lib.tombstoneWindowStart(undefined))).toBe(true);
  });
});

describe('游标解析（validateTombstoneCursor）', () => {
  it('正数原样返回', () => {
    expect(lib.validateTombstoneCursor(NOW)).toBe(NOW);
  });

  it('非法值一律当 0 —— 从头拉一遍；重复应用墓碑是无害的', () => {
    expect(lib.validateTombstoneCursor(0)).toBe(0);
    expect(lib.validateTombstoneCursor(-1)).toBe(0);
    expect(lib.validateTombstoneCursor(Number.NaN)).toBe(0);
    expect(lib.validateTombstoneCursor('123')).toBe(0);
    expect(lib.validateTombstoneCursor(undefined)).toBe(0);
  });
});

describe('返回给客户端的结构（toClientTombstone）', () => {
  it('只暴露 4 个字段，不带 _id / familyId（避免泄漏与冗余）', () => {
    const item = lib.toClientTombstone({
      _id: 'doc-1',
      familyId: FAMILY,
      domain: 'diet',
      clientId: 'd-1',
      date: '2026-09-12',
      deletedAt: NOW,
      createdByUid: 'uid-1',
    });

    expect(item).toEqual({ domain: 'diet', clientId: 'd-1', date: '2026-09-12', deletedAt: NOW });
  });

  it('空文档返回 null 而不是抛错', () => {
    expect(lib.toClientTombstone(null)).toBeNull();
  });
});

describe('领域白名单（isTombstoneDomain）', () => {
  it('四个领域是全部合法值 —— 与前端 SyncDomain 必须一致', () => {
    expect(lib.TOMBSTONE_DOMAINS).toEqual(['diet', 'workout', 'studyPlan', 'studyCheckin']);
    for (const domain of lib.TOMBSTONE_DOMAINS) {
      expect(lib.isTombstoneDomain(domain)).toBe(true);
    }
    expect(lib.isTombstoneDomain('study')).toBe(false);
    expect(lib.isTombstoneDomain('')).toBe(false);
  });
});
