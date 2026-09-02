import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { setStorageAdapter } from '@/storage';
import { useProfileStore } from '@/stores/profile';
import { useDietStore } from '@/stores/diet';
import { useWorkoutStore } from '@/stores/workout';
import { useFamilyStore } from '@/stores/family';
import { useStudyStore } from '@/stores/study';
import { useMealStore } from '@/stores/meal';
import { useTravelStore } from '@/stores/travel';
import { useLedgerStore } from '@/stores/ledger';
import { useBackupStore } from '@/stores/backup';
import type { Profile } from '@/types/models';

const profile: Profile = {
  name: '李四',
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

  it('manages family members through the store', () => {
    const store = useFamilyStore();
    store.load();
    expect(store.members).toHaveLength(0);

    const added = store.add({ name: '爸爸', role: 'parent', avatarColor: '#f97316' });
    expect(store.members).toHaveLength(1);
    expect(store.nameOf(added.id)).toBe('爸爸');

    store.update(added.id, { name: '老爸' });
    expect(store.nameOf(added.id)).toBe('老爸');

    store.remove(added.id);
    expect(store.members).toHaveLength(0);
  });

  it('manages study plans and daily check-ins through the store', () => {
    const store = useStudyStore();
    store.loadPlans();

    const plan = store.addPlan({
      title: '每天背单词',
      subject: '英语',
      frequency: 'daily',
      targetTimes: 1,
    });
    expect(store.plans).toHaveLength(1);

    store.checkin('2026-09-02', { planId: plan.id, note: '' });
    expect(store.hasChecked(plan.id)).toBe(true);

    store.removePlan(plan.id);
    expect(store.plans).toHaveLength(0);
  });

  it('manages meal plans and execution state through the store', () => {
    const store = useMealStore();
    store.load('2026-09-02');

    store.add('2026-09-02', {
      slot: 'lunch',
      dishName: '西红柿炒蛋',
      ingredients: '西红柿2个、鸡蛋3个',
      cook: '妈妈',
      done: false,
      note: '',
    });
    expect(store.plans).toHaveLength(1);

    store.update('2026-09-02', store.plans[0].id, { done: true });
    expect(store.plans[0].done).toBe(true);
    expect(store.doneCount('2026-09-02')).toBe(1);
  });

  it('manages travel plans through the store', () => {
    const store = useTravelStore();
    store.load();

    const plan = store.add({
      title: '国庆出游',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      destination: '云南大理',
      members: [],
      budget: 5000,
      status: 'planned',
      note: '',
      items: [{ time: '上午', activity: '游览洱海', note: '', done: false }],
    });
    expect(store.plans).toHaveLength(1);

    store.setStatus(plan.id, 'ongoing');
    expect(store.plans[0].status).toBe('ongoing');

    store.toggleItem(plan.id, plan.items[0].id);
    expect(store.plans[0].items[0].done).toBe(true);
  });

  it('manages ledger entries through the store', () => {
    const store = useLedgerStore();
    store.load('2026-09-02');

    store.add('2026-09-02', {
      type: 'expense',
      amount: 58.5,
      category: '餐饮',
      note: '买菜',
    });
    expect(store.entries).toHaveLength(1);

    store.update('2026-09-02', store.entries[0].id, { amount: 60 });
    expect(store.entries[0].amount).toBe(60);

    store.remove('2026-09-02', store.entries[0].id);
    expect(store.entries).toEqual([]);
  });

  it('exports and imports through the backup store', () => {
    const profileStore = useProfileStore();
    const dietStore = useDietStore();
    const familyStore = useFamilyStore();
    const backupStore = useBackupStore();

    profileStore.save(profile);
    dietStore.add('2026-09-02', {
      mealType: 'dinner',
      foodName: '三文鱼',
      quantity: '180g',
    });
    familyStore.add({ name: '妈妈', role: 'parent', avatarColor: '#0ea5e9' });

    const exported = backupStore.exportData();
    expect(exported.diet).toHaveLength(1);
    expect(exported.familyMembers).toHaveLength(1);

    setStorageAdapter(new InMemoryStorageAdapter());
    backupStore.importData(exported);

    const reloadedProfile = useProfileStore();
    const reloadedDiet = useDietStore();
    const reloadedFamily = useFamilyStore();
    reloadedProfile.load();
    reloadedDiet.load('2026-09-02');
    reloadedFamily.load();

    expect(reloadedProfile.profile).toEqual(profile);
    expect(reloadedDiet.entries).toHaveLength(1);
    expect(reloadedFamily.members).toHaveLength(1);
  });
});
