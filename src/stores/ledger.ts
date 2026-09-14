import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Transaction } from '@/types/models';
import type { TransactionDraft, TransactionPatch } from '@/services/LedgerService';
import { createLedgerService, getCheckinSyncService } from '@/services';
import {
  flushPendingCheckins,
  isCheckinCloudReady,
  markCheckinDirty,
} from '@/services/checkinRuntime';
import { monthRange } from '@/utils/date';

/**
 * 当前读取口径。
 *
 * 账本只有一个本地仓储，但**有三种读取方式**（按日 / 按月 / 全量），
 * 分别服务三个调用点：记账表单（按日）、账本页（按月）、编辑态按 id 查找（全量）。
 * 写操作之后要「按当前口径重读」，所以口径本身必须被记住 ——
 * 只存一个 `loadedDate` 字符串的话，「按月」与「按日」没法区分。
 */
type LedgerScope =
  | { kind: 'date'; date: string }
  | { kind: 'month'; month: string }
  | { kind: 'all' };

/**
 * 家庭账本 store（M4 第 7 步接入云端）。
 *
 * 结构与食谱 store 同构，**唯一的差别是读取口径**：账本按**月份区间**拉取
 * （见 `syncFromCloud`），因为账本页的汇总卡是对当前选中月份的记录求和。
 */
export const useLedgerStore = defineStore('ledger', () => {
  const entries = ref<Transaction[]>([]);
  /** 当前加载的月份（`YYYY-MM`）；仅「按月」口径下非空，用于识别过期响应 */
  const loadedMonth = ref<string | null>(null);
  const loadedDate = ref<string | null>(null);
  /** 正在从云端拉取（可用于展示刷新态） */
  const syncing = ref(false);

  let scope: LedgerScope = { kind: 'all' };

  /** 只读某个月的本地缓存（走 service，保证排序与页面一致） */
  function readMonth(month: string): void {
    entries.value = createLedgerService().listByMonth(month);
  }

  /** 按当前口径重读本地缓存 */
  function read(): void {
    const current = scope;
    if (current.kind === 'month') {
      readMonth(current.month);
    } else if (current.kind === 'date') {
      entries.value = createLedgerService().listByDate(current.date);
    } else {
      entries.value = createLedgerService().getAll();
    }
  }

  /** 载入某一天（记账表单用；只读本地，不发云端请求） */
  function load(date: string): void {
    scope = { kind: 'date', date };
    loadedDate.value = date;
    loadedMonth.value = null;
    read();
  }

  /** 载入全部（编辑态按 id 查找用；只读本地） */
  function loadAll(): void {
    scope = { kind: 'all' };
    loadedDate.value = null;
    loadedMonth.value = null;
    read();
  }

  /**
   * 载入某个月（账本页用）。
   *
   * **本地优先**：先同步渲染本地缓存（秒开），云端拉取在后台进行。
   * 签名保持同步返回，页面（`onShow` / 切换月份）无需改造。
   */
  function loadMonth(month: string): void {
    scope = { kind: 'month', month };
    loadedMonth.value = month;
    loadedDate.value = null;
    read();
    void syncFromCloud(month);
  }

  /**
   * 从云端拉取**整月区间**并与本地合并（由 `loadMonth` 后台调用，也可手动刷新）。
   *
   * ⚠️ 这里必须是区间而不是当天：`ledger.vue` 的汇总卡是对当前选中月份的
   *    记录求和，只拉当天会让月结余算出明显偏小的数字 —— 用户会直接怀疑
   *    「我的账是不是记错了」，而界面上没有任何东西指向这里。
   */
  async function syncFromCloud(month: string): Promise<void> {
    if (!isCheckinCloudReady()) {
      return;
    }

    syncing.value = true;
    try {
      const { from, to } = monthRange(month);
      await getCheckinSyncService().pullTransactions(from, to);
      /**
       * 请求期间用户可能已切到别的月份：这时**必须按这次响应对应的月份**读，
       * 而不是按「当前口径」读 —— 后者会让这个判断变成一句永远成立的废话
       * （变异验证实测过：把判断换成无条件 `read()`，任何用例都拦不住，
       * 因为 `read()` 读的就是最新口径）。
       *
       * ⚠️ 顺带说明为什么这里**不能**用 `read()`：旧响应回来时 `scope` 已经是
       *    新月份了，`read()` 会把新月份的列表重读一遍（看着没坏），
       *    而真正的风险是「旧响应携带的写入」被当成当前数据展示 ——
       *    按响应月份读，才能保证「列表永远等于当前选中月份」。
       */
      if (loadedMonth.value === month) {
        readMonth(month);
      }
    } catch (error) {
      // 云端失败不影响本地使用（本地缓存已经渲染过了）
      console.warn('[账本] 云端拉取失败，保留本地缓存:', error);
    } finally {
      syncing.value = false;
    }
  }

  function add(date: string, draft: TransactionDraft): Transaction {
    const entry = createLedgerService().add(date, draft);
    read();
    // 标记里的 date 既用于日志排查，也会随墓碑下发给别的设备做分区提示
    markCheckinDirty('transaction', 'add', { id: entry.id, date });
    flushPendingCheckins();
    return entry;
  }

  function update(date: string, id: string, patch: TransactionPatch): Transaction {
    const entry = createLedgerService().update(date, id, patch);
    read();
    markCheckinDirty('transaction', 'update', { id, date });
    flushPendingCheckins();
    return entry;
  }

  function remove(date: string, id: string): void {
    createLedgerService().remove(date, id);
    read();
    // 云端按 clientId 删；`date` 仅在「记录已不存在」时给墓碑兜底一个分区提示
    markCheckinDirty('transaction', 'remove', { id, date });
    flushPendingCheckins();
  }

  return {
    entries,
    loadedMonth,
    loadedDate,
    syncing,
    load,
    loadAll,
    loadMonth,
    syncFromCloud,
    add,
    update,
    remove,
  };
});
