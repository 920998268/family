import type { MealPlan } from '@/types/models';
import {
  addCloudMealPlan,
  listCloudMealPlans,
  removeCloudMealPlan,
  updateCloudMealPlan,
  type CloudWriteResult,
} from '@/unicloud';

/**
 * 食谱（`meal_plans`）的远端读写接口。
 *
 * 与 `DietRemoteRepo` 同构：**按日期读写**（`listByDate`），因为本地仓储
 * `MealPlanRepository` 就是按日期分键存储（`family.meal.v1.<date>`），
 * 食谱的读取口径天生是「某一天」。
 *
 * 与 `DietRemoteRepo` 的差别只有一处：**没有 `remove` 之外的附属接口**
 * （饮食那边还有常用食物）。食谱没有归属成员（前端 `MealPlan` 无 `memberId`，
 * 「掌勺人」是可自由填写的文本），所以也不需要在写库前做成员归属校验。
 */
export interface MealPlanRemoteRepo {
  /** 拉取某一天的食谱记录（云端为准） */
  listByDate(date: string): Promise<MealPlan[]>;
  /** 新增。返回 `duplicated` 表示服务端已存在同 clientId 记录（幂等命中） */
  create(plan: MealPlan): Promise<CloudWriteResult>;
  /**
   * 更新。**`date` 不可改**：前端 `MealPatch` 本就不含 `date`，
   * 云端 `mergeMealPatch` 也写死取既有记录的 `date` ——
   * 改了日期会让这条记录在按日期拉取时凭空消失（旧日期下拉不到、新日期下从没推过）。
   */
  update(plan: MealPlan): Promise<void>;
  /**
   * 删除。服务端幂等（记录不存在同样算成功）。
   *
   * `date` 可选，仅用于「记录已不存在」时给墓碑兜底一个日期
   * （让别的设备快速定位本地分区），不影响删除本身 —— 语义同 `DietRemoteRepo.remove`。
   */
  remove(clientId: string, date?: string): Promise<{ removed: boolean }>;
}

/** 生产实现：委托给 uniCloud 调用层 */
export function createMealPlanRemoteRepo(): MealPlanRemoteRepo {
  return {
    listByDate: (date) => listCloudMealPlans(date),
    create: (plan) => addCloudMealPlan(plan),
    update: (plan) => updateCloudMealPlan(plan),
    remove: (clientId, date) => removeCloudMealPlan(clientId, date),
  };
}
