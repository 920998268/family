import type { Transaction } from '@/types/models';
import { TRANSACTION_KEY_PREFIX, transactionKey } from '@/utils/storageKeys';
import { validateTransaction } from '@/utils/validation';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import { parseStoredArray } from './parse';

export class LedgerRepository {
  constructor(private readonly storage: StorageAdapter) {}

  getByDate(date: string): Transaction[] {
    return this.readByKey(transactionKey(date));
  }

  saveByDate(date: string, entries: Transaction[]): void {
    const key = transactionKey(date);
    if (entries.length === 0) {
      this.storage.removeItem(key);
      return;
    }
    this.storage.setItem(key, JSON.stringify(entries));
  }

  getAll(): Transaction[] {
    return this.storage
      .keys()
      .filter((key) => key.startsWith(TRANSACTION_KEY_PREFIX))
      .flatMap((key) => this.readByKey(key));
  }

  private readByKey(key: string): Transaction[] {
    return parseStoredArray(
      this.storage.getItem(key),
      (entry) => validateTransaction(entry).valid,
    );
  }
}
