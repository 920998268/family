import type { StudyPlan } from '@/types/models';
import {
  addCloudStudyPlan,
  listCloudStudyPlans,
  removeCloudStudyPlan,
  updateCloudStudyPlan,
  type CloudWriteResult,
} from '@/unicloud';

/**
 * 学习计划的远端读写接口。
 *
 * ⚠️ 与饮食 / 运动的**最大差别**：学习计划**不分日期**，
 * `list()` 是**全量拉取**（本地仓储也是单键存全部计划），
 * 而不是像 `DietRemoteRepo.listByDate(date)` 那样按天取。
 * 所以同步服务的 `pullStudyPlans()` 没有 date 参数。
 */
export interface StudyPlanRemoteRepo {
  /** 拉取本家庭的**全部**学习计划 */
  list(): Promise<StudyPlan[]>;
  /** 新增。返回 `duplicated` 表示服务端已存在同 clientId 记录（幂等命中） */
  create(plan: StudyPlan): Promise<CloudWriteResult>;
  /** 更新（创建时间由服务端保留，不接受覆盖） */
  update(plan: StudyPlan): Promise<void>;
  /**
   * 删除。服务端会**级联删除该计划的全部打卡**，因此返回被删打卡数。
   *
   * ⚠️ 返回值不是 void：若云端历史打卡过多、一次没删完，服务端会**拒绝删除计划**
   * 并返回可重试的失败（抛异常），重试即可接着删。
   * 这里必须让异常抛出去，不能被吞掉 —— 吞掉就等于「计划没删但标记被清」。
   */
  remove(clientId: string): Promise<{ removed: boolean; deletedCheckins: number }>;
}

/** 生产实现：委托给 uniCloud 调用层 */
export function createStudyPlanRemoteRepo(): StudyPlanRemoteRepo {
  return {
    list: () => listCloudStudyPlans(),
    create: (plan) => addCloudStudyPlan(plan),
    update: (plan) => updateCloudStudyPlan(plan),
    remove: (clientId) => removeCloudStudyPlan(clientId),
  };
}
