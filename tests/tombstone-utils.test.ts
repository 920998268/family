import { describe, expect, it } from 'vitest';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import {
  TOMBSTONE_CURSOR_KEY,
  groupTombstonesByDomain,
  nextTombstoneCursor,
  parseTombstones,
  readTombstoneCursor,
  writeTombstoneCursor,
  type Tombstone,
} from '@/utils/tombstone';

const T1 = 1_700_000_000_000;
const T2 = 1_700_000_100_000;

function tombstone(overrides: Partial<Tombstone> = {}): Tombstone {
  return { domain: 'diet', clientId: 'd-1', date: '2026-09-12', deletedAt: T1, ...overrides };
}

describe('墓碑解析（parseTombstones）', () => {
  it('保留合法项', () => {
    expect(parseTombstones([tombstone()])).toEqual([tombstone()]);
  });

  /**
   * 墓碑是用来**删除数据**的，字段不全的项可能匹配到本地所有记录
   * （例如 clientId 为空串）。宁可漏删（下次拉取还会再来一遍）也不能错删。
   */
  it('丢弃缺 clientId 的项（空串最容易造成误删）', () => {
    expect(parseTombstones([tombstone({ clientId: '' })])).toEqual([]);
    expect(parseTombstones([{ domain: 'diet', date: '2026-09-12', deletedAt: T1 }])).toEqual([]);
  });

  it('丢弃 domain 非法的项（防止未知领域被当成已支持的去删）', () => {
    expect(parseTombstones([tombstone({ domain: 'unknown' as never })])).toEqual([]);
  });

  it('丢弃 deletedAt 非数字的项（游标会被 NaN 污染）', () => {
    expect(parseTombstones([tombstone({ deletedAt: Number.NaN })])).toEqual([]);
    expect(parseTombstones([tombstone({ deletedAt: 'x' as never })])).toEqual([]);
  });

  it('date 缺失的项整条丢弃（不是补空串了事）', () => {
    expect(parseTombstones([tombstone({ date: undefined as never })])).toEqual([]);
  });

  it('非数组输入返回空，不抛错', () => {
    expect(parseTombstones(undefined)).toEqual([]);
    expect(parseTombstones(null)).toEqual([]);
    expect(parseTombstones({})).toEqual([]);
  });

  it('四个 domain 都合法', () => {
    const domains = ['diet', 'workout', 'studyPlan', 'studyCheckin'] as const;
    const parsed = parseTombstones(domains.map((domain) => tombstone({ domain })));

    expect(parsed).toHaveLength(4);
  });
});

describe('墓碑游标', () => {
  it('从未写过时读为 0（从头拉取）', () => {
    expect(readTombstoneCursor(new InMemoryStorageAdapter())).toBe(0);
  });

  it('写入后能原样读回', () => {
    const storage = new InMemoryStorageAdapter();
    writeTombstoneCursor(storage, T1);

    expect(readTombstoneCursor(storage)).toBe(T1);
  });

  it('非法值一律当 0 —— 多拉一遍是无害的，抛错中断同步才是问题', () => {
    const storage = new InMemoryStorageAdapter();
    storage.setItem(TOMBSTONE_CURSOR_KEY, 'not-a-number');

    expect(readTombstoneCursor(storage)).toBe(0);
  });

  it('负数当 0', () => {
    const storage = new InMemoryStorageAdapter();
    storage.setItem(TOMBSTONE_CURSOR_KEY, '-5');

    expect(readTombstoneCursor(storage)).toBe(0);
  });

  it('写 0 或负数时直接删键，不留无意义的默认值', () => {
    const storage = new InMemoryStorageAdapter();
    writeTombstoneCursor(storage, T1);
    writeTombstoneCursor(storage, 0);

    expect(storage.getItem(TOMBSTONE_CURSOR_KEY)).toBeNull();
  });
});

describe('游标推进（nextTombstoneCursor）', () => {
  it('取「当前」与「本批最大值」中更大的那个', () => {
    expect(nextTombstoneCursor(T1, [tombstone({ deletedAt: T2 })])).toBe(T2);
  });

  it('本批都比当前小则保持不变（只升不降）', () => {
    expect(nextTombstoneCursor(T2, [tombstone({ deletedAt: T1 })])).toBe(T2);
  });

  it('空列表时保持当前值', () => {
    expect(nextTombstoneCursor(T1, [])).toBe(T1);
  });

  it('当前值非法时从本批重算（不会把 NaN 写进存储）', () => {
    expect(nextTombstoneCursor(Number.NaN, [tombstone({ deletedAt: T2 })])).toBe(T2);
  });

  it('忽略本批里的非法 deletedAt', () => {
    const next = nextTombstoneCursor(0, [
      tombstone({ deletedAt: Number.NaN }),
      tombstone({ deletedAt: T1 }),
    ]);

    expect(next).toBe(T1);
  });
});

describe('按领域归组（groupTombstonesByDomain）', () => {
  it('同一 domain 的聚在一起，供同步层分派给各自仓储', () => {
    const grouped = groupTombstonesByDomain([
      tombstone({ domain: 'diet', clientId: 'd-1' }),
      tombstone({ domain: 'studyPlan', clientId: 'p-1', date: '' }),
      tombstone({ domain: 'diet', clientId: 'd-2' }),
    ]);

    expect([...(grouped.keys() as Iterable<string>)].sort()).toEqual(['diet', 'studyPlan']);
    expect(grouped.get('diet')?.map((item) => item.clientId)).toEqual(['d-1', 'd-2']);
    expect(grouped.get('studyPlan')?.map((item) => item.clientId)).toEqual(['p-1']);
  });

  it('空输入返回空 Map', () => {
    expect(groupTombstonesByDomain([]).size).toBe(0);
  });
});
