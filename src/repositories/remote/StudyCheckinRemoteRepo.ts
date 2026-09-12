import type { StudyCheckin } from '@/types/models';
import {
  addCloudStudyCheckin,
  listCloudStudyCheckins,
  removeCloudStudyCheckin,
  type CloudWriteResult,
} from '@/unicloud';

/**
 * 学习打卡的远端读写接口。
 *
 * ⚠️ **没有 `update`**：与本地 `StudyService` 一致 —— 学习打卡只有
 * 「打卡 / 取消打卡」两个动作，备注与日期不支持事后编辑。
 * 同步层因此也不该为打卡登记 `update` 动作。
 */
export interface StudyCheckinRemoteRepo {
  /** 拉取某一天的学习打卡（打卡按日期组织） */
  listByDate(date: string): Promise<StudyCheckin[]>;
  /**
   * 新增打卡。
   *
   * 服务端有两条幂等保护：同 clientId 重复投递、以及
   * **同一计划同一天只能打卡一次**（唯一索引 `familyId + planId + date` 兜底），
   * 两者都返回 `duplicated: true` 而不是报错。
   */
  create(checkin: StudyCheckin): Promise<CloudWriteResult>;
  /** 删除（服务端幂等：不存在也返回成功） */
  remove(clientId: string): Promise<{ removed: boolean }>;
}

/** 生产实现：委托给 uniCloud 调用层 */
export function createStudyCheckinRemoteRepo(): StudyCheckinRemoteRepo {
  return {
    listByDate: (date) => listCloudStudyCheckins(date),
    create: (checkin) => addCloudStudyCheckin(checkin),
    remove: (clientId) => removeCloudStudyCheckin(clientId),
  };
}
