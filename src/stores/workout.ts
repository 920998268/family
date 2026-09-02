import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { WorkoutEntry } from '@/types/models';
import type { WorkoutDraft, WorkoutPatch } from '@/services/WorkoutService';
import { createWorkoutService } from '@/services';

export const useWorkoutStore = defineStore('workout', () => {
  const entries = ref<WorkoutEntry[]>([]);
  const loadedDate = ref<string | null>(null);

  function load(date: string): void {
    entries.value = createWorkoutService().listByDate(date);
    loadedDate.value = date;
  }

  function add(date: string, draft: WorkoutDraft): WorkoutEntry {
    const entry = createWorkoutService().add(date, draft);
    entries.value = createWorkoutService().listByDate(date);
    return entry;
  }

  function update(date: string, id: string, patch: WorkoutPatch): WorkoutEntry {
    const entry = createWorkoutService().update(date, id, patch);
    entries.value = createWorkoutService().listByDate(date);
    return entry;
  }

  function remove(date: string, id: string): void {
    createWorkoutService().remove(date, id);
    entries.value = createWorkoutService().listByDate(date);
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

