import type { DietEntry, FavoriteFood } from '@/types/models';
import {
  addCloudDiet,
  listCloudDiets,
  listCloudFavoriteFoods,
  removeCloudDiet,
  removeCloudFavoriteFood,
  updateCloudDiet,
  type CloudWriteResult,
} from '@/unicloud';

/**
 * 饮食 / 常用食物的远端读写接口。
 *
 * 存在的意义有两个：
 * 1. 把「云函数名、错误文案、字段映射」全部挡在 `unicloud` 层，同步层只看见领域语义；
 * 2. 给同步层一个可注入的接缝 —— 单测用内存假实现，不需要 stub 全局 `uniCloud`。
 */
export interface DietRemoteRepo {
  /** 拉取某一天的饮食记录（云端为准） */
  listByDate(date: string): Promise<DietEntry[]>;
  /** 新增。返回 `duplicated` 表示服务端已存在同 clientId 记录（幂等命中） */
  create(entry: DietEntry): Promise<CloudWriteResult>;
  update(entry: DietEntry): Promise<void>;
  /** 删除。服务端幂等，记录不存在同样算成功 */
  remove(clientId: string): Promise<void>;
  listFavoriteFoods(keyword?: string): Promise<FavoriteFood[]>;
  removeFavoriteFood(name: string): Promise<void>;
}

/** 生产实现：委托给 uniCloud 调用层 */
export function createDietRemoteRepo(): DietRemoteRepo {
  return {
    listByDate: (date) => listCloudDiets(date),
    create: (entry) => addCloudDiet(entry),
    update: (entry) => updateCloudDiet(entry),
    remove: async (clientId) => {
      await removeCloudDiet(clientId);
    },
    listFavoriteFoods: (keyword) => listCloudFavoriteFoods(keyword),
    removeFavoriteFood: (name) => removeCloudFavoriteFood(name),
  };
}
