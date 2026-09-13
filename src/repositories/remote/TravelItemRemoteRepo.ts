import type { TravelItem } from '@/types/models';
import {
  addCloudTravelItem,
  listCloudTravelItems,
  removeCloudTravelItem,
  toggleCloudTravelItem,
  updateCloudTravelItem,
  type CloudWriteResult,
} from '@/unicloud';

/**
 * 行程明细（`travel_items`）的远端读写接口。
 *
 * 明细在三层里都是**独立的一层**（云端独立集合 / 本地嵌在 `TravelPlan.items` /
 * 这里独立的远端接口），原因是它必须支持**记录级**读写：
 *
 * - 表单提交一次给整份明细 → 由 `computeItemDiff` 拆成 add / update / remove 逐条下发，
 *   避免「整包覆盖」让两个人的编辑互相覆盖；
 * - 勾选走 `toggle`，服务端**只写 `done`**，两个人同时勾不同明细不会互相覆盖；
 * - 删除逐条传播（`travelItem` 墓碑），而整包覆盖下「删掉一行」在云端是不可见的事件。
 *
 * ⚠️ 每个方法都要带 `travelId`（所属计划）：明细自己不知道归属，
 *    归属只存在于「计划 → 它的 items」这一层；云端也靠它校验主从约束
 *    （给不存在的计划塞明细会被拒，避免永久孤儿）。
 */
export interface TravelItemRemoteRepo {
  /**
   * 拉取某个计划的全部明细 —— **明细的权威读取口径**（按计划查，天然有界）。
   *
   * 不要拿 `listPlans` 聚合的 items 替代它（会被 500 条上限截断）。
   */
  listByPlan(travelId: string): Promise<TravelItem[]>;
  /**
   * 新增明细。`fallbackOrder` 用于老数据（明细缺 `order` 时按数组下标兜底）。
   * 服务端幂等：同 clientId 重复投递返回 `duplicated` 而不是报错。
   */
  create(travelId: string, item: TravelItem, fallbackOrder?: number): Promise<CloudWriteResult>;
  /**
   * 更新明细。
   *
   * ⚠️ 只用于「明细内容真的变了」（`computeItemDiff` 判定的 updated）——
   *    勾选状态请走 `toggle`，否则会把整条明细（含顺序）一起写回，
   *    又退化成「后写者覆盖前写者」。
   */
  update(travelId: string, item: TravelItem, fallbackOrder?: number): Promise<void>;
  /**
   * 勾选 / 取消勾选。
   *
   * 服务端**翻转当前值**（不由客户端指定目标状态），返回最终值供调用方回写本地。
   * 之所以不做成 `setDone(clientId, done)`：两个设备同时点同一条时，
   * 「翻转」在服务端串行执行后结果确定，而「设值」会取决于谁后到。
   */
  toggle(clientId: string): Promise<{ done: boolean }>;
  /** 删除明细。服务端幂等（记录不存在同样算成功），并写 `travelItem` 墓碑逐条传播删除 */
  remove(clientId: string): Promise<{ removed: boolean }>;
}

/** 生产实现：委托给 uniCloud 调用层 */
export function createTravelItemRemoteRepo(): TravelItemRemoteRepo {
  return {
    listByPlan: (travelId) => listCloudTravelItems(travelId),
    create: (travelId, item, fallbackOrder) => addCloudTravelItem(travelId, item, fallbackOrder),
    update: (travelId, item, fallbackOrder) => updateCloudTravelItem(travelId, item, fallbackOrder),
    toggle: (clientId) => toggleCloudTravelItem(clientId),
    remove: (clientId) => removeCloudTravelItem(clientId),
  };
}
