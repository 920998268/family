import type { FavoriteFood } from '@/types/models';
import type { FavoriteFoodRemoteRepo } from '@/repositories/remote/FavoriteFoodRemoteRepo';

/**
 * 常用食物服务。
 *
 * 常用食物**只在云端沉淀**（随饮食打卡自动收集），因此这里不做本地缓存：
 * 它是一次性便利功能，没有离线可用的必要，做本地副本反而要处理
 * 「本地删了但云端还在」这类同步问题。离线时列表为空即可。
 */
export class FavoriteFoodService {
  constructor(private readonly remote: FavoriteFoodRemoteRepo) {}

  /** 列出常用食物（服务端按使用次数降序，可按关键词模糊筛选） */
  list(keyword?: string): Promise<FavoriteFood[]> {
    return this.remote.list(keyword);
  }

  /** 删除某个常用食物（家庭内按名称唯一） */
  async remove(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('缺少食物名称');
    }
    await this.remote.remove(trimmed);
  }
}
