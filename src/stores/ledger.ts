import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Transaction } from '@/types/models';
import type { TransactionDraft, TransactionPatch } from '@/services/LedgerService';
import { createLedgerService } from '@/services';

export const useLedgerStore = defineStore('ledger', () => {
  const entries = ref<Transaction[]>([]);
  const loadedDate = ref<string | null>(null);

  function load(date: string): void {
    entries.value = createLedgerService().listByDate(date);
    loadedDate.value = date;
  }

  function loadAll(): void {
    entries.value = createLedgerService().getAll();
    loadedDate.value = null;
  }

  function add(date: string, draft: TransactionDraft): Transaction {
    const entry = createLedgerService().add(date, draft);
    load(date);
    return entry;
  }

  function update(date: string, id: string, patch: TransactionPatch): Transaction {
    const entry = createLedgerService().update(date, id, patch);
    load(date);
    return entry;
  }

  function remove(date: string, id: string): void {
    createLedgerService().remove(date, id);
    load(date);
  }

  return {
    entries,
    loadedDate,
    load,
    loadAll,
    add,
    update,
    remove,
  };
});
