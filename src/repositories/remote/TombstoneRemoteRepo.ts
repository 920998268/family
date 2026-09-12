import type { Tombstone } from '@/utils/tombstone';
import {
  listCloudDietTombstones,
  listCloudStudyTombstones,
  listCloudWorkoutTombstones,
} from '@/unicloud';

/**
 * 墓碑（删除日志）的远端读取接口。
 *
 * 单独成一个仓储，而不是塞进 diet / workout / study 三个业务仓储 ——
 * 因为墓碑是**跨领域**的：一次同步要同时拿四个 domain 的删除日志，
 * 而 `study` 云函数一次就返回两类（计划 + 打卡），
 * 若分散在业务仓储里，同样的 study 墓碑会被重复拉两次。
 */
export interface TombstoneRemoteRepo {
  /**
   * 拉取全部领域的墓碑（内部聚合三个云函数）。
   *
   * ⚠️ 三个调用互相独立，采用「部分成功」策略：某一路失败不影响其它两路，
   * 只有**全部失败**才抛错。删除同步是增强能力，
   * 不该因为某一路网络抖动就让整个读取流程失败。
   */
  listAll(since?: number): Promise<Tombstone[]>;
}

/** 生产实现：委托给 uniCloud 调用层 */
export function createTombstoneRemoteRepo(): TombstoneRemoteRepo {
  return {
    listAll: async (since) => {
      const results = await Promise.allSettled([
        listCloudDietTombstones(since),
        listCloudWorkoutTombstones(since),
        listCloudStudyTombstones(since),
      ]);

      const items: Tombstone[] = [];
      const errors: unknown[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          items.push(...result.value);
        } else {
          errors.push(result.reason);
        }
      }

      if (errors.length === results.length) {
        throw errors[0];
      }
      if (errors.length > 0) {
        console.warn(
          `[同步] 墓碑拉取部分失败（${errors.length}/${results.length}），本轮只应用取回的部分：`,
          errors,
        );
      }

      return items;
    },
  };
}
