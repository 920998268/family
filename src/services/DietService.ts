import type { DietEntry, MealType } from '@/types/models';
import { MEAL_TYPES } from '@/types/models';
import { createId } from '@/utils/id';
import { validateDietEntry } from '@/utils/validation';
import { DietRepository } from '@/repositories/DietRepository';

export type DietDraft = Omit<DietEntry, 'id' | 'date'>;
export type DietPatch = Partial<Omit<DietEntry, 'id' | 'date'>>;

const mealOrder = new Map(MEAL_TYPES.map((item, index) => [item.value, index]));

function sortByMeal(entries: DietEntry[]): DietEntry[] {
  return [...entries].sort((a, b) => {
    const aOrder = mealOrder.get(a.mealType as MealType) ?? 0;
    const bOrder = mealOrder.get(b.mealType as MealType) ?? 0;
    return aOrder - bOrder;
  });
}

export class DietService {
  constructor(private readonly repository: DietRepository) {}

  listByDate(date: string): DietEntry[] {
    return sortByMeal(this.repository.getByDate(date));
  }

  getAll(): DietEntry[] {
    return sortByMeal(this.repository.getAll());
  }

  add(date: string, draft: DietDraft): DietEntry {
    const entry: DietEntry = {
      ...draft,
      id: createId('diet'),
      date,
    };
    const result = validateDietEntry(entry);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    const entries = this.repository.getByDate(date);
    entries.push(entry);
    this.repository.saveByDate(date, entries);
    return entry;
  }

  update(date: string, id: string, patch: DietPatch): DietEntry {
    const entries = this.repository.getByDate(date);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      throw new Error('未找到要编辑的饮食记录');
    }

    const nextEntry: DietEntry = {
      ...entries[index],
      ...patch,
      id,
      date,
    };
    const result = validateDietEntry(nextEntry);
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
      throw new Error('未找到要删除的饮食记录');
    }

    this.repository.saveByDate(date, nextEntries);
  }
}

