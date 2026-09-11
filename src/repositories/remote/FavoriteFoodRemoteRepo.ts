import type { FavoriteFood } from '@/types/models';
import { listCloudFavoriteFoods, removeCloudFavoriteFood } from '@/unicloud';

/**
 * 常用食物的远端读写接口。
 *
 * 注意：常用食物在云端由 `diet` 云函数托管（随饮食打卡自动沉淀），
 * 不是独立的云函数，所以这里仍然走 diet 的调用入口 —— 接口按领域拆分只是为了
 * 让上层不被「哪个云函数管哪张表」这件事污染。
 */
export interface FavoriteFoodRemoteRepo {
  /** 按使用次数降序列出常用食物，可按关键词模糊筛选 */
  list(keyword?: string): Promise<FavoriteFood[]>;
  /** 按名称删除（家庭内名称唯一） */
  remove(name: string): Promise<void>;
}

/** 生产实现：委托给 uniCloud 调用层 */
export function createFavoriteFoodRemoteRepo(): FavoriteFoodRemoteRepo {
  return {
    list: (keyword) => listCloudFavoriteFoods(keyword),
    remove: (name) => removeCloudFavoriteFood(name),
  };
}
