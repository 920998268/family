import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { WorkoutEntry } from '@/types/models';
import type { WorkoutDraft, WorkoutPatch } from '@/services/WorkoutService';
import { createWorkoutService } from '@/services';

export const useWorkoutStore = defineStore('workout', () => {
  const entries = ref<WorkoutEntry[]>([]);
  const loadedDate = ref<string | null>(null);

  function load(date: string): void {
    const service = createWorkoutService();
    entries.value = service.listByDate(date);
    loadedDate.value = date;
  }

  function add(date: string, draft: WorkoutDraft): WorkoutEntry {
    const service = createWorkoutService();
    const entry = service.add(date, draft);
    entries.value = service.listByDate(date);
    return entry;
  }

  function update(date: string, id: string, patch: WorkoutPatch): WorkoutEntry {
    const service = createWorkoutService();
    const entry = service.update(date, id, patch);
    entries.value = service.listByDate(date);
    return entry;
  }

  function remove(date: string, id: string): void {
    const service = createWorkoutService();
    service.remove(date, id);
    entries.value = service.listByDate(date);
  }

  return {
    entries,
    loadedDate,
    load,
    add,
    update,
    remove,
  };
});

