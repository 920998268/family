import type { WorkoutEntry } from '@/types/models';
import {
  addCloudWorkout,
  listCloudWorkouts,
  removeCloudWorkout,
  updateCloudWorkout,
  type CloudWriteResult,
} from '@/unicloud';

/** 运动记录的远端读写接口（力量 / 有氧共用一张表，见 DietRemoteRepo 的说明） */
export interface WorkoutRemoteRepo {
  listByDate(date: string): Promise<WorkoutEntry[]>;
  create(entry: WorkoutEntry): Promise<CloudWriteResult>;
  update(entry: WorkoutEntry): Promise<void>;
  /** 删除（服务端幂等）。`date` 可选，仅用于给墓碑兜底日期，见 DietRemoteRepo */
  remove(clientId: string, date?: string): Promise<void>;
}

/** 生产实现：委托给 uniCloud 调用层 */
export function createWorkoutRemoteRepo(): WorkoutRemoteRepo {
  return {
    listByDate: (date) => listCloudWorkouts(date),
    create: (entry) => addCloudWorkout(entry),
    update: (entry) => updateCloudWorkout(entry),
    remove: async (clientId, date) => {
      await removeCloudWorkout(clientId, date);
    },
  };
}
