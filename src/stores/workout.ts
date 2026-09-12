import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { WorkoutEntry } from '@/types/models';
import type { WorkoutDraft, WorkoutPatch } from '@/services/WorkoutService';
import { createWorkoutService, getCheckinSyncService } from '@/services';
import {
  flushPendingCheckins,
  isCheckinCloudReady,
  markCheckinDirty,
} from '@/services/checkinRuntime';

export const useWorkoutStore = defineStore('workout', () => {
  const entries = ref<WorkoutEntry[]>([]);
  const loadedDate = ref<string | null>(null);
  /** 正在从云端拉取（可用于展示刷新态） */
  const syncing = ref(false);

  /** 只读本地缓存并刷新列表（走 service，保证排序与页面一致） */
  function readLocal(date: string): void {
    entries.value = createWorkoutService().listByDate(date);
  }

  /**
   * 载入某日运动记录。
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
      await getCheckinSyncService().pullWorkouts(date);
      // 请求期间用户可能已切到别的日期：别用旧响应覆盖当前列表
      if (loadedDate.value === date) {
        readLocal(date);
      }
    } catch (error) {
      // 云端失败不影响本地使用（本地缓存已经渲染过了）
      console.warn('[运动] 云端拉取失败，保留本地缓存:', error);
    } finally {
      syncing.value = false;
    }
  }

  function add(date: string, draft: WorkoutDraft): WorkoutEntry {
    const entry = createWorkoutService().add(date, draft);
    readLocal(date);
    markCheckinDirty('workout', 'add', { id: entry.id, date });
    flushPendingCheckins();
    return entry;
  }

  function update(date: string, id: string, patch: WorkoutPatch): WorkoutEntry {
    const entry = createWorkoutService().update(date, id, patch);
    readLocal(date);
    markCheckinDirty('workout', 'update', { id, date });
    flushPendingCheckins();
    return entry;
  }

  function remove(date: string, id: string): void {
    createWorkoutService().remove(date, id);
    readLocal(date);
    markCheckinDirty('workout', 'remove', { id, date });
    flushPendingCheckins();
  }

  return {
    entries,
    loadedDate,
    syncing,
    load,
    syncFromCloud,
    add,
    update,
    remove,
  };
});
