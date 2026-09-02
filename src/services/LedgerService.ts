import type { Transaction, TransactionType } from '@/types/models';
import { createId } from '@/utils/id';
import { validateTransaction } from '@/utils/validation';
import { LedgerRepository } from '@/repositories/LedgerRepository';

export type TransactionDraft = Omit<Transaction, 'id' | 'date'>;
export type TransactionPatch = Partial<Omit<Transaction, 'id' | 'date'>>;

export interface LedgerSummary {
  income: number;
  expense: number;
  balance: number;
}

function sumByType(entries: Transaction[], type: TransactionType): number {
  return entries
    .filter((entry) => entry.type === type)
    .reduce((total, entry) => total + entry.amount, 0);
}

export function summarize(entries: Transaction[]): LedgerSummary {
  const income = sumByType(entries, 'income');
  const expense = sumByType(entries, 'expense');
  return { income, expense, balance: income - expense };
}

export class LedgerService {
  constructor(private readonly repository: LedgerRepository) {}

  listByDate(date: string): Transaction[] {
    return [...this.repository.getByDate(date)].sort((a, b) =>
      b.id.localeCompare(a.id),
    );
  }

  getAll(): Transaction[] {
    return [...this.repository.getAll()].sort((a, b) =>
      b.id.localeCompare(a.id),
    );
  }

  listByMonth(month: string): Transaction[] {
    const prefix = `${month}-`;
    return this.getAll().filter((entry) => entry.date.startsWith(prefix));
  }

  summary(entries: Transaction[]): LedgerSummary {
    return summarize(entries);
  }

  add(date: string, draft: TransactionDraft): Transaction {
    const entry: Transaction = { ...draft, id: createId('txn'), date };
    const result = validateTransaction(entry);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    const entries = this.repository.getByDate(date);
    entries.push(entry);
    this.repository.saveByDate(date, entries);
    return entry;
  }

  update(date: string, id: string, patch: TransactionPatch): Transaction {
    const entries = this.repository.getByDate(date);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      throw new Error('未找到要编辑的收支记录');
    }

    const nextEntry: Transaction = { ...entries[index], ...patch, id, date };
    const result = validateTransaction(nextEntry);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    entries[index] = nextEntry;
    this.repository.saveByDate(date, entries);
    return nextEntry;
  }

  remove(date: string, id: string): void {
    const entries = this.repository.getByDate(date);
    const nextEntries = entries.filter((entry) => entry.id !== id);
    if (nextEntries.length === entries.length) {
      throw new Error('未找到要删除的收支记录');
    }
    this.repository.saveByDate(date, nextEntries);
  }
}
