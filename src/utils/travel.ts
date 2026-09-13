import type { TravelItem } from '@/types/models';
import { createId } from '@/utils/id';

/**
 * 出行模块的跨端原语（M3 第 2 步）。
 *
 * 为什么需要这一层 —— 出行明细要上云，就必须先解决三件事：
 *
 * 1. **明细 id 必须稳定**。改造前 `TravelService.normalizeItems()` 在每次 update 时
 *    给**全部明细重新生成 id**，于是任何一次计划编辑之后 `toggleItem` 拿到的 id
 *    立即失效。纯本地场景看不出来（store 会重新加载），但云端「按明细记录读写」
 *    完全依赖稳定 id —— 这是必须先修掉的既有缺陷。
 *
 * 2. **明细顺序必须显式表达**。拆进独立集合 `travel_items` 后，数组位置不再存在，
 *    顺序只能用 `order` 字段承载。
 *
 * 3. **提交要能算出「增 / 改 / 删」**。表单是一次性提交整份明细的，
 *    若原样整包写回云端就成了「后写者覆盖前写者」；`computeItemDiff` 把它
 *    翻译成记录级操作，这样两人同时勾选不同明细才不会互相覆盖。
 */

/** 明细 id 前缀，与 `TravelService` 既有命名保持一致 */
export const TRAVEL_ITEM_ID_PREFIX = 'trip';

/**
 * 明细草稿：可以带已有的 id（编辑既有明细行），也可以不带（表单新增的行）。
 *
 * **不带 `order`** —— 顺序由在数组里的下标决定，写完就归一化成字段。
 */
export interface TravelItemInput {
  id?: string;
  time: string;
  activity: string;
  note: string;
  done: boolean;
}

export interface TravelItemDiff {
  /** 需要新增的明细（已补好 id 与 order） */
  added: TravelItem[];
  /** 已存在且发生变化的明细（保留原 id，含最新 order） */
  updated: TravelItem[];
  /** 需要在云端 / 本地删除的原有明细 id */
  removed: string[];
  /** 已存在且原样未动的明细 id（便于断言与排查，不参与写入） */
  unchanged: string[];
}

type IdGenerator = (prefix: string) => string;

function toText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 参与成员归一化：**去重 + 剔除空值，保持原有顺序**。
 *
 * 为什么不因为「成员不存在」而剔除：成员被移出家庭不该让出行计划消失或变形，
 * 这里只做形状归一，成员是否存在属于展示层的问题。
 */
export function normalizeTravelMembers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const members: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const id = item.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    members.push(id);
  }

  return members;
}

/**
 * 明细归一化：补 id（保留已有的）、按下标写 `order`、把非字符串字段收敛成字符串。
 *
 * ⚠️ **保留已有 id 是本次改造的核心**，不是可选优化 —— 见文件头注释第 1 条。
 */
export function normalizeTravelItems(
  drafts: ReadonlyArray<TravelItemInput>,
  generateId: IdGenerator = createId,
): TravelItem[] {
  return drafts.map((draft, index) => ({
    id: isValidId(draft.id) ? draft.id : generateId(TRAVEL_ITEM_ID_PREFIX),
    order: index,
    time: toText(draft.time),
    activity: toText(draft.activity),
    note: toText(draft.note),
    done: draft.done === true,
  }));
}

/** 取明细的顺序键：没有 `order` 的老数据按数组下标理解 */
function orderOf(item: TravelItem, fallback: number): number {
  return typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : fallback;
}

/**
 * 按 `order` 稳定排序（缺失 `order` 的老数据按下标参与排序）。
 *
 * 拉取云端明细后用它还原顺序 —— 云端返回的顺序不保证稳定。
 */
export function sortTravelItems(items: ReadonlyArray<TravelItem>): TravelItem[] {
  return items
    .map((item, index) => ({ item, key: orderOf(item, index), index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * 把「表单提交的整份明细」翻译成记录级的增 / 改 / 删。
 *
 * 匹配规则（按 submitted 的下标顺序逐条判定）：
 * | 情况 | 判定 |
 * |---|---|
 * | 带 id 且命中原集合、且该原记录**尚未被前面某条消费** | 同一条 → 比字段与顺序 |
 * | 带 id 但原集合里没有（客户端新生成的 id） | 新增，**沿用该 id** |
 * | 没带 id，或 id 已被前面消费过（重复） | 新增，生成新 id |
 * | 原集合里有、提交里没出现 | 删除 |
 *
 * ⚠️ **顺序是逐条比对的**：在中间插入一行会让其后所有明细的 `order` 变化，
 * 因而它们都会被判为「已更新」。这是刻意的 —— 云端确实需要把新的顺序写下去，
 * 而不是靠数组位置隐式表达。家庭出行明细的量级（十几条）下这点写入可以忽略。
 */
export function computeItemDiff(
  original: ReadonlyArray<TravelItem>,
  submitted: ReadonlyArray<TravelItemInput>,
  generateId: IdGenerator = createId,
): TravelItemDiff {
  const originalById = new Map<string, TravelItem>();
  const originalIndex = new Map<string, number>();

  original.forEach((item, index) => {
    if (isValidId(item?.id)) {
      originalById.set(item.id, item);
      if (!originalIndex.has(item.id)) {
        originalIndex.set(item.id, index);
      }
    }
  });

  const diff: TravelItemDiff = { added: [], updated: [], removed: [], unchanged: [] };
  const claimed = new Set<string>();
  const used = new Set<string>();

  submitted.forEach((draft, index) => {
    const draftId = isValidId(draft.id) ? draft.id : '';
    const existing = draftId && !used.has(draftId) ? originalById.get(draftId) : undefined;

    let id: string;
    if (existing) {
      id = existing.id;
      claimed.add(existing.id);
    } else if (draftId && !originalById.has(draftId) && !used.has(draftId)) {
      id = draftId;
    } else {
      id = generateId(TRAVEL_ITEM_ID_PREFIX);
    }
    used.add(id);

    const target: TravelItem = {
      id,
      order: index,
      time: toText(draft.time),
      activity: toText(draft.activity),
      note: toText(draft.note),
      done: draft.done === true,
    };

    if (!existing) {
      diff.added.push(target);
      return;
    }

    const changed =
      existing.time !== target.time ||
      existing.activity !== target.activity ||
      existing.note !== target.note ||
      existing.done !== target.done ||
      orderOf(existing, originalIndex.get(existing.id) ?? 0) !== target.order;

    if (changed) {
      diff.updated.push(target);
    } else {
      diff.unchanged.push(existing.id);
    }
  });

  const emitted = new Set<string>();
  for (const item of original) {
    if (!isValidId(item?.id) || emitted.has(item.id)) {
      continue;
    }
    emitted.add(item.id);
    if (!claimed.has(item.id)) {
      diff.removed.push(item.id);
    }
  }

  return diff;
}
