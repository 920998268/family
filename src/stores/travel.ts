import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TravelPlan, TravelStatus } from '@/types/models';
import type { TravelPlanDraft, TravelPlanPatch } from '@/services/TravelService';
import { createTravelService, getCheckinSyncService } from '@/services';
import { computeItemDiff } from '@/utils/travel';
import {
  flushPendingCheckins,
  isCheckinCloudReady,
  markCheckinDirty,
} from '@/services/checkinRuntime';

/**
 * 家庭出行 store（M3 第 7 步接入云端）。
 *
 * ⚠️ 与其它同步 store 的**最大差别**：出行有**两个** domain 层次 ——
 * 计划本体（`travelPlan`，全量、不分日期）与行程明细（`travelItem`，
 * 云端独立集合 `travel_items`、有独立 `clientId`）。
 *
 * 因此：
 * - 读取是「全量计划 + 逐个计划拉明细」两条通路；
 * - 写入必须**记录级**下发 —— 表单一次提交整份明细，
 *   但绝不能整包覆盖云端（那是「后写者覆盖前写者」），
 *   而是用 `computeItemDiff` 拆成 add / update / remove 逐条 `markDirty`。
 *
 * 详尽设计见 `docs/0.3.5-m3-requirements-and-solution.md` §3.5。
 */
export const useTravelStore = defineStore('travel', () => {
  const plans = ref<TravelPlan[]>([]);
  const loaded = ref(false);
  /** 正在从云端拉取（可用于展示刷新态） */
  const syncing = ref(false);

  /** 只读本地缓存并刷新列表（走 service，保证排序与页面一致） */
  function readLocal(): void {
    plans.value = createTravelService().list();
  }

  /**
   * 载入全部出行计划。
   *
   * **本地优先**：先同步渲染本地缓存（秒开），云端拉取在后台进行。
   */
  function load(): void {
    loaded.value = true;
    readLocal();
    void syncFromCloud();
  }

  /**
   * 从云端拉取并合并。
   *
   * ⚠️ 两步，缺一不可：
   * 1. `pullTravelPlans()` 只拿**计划本体** —— 云端 `listPlans` 里的 `items`
   *    是「全家庭一次查、上限 500 条」的便捷聚合，会被截断，
   *    **不是明细的权威口径**（映射层已把它置空，免得被误当成「云端没有 ⇒ 被删」）；
   * 2. 再**逐个计划** `pullTravelItems(plan.id)` 才有完整明细。
   */
  async function syncFromCloud(): Promise<void> {
    if (!isCheckinCloudReady()) {
      return;
    }

    syncing.value = true;
    try {
      const sync = getCheckinSyncService();
      const merged = await sync.pullTravelPlans();
      for (const plan of merged) {
        await sync.pullTravelItems(plan.id);
      }
      readLocal();
    } catch (error) {
      // 云端失败不影响本地使用（本地缓存已经渲染过了）
      console.warn('[出行] 云端拉取失败，保留本地缓存:', error);
    } finally {
      syncing.value = false;
    }
  }

  function add(draft: TravelPlanDraft): TravelPlan {
    const plan = createTravelService().add(draft);
    readLocal();

    markCheckinDirty('travelPlan', 'add', { id: plan.id, date: '' });
    // 明细是独立实体，必须逐条登记 —— 只登记计划的话，明细永远上不了云
    for (const item of plan.items) {
      markCheckinDirty('travelItem', 'add', { id: item.id, date: '' });
    }

    flushPendingCheckins();
    return plan;
  }

  function update(id: string, patch: TravelPlanPatch): TravelPlan {
    const service = createTravelService();
    // ⚠️ 必须在**本地写入之前**取快照：写入之后 `before` 就变成提交后的值，diff 恒为空
    const before = service.list().find((plan) => plan.id === id)?.items ?? [];

    const plan = service.update(id, patch);
    readLocal();
    markCheckinDirty('travelPlan', 'update', { id, date: '' });

    // 明细逐条下发，而不是整包覆盖。
    // 用「写入前 / 写入后」两份快照做 diff：写入后那份带着本地最终 id，
    // 省掉了「自己先生成 id、再让 service 保留」的同步成本；
    // `patch.items` 未传时两份快照内容一致，diff 自然为空，不会产生多余标记。
    const diff = computeItemDiff(before, plan.items);
    for (const item of diff.added) {
      markCheckinDirty('travelItem', 'add', { id: item.id, date: '' });
    }
    for (const item of diff.updated) {
      markCheckinDirty('travelItem', 'update', { id: item.id, date: '' });
    }
    for (const itemId of diff.removed) {
      markCheckinDirty('travelItem', 'remove', { id: itemId, date: '' });
    }

    flushPendingCheckins();
    return plan;
  }

  /** 只改状态（不动明细，因此不会产生 travelItem 标记） */
  function setStatus(id: string, status: TravelStatus): TravelPlan {
    const plan = createTravelService().setStatus(id, status);
    readLocal();
    markCheckinDirty('travelPlan', 'update', { id, date: '' });
    flushPendingCheckins();
    return plan;
  }

  /**
   * 勾选 / 取消勾选一条行程明细。
   *
   * ⚠️ 这条路径**刻意不走队列**（与其他写操作不同）：
   * 队列的动作只有 add / update / remove，表达不了「翻转」，
   * 而翻转正是这个动作的意义（两端同时点同一条时「翻转」结果确定，
   * 「设值」则取决于谁后到，还可能覆盖掉对方的勾选）。
   *
   * 所以：在线时直连服务端翻转，并用返回的**权威值**校正本地；
   * 直连失败或未登录 / 未入家庭时，降级为排一条 `travelItem` update 标记，
   * 保证离线勾选下次联网仍能推上去（`pullTravelItems` 也会因为该标记
   * 而优先保留本地版本，不会被云端旧值覆盖回去）。
   */
  function toggleItem(planId: string, itemId: string): TravelPlan {
    const plan = createTravelService().toggleItem(planId, itemId);
    readLocal();
    void syncToggle(itemId);
    return plan;
  }

  async function syncToggle(itemId: string): Promise<void> {
    if (!isCheckinCloudReady()) {
      markCheckinDirty('travelItem', 'update', { id: itemId, date: '' });
      return;
    }

    const result = await getCheckinSyncService().toggleTravelItem(itemId);
    if (result.synced && typeof result.done === 'boolean') {
      // 用服务端的权威值校正本地那次乐观翻转
      createTravelService().setItemDone(itemId, result.done);
      readLocal();
    }
    // synced: false 时服务层已代为排好 update 标记，等常规 flush 推送
  }

  /**
   * 删除计划。
   *
   * 云端会**级联删除该计划的全部明细**并逐条写 `travelItem` 墓碑，
   * 所以这里不需要为明细登记 remove。
   *
   * ⚠️ 若此刻本地还留着该计划某条明细的待同步标记（例如刚加了一行还没推上去就删了整份计划），
   * 那条标记随后会因「找不到承载它的计划」被 `pushTravelItem` 判为 `skip` 并放弃 ——
   * 这正是期望行为（明细随计划一起消失），无需在这里额外清理。
   */
  function remove(id: string): void {
    createTravelService().remove(id);
    readLocal();
    markCheckinDirty('travelPlan', 'remove', { id, date: '' });
    flushPendingCheckins();
  }

  return {
    plans,
    loaded,
    syncing,
    load,
    syncFromCloud,
    add,
    update,
    setStatus,
    toggleItem,
    remove,
  };
});
