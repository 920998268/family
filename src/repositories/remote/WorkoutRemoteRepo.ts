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
  remove(clientId: string): Promise<void>;
}

/** 生产实现：委托给 uniCloud 调用层 */
export function createWorkoutRemoteRepo(): WorkoutRemoteRepo {
  return {
    listByDate: (date) => listCloudWorkouts(date),
    create: (entry) => addCloudWorkout(entry),
    update: (entry) => updateCloudWorkout(entry),
    remove: async (clientId) => {
      await removeCloudWorkout(clientId);
    },
  };
}
