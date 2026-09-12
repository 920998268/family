import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { StudyCheckin, StudyPlan } from '@/types/models';
import type {
  StudyCheckinDraft,
  StudyPlanDraft,
  StudyPlanPatch,
} from '@/services/StudyService';
import { createStudyService, getCheckinSyncService } from '@/services';
import {
  flushPendingCheckins,
  isCheckinCloudReady,
  markCheckinDirty,
} from '@/services/checkinRuntime';

/**
 * 学习计划与打卡 store。
 *
 * ⚠️ 与饮食 / 运动 store 的**结构差异**：学习有**两个**实体 ——
 * 计划是**全量列表**（不分日期），打卡才按日期。所以这里有两条独立的读取路径，
 * 云端拉取也是两条（`pullStudyPlans()` + `pullStudyCheckins(date)`），
 * 而饮食 / 运动只需要一条按日期的通路。
 *
 * 写入路径与饮食 / 运动一致：**本地优先** —— 先写本地让 UI 即时生效，
 * 再 `markDirty()` 登记待同步并尝试推送。
 */
export const useStudyStore = defineStore('study', () => {
  const plans = ref<StudyPlan[]>([]);
  const checkins = ref<StudyCheckin[]>([]);
  const loadedDate = ref<string | null>(null);
  /** 正在从云端拉取（可用于展示刷新态） */
  const syncing = ref(false);

  /** 只读本地缓存并刷新计划列表 */
  function loadPlans(): void {
    plans.value = createStudyService().listPlans();
  }

  /** 只读本地缓存并刷新某日打卡列表 */
  function loadCheckins(date: string): void {
    checkins.value = createStudyService().listCheckinsByDate(date);
    loadedDate.value = date;
  }

  /**
   * 载入某日学习数据（全部计划 + 该日打卡）。
   *
   * **本地优先**：先同步渲染本地缓存（秒开），云端拉取在后台进行。
   * 签名保持同步返回，页面（`onShow`）只需调用这一个入口。
   */
  function load(date: string): void {
    loadPlans();
    loadCheckins(date);
    void syncFromCloud(date);
  }

  /** 从云端拉取并与本地合并（计划全量 + 该日打卡）；失败不影响本地画面 */
  async function syncFromCloud(date: string): Promise<void> {
    if (!isCheckinCloudReady()) {
      return;
    }

    syncing.value = true;
    try {
      await getCheckinSyncService().pullStudyPlans();
      await getCheckinSyncService().pullStudyCheckins(date);
      // 计划不分日期，直接刷新；
      // 打卡要防「请求期间用户已切到别的日期」——别用旧响应覆盖当前列表
      loadPlans();
      if (loadedDate.value === date) {
        loadCheckins(date);
      }
    } catch (error) {
      // 云端失败不影响本地使用（本地缓存已经渲染过了）
      console.warn('[学习] 云端拉取失败，保留本地缓存:', error);
    } finally {
      syncing.value = false;
    }
  }

  function addPlan(draft: StudyPlanDraft): StudyPlan {
    const plan = createStudyService().addPlan(draft);
    loadPlans();
    // 计划不分日期，标记里的 date 传空串（该字段仅用于日志与快速定位，同步定位只认 id）
    markCheckinDirty('studyPlan', 'add', { id: plan.id, date: '' });
    flushPendingCheckins();
    return plan;
  }

  function updatePlan(id: string, patch: StudyPlanPatch): StudyPlan {
    const plan = createStudyService().updatePlan(id, patch);
    loadPlans();
    markCheckinDirty('studyPlan', 'update', { id, date: '' });
    flushPendingCheckins();
    return plan;
  }

  function removePlan(id: string): void {
    // 本地会**级联删除**该计划的全部打卡（StudyService.removePlan），
    // 所以下面的打卡列表要一起刷新，否则页面上会残留已失效的打卡状态。
    createStudyService().removePlan(id);
    loadPlans();
    if (loadedDate.value) {
      loadCheckins(loadedDate.value);
    }
    // 云端由 study 云函数级联删除打卡，这里只需登记计划本身的删除
    markCheckinDirty('studyPlan', 'remove', { id, date: '' });
    flushPendingCheckins();
  }

  function checkin(date: string, draft: StudyCheckinDraft): StudyCheckin {
    const checkin = createStudyService().checkin(
      date,
      draft.planId,
      draft.note,
      draft.memberId,
    );
    loadCheckins(date);
    markCheckinDirty('studyCheckin', 'add', { id: checkin.id, date });
    flushPendingCheckins();
    return checkin;
  }

  function removeCheckin(date: string, id: string): void {
    createStudyService().removeCheckin(date, id);
    loadCheckins(date);
    markCheckinDirty('studyCheckin', 'remove', { id, date });
    flushPendingCheckins();
  }

  function hasChecked(planId: string): boolean {
    return checkins.value.some((checkin) => checkin.planId === planId);
  }

  return {
    plans,
    checkins,
    loadedDate,
    syncing,
    load,
    loadPlans,
    loadCheckins,
    syncFromCloud,
    addPlan,
    updatePlan,
    removePlan,
    checkin,
    removeCheckin,
    hasChecked,
  };
});
