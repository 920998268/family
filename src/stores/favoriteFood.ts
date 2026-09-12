import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { FavoriteFood } from '@/types/models';
import { createFavoriteFoodService } from '@/services';
import { isCheckinCloudReady } from '@/services/checkinRuntime';

export const useFavoriteFoodStore = defineStore('favoriteFood', () => {
  const foods = ref<FavoriteFood[]>([]);
  const loading = ref(false);
  /** 是否成功拉取过一次（用于区分「还没拉」与「确实没有」） */
  const loaded = ref(false);

  /**
   * 拉取常用食物。
   *
   * 未登录 / 未加入家庭时直接清空返回 —— 此时云函数必然报错，
   * 没必要发这次请求（与打卡数据的「有门前置条件」保持一致）。
   */
  async function load(keyword?: string): Promise<void> {
    if (!isCheckinCloudReady()) {
      foods.value = [];
      return;
    }

    loading.value = true;
    try {
      foods.value = await createFavoriteFoodService().list(keyword);
      loaded.value = true;
    } catch (error) {
      // 常用食物是便利功能，拉不到就当没有，不打扰用户
      console.warn('[常用食物] 拉取失败:', error);
      foods.value = [];
    } finally {
      loading.value = false;
    }
  }

  /** 删除某个常用食物（用户手动清理噪音用） */
  async function remove(name: string): Promise<void> {
    if (!isCheckinCloudReady()) {
      return;
    }
    await createFavoriteFoodService().remove(name);
    await load();
  }

  return { foods, loading, loaded, load, remove };
});
