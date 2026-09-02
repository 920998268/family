import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { DietEntry } from '@/types/models';
import type { DietDraft, DietPatch } from '@/services/DietService';
import { createDietService } from '@/services';

export const useDietStore = defineStore('diet', () => {
  const entries = ref<DietEntry[]>([]);
  const loadedDate = ref<string | null>(null);

  function load(date: string): void {
    entries.value = createDietService().listByDate(date);
    loadedDate.value = date;
  }

  function add(date: string, draft: DietDraft): DietEntry {
    const entry = createDietService().add(date, draft);
    entries.value = createDietService().listByDate(date);
    return entry;
  }

  function update(date: string, id: string, patch: DietPatch): DietEntry {
    const entry = createDietService().update(date, id, patch);
    entries.value = createDietService().listByDate(date);
    return entry;
  }

  function remove(date: string, id: string): void {
    createDietService().remove(date, id);
    entries.value = createDietService().listByDate(date);
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

