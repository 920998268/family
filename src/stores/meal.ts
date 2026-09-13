import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { MealPlan } from '@/types/models';
import type { MealPlanDraft, MealPlanPatch } from '@/services/MealService';
import { createMealService, getCheckinSyncService } from '@/services';
import {
  flushPendingCheckins,
  isCheckinCloudReady,
  markCheckinDirty,
} from '@/services/checkinRuntime';

/**
 * 家庭食谱 store（M3 第 7 步接入云端）。
 *
 * 结构与饮食 store 同构 —— 食谱**按日期**组织、读取也按日期，
 * 所以只有一条云端通路（`pullMealPlans(date)`）。
 *
 * 写入路径沿用「本地优先」三件套：
 * 先写本地让 UI 即时生效 → `markDirty()` 登记待同步 → 尝试重发。
 */
export const useMealStore = defineStore('meal', () => {
  const plans = ref<MealPlan[]>([]);
  const loadedDate = ref<string | null>(null);
  /** 正在从云端拉取（可用于展示刷新态） */
  const syncing = ref(false);

  /** 只读本地缓存并刷新列表（走 service，保证排序与页面一致） */
  function readLocal(date: string): void {
    plans.value = createMealService().listByDate(date);
  }

  /**
   * 载入某日食谱。
   *
   * **本地优先**：先同步渲染本地缓存（秒开），云端拉取在后台进行。
   * 签名保持同步返回，页面（`onShow` / 切换日期）无需改造。
   */
  function load(date: string): void {
    loadedDate.value = date;
    readLocal(date);
    void syncFromCloud(date);
  }

  /** 从云端拉取并与本地合并（由 `load` 后台调用，也可手动触发刷新） */
  async function syncFromCloud(date: string): Promise<void> {
    if (!isCheckinCloudReady()) {
      return;
    }

    syncing.value = true;
    try {
      await getCheckinSyncService().pullMealPlans(date);
      // 请求期间用户可能已切到别的日期：别用旧响应覆盖当前列表
      if (loadedDate.value === date) {
        readLocal(date);
      }
    } catch (error) {
      // 云端失败不影响本地使用（本地缓存已经渲染过了）
      console.warn('[食谱] 云端拉取失败，保留本地缓存:', error);
    } finally {
      syncing.value = false;
    }
  }

  function add(date: string, draft: MealPlanDraft): MealPlan {
    const plan = createMealService().add(date, draft);
    readLocal(date);
    // 标记里的 date 既用于日志排查，也会随墓碑下发给别的设备做分区提示
    markCheckinDirty('mealPlan', 'add', { id: plan.id, date });
    flushPendingCheckins();
    return plan;
  }

  function update(date: string, id: string, patch: MealPlanPatch): MealPlan {
    const plan = createMealService().update(date, id, patch);
    readLocal(date);
    // ⚠️ 页面的「勾选已执行」也走这条路径（`{ done: !plan.done }`）。
    // 食谱不像行程明细那样把 done 拆成独立实体 —— 整条记录本身就是一个幂等键，
    // 所以用 update 而不是「服务端翻转」，也不会产生额外的冲突面。
    markCheckinDirty('mealPlan', 'update', { id, date });
    flushPendingCheckins();
    return plan;
  }

  function remove(date: string, id: string): void {
    createMealService().remove(date, id);
    readLocal(date);
    // 云端按 clientId 删；`date` 仅在「记录已不存在」时给墓碑兜底一个分区提示
    markCheckinDirty('mealPlan', 'remove', { id, date });
    flushPendingCheckins();
  }

  function doneCount(date: string): number {
    return createMealService()
      .listByDate(date)
      .filter((plan) => plan.done).length;
  }

  return {
    plans,
    loadedDate,
    syncing,
    load,
    syncFromCloud,
    add,
    update,
    remove,
    doneCount,
  };
});
