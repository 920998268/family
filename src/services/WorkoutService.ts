import type { WorkoutEntry, WorkoutSet } from '@/types/models';
import { createId } from '@/utils/id';
import { validateWorkoutEntry } from '@/utils/validation';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';

export type WorkoutSetDraft = Omit<WorkoutSet, 'id' | 'order'>;
export type WorkoutDraft = {
  exerciseName: string;
  sets: WorkoutSetDraft[];
};
export type WorkoutPatch = Partial<WorkoutDraft>;

export class WorkoutService {
  constructor(private readonly repository: WorkoutRepository) {}

  listByDate(date: string): WorkoutEntry[] {
    return this.repository.getByDate(date);
  }

  getAll(): WorkoutEntry[] {
    return this.repository.getAll();
  }

  add(date: string, draft: WorkoutDraft): WorkoutEntry {
    const entry: WorkoutEntry = {
      id: createId('workout'),
      date,
      exerciseName: draft.exerciseName,
      sets: normalizeSets(draft.sets),
    };
    const result = validateWorkoutEntry(entry);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    const entries = this.repository.getByDate(date);
    entries.push(entry);
    this.repository.saveByDate(date, entries);
    return entry;
  }

  update(date: string, id: string, patch: WorkoutPatch): WorkoutEntry {
    const entries = this.repository.getByDate(date);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      throw new Error('未找到要编辑的训练记录');
    }

    const existing = entries[index];
    const nextEntry: WorkoutEntry = {
      ...existing,
      ...patch,
      id,
      date,
      sets: patch.sets ? normalizeSets(patch.sets) : existing.sets,
    };
    const result = validateWorkoutEntry(nextEntry);
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
      throw new Error('未找到要删除的训练记录');
    }

    this.repository.saveByDate(date, nextEntries);
  }
}

function normalizeSets(sets: WorkoutSetDraft[]): WorkoutSet[] {
  return sets.map((set, index) => ({
    id: createId('set'),
    order: index + 1,
    reps: set.reps,
    weightKg: set.weightKg,
  }));
}

