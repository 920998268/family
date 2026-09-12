import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { getStorageAdapter, setStorageAdapter } from '@/storage';
import { readPendingSync } from '@/utils/pendingSync';
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
    // 无 token → 云同步前置条件不满足，store 走纯本地路径（本文件只验证本地行为）
    (globalThis as any).uni = {
      getStorageSync: () => '',
      setStorageSync: () => {},
      removeStorageSync: () => {},
    };
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

  it('饮食 / 运动写入后本地立即生效，并留下待同步标记', () => {
    const dietStore = useDietStore();
    dietStore.load('2026-09-02');
    const diet = dietStore.add('2026-09-02', {
      mealType: 'lunch',
      foodName: '牛肉面',
      quantity: '1碗',
    });
    // 本地优先：不等云端，store 里立刻就有
    expect(dietStore.entries.map((entry) => entry.id)).toEqual([diet.id]);

    const workoutStore = useWorkoutStore();
    workoutStore.load('2026-09-02');
    const workout = workoutStore.add('2026-09-02', {
      exerciseName: '快走',
      category: 'cardio',
      sets: [],
      durationMin: 40,
      distanceKm: 3.2,
    });
    expect(workoutStore.entries.map((entry) => entry.id)).toEqual([workout.id]);
    expect(workoutStore.entries[0].category).toBe('cardio');

    const pending = readPendingSync(getStorageAdapter());
    expect(pending).toHaveLength(2);
    expect(pending.map((item) => `${item.domain}:${item.op}`).sort()).toEqual([
      'diet:add',
      'workout:add',
    ]);
    expect(pending.map((item) => item.clientId).sort()).toEqual([diet.id, workout.id].sort());
  });

  it('待同步动作随写入合并：新增后编辑仍是 add，删除则转为 remove', () => {
    const store = useDietStore();
    store.load('2026-09-02');
    const added = store.add('2026-09-02', {
      mealType: 'dinner',
      foodName: '清蒸鱼',
      quantity: '1条',
    });

    store.update('2026-09-02', added.id, { quantity: '1条半' });
    // add 不被 update 顶掉：首次 add 的响应若丢失，改标 update 会让云端 404
    expect(readPendingSync(getStorageAdapter())).toHaveLength(1);
    expect(readPendingSync(getStorageAdapter())[0].op).toBe('add');

    store.remove('2026-09-02', added.id);
    const pending = readPendingSync(getStorageAdapter());
    expect(pending).toHaveLength(1);
    expect(pending[0].op).toBe('remove');
    expect(pending[0].clientId).toBe(added.id);
  });

  it('未登录时不触发任何云调用（标记照留，等条件具备再推）', () => {
    const store = useWorkoutStore();
    store.load('2026-09-02');
    const added = store.add('2026-09-02', {
      exerciseName: '深蹲',
      sets: [{ reps: 10, weightKg: 60 }],
    });

    // 无 token：云同步前置条件不满足，但本地写入与标记必须照常
    expect(store.entries).toHaveLength(1);
    expect(readPendingSync(getStorageAdapter())[0].clientId).toBe(added.id);
  });

  it('运动记录：有氧与力量分别按类型归一化形态', () => {
    const store = useWorkoutStore();
    store.load('2026-09-02');

    const cardio = store.add('2026-09-02', {
      exerciseName: '跑步',
      category: 'cardio',
      sets: [],
      durationMin: 30,
    });
    expect(cardio).toMatchObject({ category: 'cardio', sets: [], durationMin: 30 });
    expect(cardio.distanceKm).toBeUndefined();

    // 有氧切力量：组明细进来，有氧字段被清掉（与云端落库形态一致）
    const switched = store.update('2026-09-02', cardio.id, {
      category: 'strength',
      sets: [{ reps: 8, weightKg: 40 }],
    });
    expect(switched.category).toBe('strength');
    expect(switched.sets).toHaveLength(1);
    expect(switched.durationMin).toBeUndefined();
  });

  it('manages family members through the store', () => {
    const store = useFamilyStore();
    store.load();
    expect(store.members).toHaveLength(0);

    const added = store.add({ name: '爸爸', role: 'father', avatarColor: '#f97316' });
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
    familyStore.add({ name: '妈妈', role: 'mother', avatarColor: '#0ea5e9' });

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
