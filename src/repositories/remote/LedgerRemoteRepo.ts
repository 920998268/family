import type { Transaction } from '@/types/models';
import {
  addCloudTransaction,
  listCloudTransactions,
  removeCloudTransaction,
  updateCloudTransaction,
  type CloudWriteResult,
} from '@/unicloud';

/**
 * 账本（`transactions`）的远端读写接口。
 *
 * 与 `MealPlanRemoteRepo` 同构（两者在云侧都是「单表 + 单云函数、无主从关系」），
 * 只有一处不同：**读取是日期区间**（`listRange`）。
 *
 * 为什么不是「按日期」也不是「全量」：
 * - 本机仓储 `LedgerRepository` 是按日期分片存储（`family.ledger.v1.<date>`），
 *   「按单日」看似对应得更自然 —— 但页面的汇总卡是对**当前选中月份**求和，
 *   只拉当天会让月汇总算出明显偏小的数字；
 * - 「全量」则会把无界的记录量搬到每次进页面时（账本没有「所有月份一屏看」的页面）。
 * 详见 `docs/0.4.0-m4-requirements-and-solution.md` §3.4。
 *
 * ⚠️ 这里只把云函数名与映射挡在仓储层，不含任何业务逻辑 —— 与既有远端仓储同风格。
 */
export interface LedgerRemoteRepo {
  /** 拉取 `[from, to]` 闭区间内的收支记录（两端均必填，`YYYY-MM-DD`） */
  listRange(from: string, to: string): Promise<Transaction[]>;
  /** 新增。返回 `duplicated` 表示服务端已存在同 clientId 记录（幂等命中） */
  create(entry: Transaction): Promise<CloudWriteResult>;
  /**
   * 更新。**`date` 不可改**：前端 `TransactionPatch` 本就不含 `date`，
   * 云端 `mergeTransactionPatch` 也写死取既有记录的 `date` ——
   * 改了日期会让这条记录在按区间拉取时凭空消失（旧区间拉不到、新区间从没推过）。
   */
  update(entry: Transaction): Promise<void>;
  /**
   * 删除。服务端幂等（记录不存在同样算成功）。
   *
   * `date` 可选，仅用于「记录已不存在」时给墓碑兜底一个日期
   * （让别的设备快速定位本地分区），不影响删除本身。
   */
  remove(clientId: string, date?: string): Promise<{ removed: boolean }>;
}

/** 生产实现：委托给 uniCloud 调用层 */
export function createLedgerRemoteRepo(): LedgerRemoteRepo {
  return {
    listRange: (from, to) => listCloudTransactions(from, to),
    create: (entry) => addCloudTransaction(entry),
    update: (entry) => updateCloudTransaction(entry),
    remove: (clientId, date) => removeCloudTransaction(clientId, date),
  };
}
