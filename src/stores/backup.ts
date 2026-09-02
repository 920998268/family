import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { BackupPayload } from '@/types/models';
import { createBackupService } from '@/services';

export const useBackupStore = defineStore('backup', () => {
  const lastExport = ref<BackupPayload | null>(null);

  function exportData(): BackupPayload {
    const payload = createBackupService().export();
    lastExport.value = payload;
    return payload;
  }

  function importData(payload: BackupPayload): void {
    createBackupService().import(payload);
  }

  return {
    lastExport,
    exportData,
    importData,
  };
});

