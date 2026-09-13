import type { TravelPlan } from '@/types/models';
import {
  addCloudTravelPlan,
  listCloudTravelPlans,
  removeCloudTravelPlan,
  updateCloudTravelPlan,
  type CloudWriteResult,
} from '@/unicloud';

/**
 * 出行计划（`travels`）的远端读写接口。
 *
 * ⚠️ 与食谱 / 饮食 / 运动的**最大差别**：出行计划**不分日期**，
 * `list()` 是**全量拉取**（本地仓储 `TravelRepository` 也是单键存全部计划），
 * 同 `StudyPlanRemoteRepo`。
 *
 * ⚠️⚠️ `list()` 返回的计划里 **`items` 恒为空数组**（不是遗漏）：
 *    云端 `listPlans` 聚合的 `items` 是「全家庭一次查、上限 500 条」的便捷聚合，
 *    明细多的家庭会被截断；它是**首屏渲染用**的，**不是明细的权威口径**。
 *    同步层**不得**拿它做「本地有、云端没有 ⇒ 判定被删」的推断，否则明细会凭空消失。
 *    明细必须走 `TravelItemRemoteRepo.listByPlan(travelId)`（按计划查，天然有界）。
 *    映射层之所以直接把它置空，就是为了让「忘了拉明细」表现为「明细为空」这种
 *    **显性**错误，而不是静默删掉用户的明细。
 */
export interface TravelPlanRemoteRepo {
  /** 拉取本家庭的**全部**出行计划（`items` 恒为空，见上） */
  list(): Promise<TravelPlan[]>;
  /** 新增计划本体（**不含明细**：明细由 `computeItemDiff` 拆成记录级调用逐条下发） */
  create(plan: TravelPlan): Promise<CloudWriteResult>;
  /** 更新计划本体（同样**不含明细**） */
  update(plan: TravelPlan): Promise<void>;
  /**
   * 删除计划。服务端会**级联删除该计划的全部明细**，因此返回被删明细数。
   *
   * ⚠️ 返回值不是 void：若云端明细过多、一次没删完，服务端会**拒绝删除计划**
   *（不删计划、不写墓碑）并返回可重试的失败（这里会抛出），重试即可接着删。
   * 这个异常必须抛出去、不能被吞掉 —— 吞掉就等于「计划没删但待同步标记被清」。
   */
  remove(clientId: string): Promise<{ removed: boolean; deletedItems: number }>;
}

/** 生产实现：委托给 uniCloud 调用层 */
export function createTravelPlanRemoteRepo(): TravelPlanRemoteRepo {
  return {
    list: () => listCloudTravelPlans(),
    create: (plan) => addCloudTravelPlan(plan),
    update: (plan) => updateCloudTravelPlan(plan),
    remove: (clientId) => removeCloudTravelPlan(clientId),
  };
}
