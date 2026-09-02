import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { setStorageAdapter } from '@/storage';
import { useProfileStore } from '@/stores/profile';
import { useDietStore } from '@/stores/diet';
import { useWorkoutStore } from '@/stores/workout';
import { useBackupStore } from '@/stores/backup';
import type { Profile } from '@/types/models';

const profile: Profile = {
  gender: 'female',
  birthDate: '1995-06-15',
  heightCm: 165,
  currentWeightKg: 58,
  targetWeightKg: 55,
};

describe('Pinia stores', () => {
  beforeEach(() => {
    setStorageAdapter(new InMemoryStorageAdapter());
    setActivePinia(createPinia());
  });

  it('persists and reloads the profile', () => {
    const store = useProfileStore();
    store.load();
    expect(store.hasProfile()).toBe(false);

    store.save(profile);
    store.load();
    expect(store.profile).toEqual(profile);
  });

  it('keeps diet state in sync with the repository', () => {
    const store = useDietStore();
    store.load('2026-09-02');

    const added = store.add('2026-09-02', {
      mealType: 'lunch',
      foodName: '牛肉面',
      quantity: '1碗',
    });
    expect(store.entries).toHaveLength(1);

    store.update('2026-09-02', added.id, { quantity: '1大碗' });
    expect(store.entries[0].quantity).toBe('1大碗');

    store.remove('2026-09-02', added.id);
    expect(store.entries).toEqual([]);
  });

  it('keeps workout state in sync with the repository', () => {
    const store = useWorkoutStore();
    store.load('2026-09-02');

    const added = store.add('2026-09-02', {
      exerciseName: '引体向上',
      sets: [
        { reps: 8, weightKg: 0 },
        { reps: 6, weightKg: 0 },
      ],
    });
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].sets).toHaveLength(2);

    store.update('2026-09-02', added.id, {
      exerciseName: '负重引体向上',
      sets: [{ reps: 5, weightKg: 10 }],
    });
    expect(store.entries[0].exerciseName).toBe('负重引体向上');
    expect(store.entries[0].sets).toHaveLength(1);
  });

  it('exports and imports through the backup store', () => {
    const profileStore = useProfileStore();
    const dietStore = useDietStore();
    const backupStore = useBackupStore();

    profileStore.save(profile);
    dietStore.add('2026-09-02', {
      mealType: 'dinner',
      foodName: '三文鱼',
      quantity: '180g',
    });

    const exported = backupStore.exportData();
    expect(exported.diet).toHaveLength(1);

    setStorageAdapter(new InMemoryStorageAdapter());
    backupStore.importData(exported);

    const reloadedProfile = useProfileStore();
    const reloadedDiet = useDietStore();
    reloadedProfile.load();
    reloadedDiet.load('2026-09-02');

    expect(reloadedProfile.profile).toEqual(profile);
    expect(reloadedDiet.entries).toHaveLength(1);
  });
});

