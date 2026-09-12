import type { StorageAdapter } from '@/storage/StorageAdapter';
import { SYNC_DOMAINS, type SyncDomain } from '@/utils/pendingSync';

/**
 * 墓碑（删除日志）游标持久化键。
 *
 * 存的是「已应用到的最大 `deletedAt`」。下次拉取只取 `deletedAt > 游标` 的墓碑，
 * 避免每次都把 180 天窗口内的墓碑全拉一遍。
 */
export const TOMBSTONE_CURSOR_KEY = 'family.tombstoneCursor.v1';

/** 一条删除日志：某条记录在某个时刻被删了 */
export interface Tombstone {
  domain: SyncDomain;
  /** 被删记录的 id（= 云端 clientId） */
  clientId: string;
  /** 被删记录的日期，学习计划为空串。用于快速定位本地记录 */
  date: string;
  /** 删除时间（毫秒），游标依据 */
  deletedAt: number;
}

function isTombstone(value: unknown): value is Tombstone {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<Tombstone>;
  return (
    typeof item.domain === 'string' &&
    SYNC_DOMAINS.has(item.domain) &&
    typeof item.clientId === 'string' &&
    !!item.clientId &&
    typeof item.date === 'string' &&
    typeof item.deletedAt === 'number' &&
    Number.isFinite(item.deletedAt)
  );
}

/**
 * 解析云端返回的墓碑列表。
 *
 * 逐条校验并**丢弃非法项** —— 墓碑是用来删除数据的，
 * 一条字段不全的记录可能匹配到本地所有记录（比如 clientId 为空），
 * 宁可漏删（下次拉取还会再来一遍）也不能错删。
 */
export function parseTombstones(raw: unknown): Tombstone[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isTombstone);
}

/**
 * 读取游标。非法值（NaN / 负数 / 非数字）一律当 0 = 从头拉取。
 *
 * ⚠️ 与云侧 `validateTombstoneCursor` 的规则保持一致：
 * 重复应用墓碑是无害的（本地已删的记录再删一次没有副作用），
 * 所以解析失败时宁可多拉，也不要抛错中断整个同步。
 */
export function readTombstoneCursor(storage: StorageAdapter): number {
  const raw = Number(storage.getItem(TOMBSTONE_CURSOR_KEY));
  if (!Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return raw;
}

/** 写入游标。回退到 0（或非法值）时直接删键，不留无意义的默认值 */
export function writeTombstoneCursor(storage: StorageAdapter, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    storage.removeItem(TOMBSTONE_CURSOR_KEY);
    return;
  }
  storage.setItem(TOMBSTONE_CURSOR_KEY, String(value));
}

/**
 * 由本批墓碑推进游标：取「当前游标」与本批 `deletedAt` 的最大值。
 *
 * ⚠️ 只往上推进、不回退 —— 否则会把已经应用过的墓碑再拉一遍。
 */
export function nextTombstoneCursor(current: number, items: readonly Tombstone[]): number {
  let max = Number.isFinite(current) && current > 0 ? current : 0;
  for (const item of items) {
    if (typeof item.deletedAt === 'number' && Number.isFinite(item.deletedAt) && item.deletedAt > max) {
      max = item.deletedAt;
    }
  }
  return max;
}

/** 按 domain 归组，便于同步层分派给各自的仓储 */
export function groupTombstonesByDomain(
  items: readonly Tombstone[],
): Map<SyncDomain, Tombstone[]> {
  const grouped = new Map<SyncDomain, Tombstone[]>();
  for (const item of items) {
    const bucket = grouped.get(item.domain);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(item.domain, [item]);
    }
  }
  return grouped;
}
