import type { StorageAdapter } from '@/storage/StorageAdapter';
import { parseStoredArray } from '@/repositories/parse';

/** 待同步标记的持久化键（family 前缀，与其它本地存储保持一致） */
export const PENDING_SYNC_KEY = 'family.pendingSync.v1';

/** 连续失败达到该次数即丢弃，避免死循环重投 */
export const MAX_SYNC_ATTEMPTS = 5;

/**
 * 待同步的领域。
 *
 * ⚠️ 学习占了**两个** domain：计划与打卡是两个独立实体、各自有幂等键，
 * 出队/失败要分别记账。合成一个 domain 的话，用打卡的 clientId 去出队计划，
 * 或者反过来，会互相误清标记。
 */
export type SyncDomain = 'diet' | 'workout' | 'studyPlan' | 'studyCheckin';
export type SyncOp = 'add' | 'update' | 'remove';

const SYNC_DOMAINS: ReadonlySet<string> = new Set<SyncDomain>([
  'diet',
  'workout',
  'studyPlan',
  'studyCheckin',
]);

/**
 * 一条待同步标记。
 *
 * 只存「身份 + 动作 + 重试状态」，**不存记录内容**：
 * 重发时从本地缓存读当前值，这样用户在上传前又改了一次，推上去的一定是最新版本，
 * 也避免了标记里带一份可能过期的副本。
 */
export interface PendingSyncItem {
  domain: SyncDomain;
  /** 幂等键：等于前端记录 id，也就是云端的 clientId */
  clientId: string;
  op: SyncOp;
  /** 记录所属日期。仅用于日志排查，同步定位只认 clientId */
  date: string;
  /** 连续失败次数；成功后归零并出队 */
  attempts: number;
  queuedAt: number;
  /** 最近一次失败原因，便于在真机上定位问题 */
  lastError?: string;
}

export type PendingSyncDraft = Pick<PendingSyncItem, 'domain' | 'clientId' | 'op' | 'date'>;

const OP_SET: ReadonlySet<string> = new Set<SyncOp>(['add', 'update', 'remove']);

function isPendingSyncItem(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<PendingSyncItem>;
  return (
    typeof item.domain === 'string' &&
    SYNC_DOMAINS.has(item.domain) &&
    typeof item.clientId === 'string' &&
    !!item.clientId &&
    typeof item.op === 'string' &&
    OP_SET.has(item.op) &&
    typeof item.date === 'string' &&
    typeof item.attempts === 'number' &&
    typeof item.queuedAt === 'number'
  );
}

/** 读取全部待同步标记（内容损坏时静默返回空数组，不影响主流程） */
export function readPendingSync(storage: StorageAdapter): PendingSyncItem[] {
  return parseStoredArray<PendingSyncItem>(storage.getItem(PENDING_SYNC_KEY), isPendingSyncItem);
}

/** 覆盖写入待同步标记；空列表直接删键，不留空数组 */
export function writePendingSync(storage: StorageAdapter, items: PendingSyncItem[]): void {
  if (items.length === 0) {
    storage.removeItem(PENDING_SYNC_KEY);
    return;
  }
  storage.setItem(PENDING_SYNC_KEY, JSON.stringify(items));
}

/** 清空全部待同步标记（退出登录 / 切换家庭时使用） */
export function clearPendingSync(storage: StorageAdapter): void {
  storage.removeItem(PENDING_SYNC_KEY);
}

function sameTarget(item: PendingSyncItem, domain: SyncDomain, clientId: string): boolean {
  return item.domain === domain && item.clientId === clientId;
}

/**
 * 合并同一目标上的两个动作。
 *
 * 规则（每条都有实际场景支撑）：
 * - `remove` 恒胜：用户已经删了这条记录，本地已经没有内容可推，最终状态就该是「不存在」；
 * - `add` 不被 `update` 覆盖：若首次 `add` 的响应丢了（服务端其实已写入），
 *   后续 `update` 会让云端找不到记录而返回 404；保持 `add` 则幂等命中，服务端返回
 *   `duplicated`，同步层再补一次 `update` 即可把内容对齐。
 * - 其余情况以新动作为准（如 `update` → `update`）。
 */
export function coalesceOp(prev: SyncOp, next: SyncOp): SyncOp {
  if (next === 'remove') return 'remove';
  if (prev === 'add') return 'add';
  return next;
}

/**
 * 入队一条待同步标记。
 *
 * 同一 `domain + clientId` 只保留一条：用户连续「新增→编辑→再编辑」不会排出三条消息，
 * 重发次数与网络消耗都降下来。`attempts` 在用户产生新动作时重置——
 * 用户又操作了一次，就该给它新的重试机会。
 */
export function queuePendingSync(
  storage: StorageAdapter,
  draft: PendingSyncDraft,
  now: number = Date.now(),
): PendingSyncItem[] {
  const items = readPendingSync(storage);
  const index = items.findIndex((item) => sameTarget(item, draft.domain, draft.clientId));

  if (index === -1) {
    items.push({ ...draft, attempts: 0, queuedAt: now });
  } else {
    const prev = items[index];
    items[index] = {
      ...prev,
      op: coalesceOp(prev.op, draft.op),
      date: draft.date,
      attempts: 0,
      queuedAt: now,
      lastError: undefined,
    };
  }

  writePendingSync(storage, items);
  return items;
}

/** 定位目标标记；`queuedAt` 用于确认自己处理的是不是「同一代次」的标记 */
function findTarget(
  items: PendingSyncItem[],
  domain: SyncDomain,
  clientId: string,
): number {
  return items.findIndex((item) => sameTarget(item, domain, clientId));
}

/**
 * 出队（同步成功后调用）。目标不存在时静默返回，保证重复出队安全。
 *
 * ⚠️ `queuedAt` 传的是**发起推送时该标记的代次**。若同步期间用户又改了一次，
 * 标记会被重新入队并刷新 `queuedAt` —— 此时不能把它一起出队，
 * 否则这次新的修改永远不会上云（推上去的是旧版本，而标记已被清掉）。
 */
export function dequeuePendingSync(
  storage: StorageAdapter,
  domain: SyncDomain,
  clientId: string,
  queuedAt?: number,
): PendingSyncItem[] {
  const items = readPendingSync(storage).filter((item) => {
    if (!sameTarget(item, domain, clientId)) {
      return true;
    }
    if (queuedAt !== undefined && item.queuedAt !== queuedAt) {
      // 期间用户又改动过：保留新标记，留给下一轮同步
      return true;
    }
    return false;
  });
  writePendingSync(storage, items);
  return items;
}

/**
 * 记一次失败：累加 `attempts` 并写入原因。
 * 返回累加后的标记；`attempts` 已达上限时应由调用方丢弃（见 `dropPendingSync`）。
 *
 * 标记在同步期间被重新入队（代次变化）时返回 `null` 且不动它 ——
 * 用户刚产生了新动作，`attempts` 已经在入队时重置，不该再背上这次失败。
 */
export function failPendingSync(
  storage: StorageAdapter,
  domain: SyncDomain,
  clientId: string,
  error: unknown,
  queuedAt?: number,
): PendingSyncItem | null {
  const items = readPendingSync(storage);
  const index = findTarget(items, domain, clientId);
  if (index === -1) {
    return null;
  }
  if (queuedAt !== undefined && items[index].queuedAt !== queuedAt) {
    return null;
  }

  const next: PendingSyncItem = {
    ...items[index],
    attempts: items[index].attempts + 1,
    lastError: error instanceof Error ? error.message : String(error),
  };
  items[index] = next;
  writePendingSync(storage, items);
  return next;
}

/** 放弃某条标记（重试超限或本地记录已不存在时调用） */
export function dropPendingSync(
  storage: StorageAdapter,
  domain: SyncDomain,
  clientId: string,
  queuedAt?: number,
): PendingSyncItem[] {
  return dequeuePendingSync(storage, domain, clientId, queuedAt);
}

/** 待同步 id 集合，供「读取合并」判断哪些本地记录比云端新 */
export function pendingClientIds(items: PendingSyncItem[], domain: SyncDomain): Set<string> {
  return new Set(items.filter((item) => item.domain === domain).map((item) => item.clientId));
}
