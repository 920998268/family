import { vi } from 'vitest';

import { MealPlanRepository } from '@/repositories/MealPlanRepository';
import { TravelRepository } from '@/repositories/TravelRepository';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import type { MealPlanRemoteRepo } from '@/repositories/remote/MealPlanRemoteRepo';
import type { TravelPlanRemoteRepo } from '@/repositories/remote/TravelPlanRemoteRepo';
import type { TravelItemRemoteRepo } from '@/repositories/remote/TravelItemRemoteRepo';

/**
 * M3 第 6 步给 `CheckinSyncService` 新增的五个依赖的**惰性实现**。
 *
 * 为什么单独抽一个文件：`CheckinSyncDeps` 现在有 14 个字段，
 * 三个同步测试（`checkin-sync` / `study-sync` / `tombstone-sync`）都要把它拼全，
 * 每个文件各抄一遍的话，下次再加 domain 就要改三处、且很容易漏。
 * 这里统一给「对既有用例无副作用」的默认值：
 * 仓储指向同一个内存适配器（但空），远端一律 resolve 空 / 成功。
 *
 * ⚠️ 默认值刻意做成「惰性」——不返回任何数据、也不断言任何调用。
 *    需要断言食谱 / 出行行为的用例请自行传入 spy 或直接读返回的对象。
 */
export interface MealTravelDeps {
  mealPlanRepository: MealPlanRepository;
  travelRepository: TravelRepository;
  mealPlanRemote: MealPlanRemoteRepo;
  travelPlanRemote: TravelPlanRemoteRepo;
  travelItemRemote: TravelItemRemoteRepo;
}

export function createInertMealTravelDeps(
  storage: StorageAdapter,
  /** 仅为让各测试文件的 mock `_id` 互不相同，便于排查；无功能含义 */
  prefix = 'mt',
): MealTravelDeps {
  const mealPlanRemote: MealPlanRemoteRepo = {
    listByDate: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: `${prefix}-meal` }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue({ removed: true }),
  };

  const travelPlanRemote: TravelPlanRemoteRepo = {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: `${prefix}-travel` }),
    update: vi.fn().mockResolvedValue(undefined),
    // removed + deletedItems：服务端级联删明细后一并返回
    remove: vi.fn().mockResolvedValue({ removed: true, deletedItems: 0 }),
  };

  const travelItemRemote: TravelItemRemoteRepo = {
    listByPlan: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: `${prefix}-item` }),
    update: vi.fn().mockResolvedValue(undefined),
    toggle: vi.fn().mockResolvedValue({ done: true }),
    remove: vi.fn().mockResolvedValue({ removed: true }),
  };

  return {
    mealPlanRepository: new MealPlanRepository(storage),
    travelRepository: new TravelRepository(storage),
    mealPlanRemote,
    travelPlanRemote,
    travelItemRemote,
  };
}
