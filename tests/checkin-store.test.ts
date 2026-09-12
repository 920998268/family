import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  pullDiets: vi.fn(),
  pullWorkouts: vi.fn(),
  flush: vi.fn(),
  markDirty: vi.fn(),
  pendingCount: vi.fn(),
}));

/**
 * 只替换同步服务的取用入口，其余（各 service 工厂）保持真实 ——
 * store 的本地路径必须跑真代码，否则测不出「本地优先」。
 */
vi.mock('@/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services')>();
  return {
    ...actual,
    getCheckinSyncService: () => ({
      pullDiets: mocks.pullDiets,
      pullWorkouts: mocks.pullWorkouts,
      flush: mocks.flush,
      markDirty: mocks.markDirty,
      pendingCount: mocks.pendingCount,
    }),
  };
});

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { getStorageAdapter, setStorageAdapter } from '@/storage';
import { DietRepository } from '@/repositories/DietRepository';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';
import { useAuthStore } from '@/stores/auth';
import { useDietStore } from '@/stores/diet';
import { useWorkoutStore } from '@/stores/workout';
import type { DietEntry, WorkoutEntry } from '@/types/models';

const DATE = '2026-09-12';
const NEXT_DATE = '2026-09-13';
const TOKEN_KEY = 'uni_id_token';

function dietEntry(id: string, date: string, foodName = '米饭'): DietEntry {
  return { id, date, mealType: 'lunch', foodName, quantity: '1碗' };
}

function workoutEntry(id: string, date: string): WorkoutEntry {
  return {
    id,
    date,
    category: 'strength',
    exerciseName: '卧推',
    sets: [{ id: `${id}-set-1`, order: 1, reps: 8, weightKg: 60 }],
  };
}

/** 云端地址栏：stub 全局 uni，token 决定 isLoggedIn */
function stubUni(token: string): void {
  (globalThis as any).uni = {
    getStorageSync: (key: string) => (key === TOKEN_KEY ? token : ''),
    setStorageSync: () => {},
    removeStorageSync: () => {},
  };
}

/** 模拟「已加入家庭」 */
function joinFamily(familyId = 'f-1'): void {
  useAuthStore().familyId = familyId;
}

beforeEach(() => {
  setStorageAdapter(new InMemoryStorageAdapter());
  setActivePinia(createPinia());
  stubUni('token-test');
  // 默认就是「已登录 + 已加入家庭」的正常态；需要测前置条件的用例各自退出
  joinFamily('f-1');

  mocks.pullDiets.mockReset().mockResolvedValue(undefined);
  mocks.pullWorkouts.mockReset().mockResolvedValue(undefined);
  mocks.flush.mockReset().mockResolvedValue({
    attempted: 0,
    succeeded: 0,
    failed: 0,
    dropped: 0,
  });
  mocks.markDirty.mockReset();
  mocks.pendingCount.mockReset().mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('store 读取：本地优先 + 云端合并', () => {
  it('load 先用本地缓存立即渲染，云端结果回来后刷新', async () => {
    const repository = new DietRepository(getStorageAdapter());
    repository.saveByDate(DATE, [dietEntry('local-1', DATE, '本地缓存')]);
    mocks.pullDiets.mockImplementation(async (date: string) => {
      repository.saveByDate(date, [dietEntry('local-1', date, '云端'), dietEntry('remote-1', date)]);
    });

    const store = useDietStore();
    store.load(DATE);

    // 同步阶段就已经有画面，不等云端（秒开）
    expect(store.entries.map((entry) => entry.id)).toEqual(['local-1']);
    expect(store.entries[0].foodName).toBe('本地缓存');

    await vi.waitFor(() => {
      expect(store.entries.map((entry) => entry.id)).toEqual(['local-1', 'remote-1']);
    });
    expect(mocks.pullDiets).toHaveBeenCalledWith(DATE);
  });

  it('云端失败时保留本地缓存，不把页面打空', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repository = new DietRepository(getStorageAdapter());
    repository.saveByDate(DATE, [dietEntry('local-1', DATE)]);
    mocks.pullDiets.mockRejectedValue(new Error('网络不可达'));

    const store = useDietStore();
    store.load(DATE);

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
    expect(store.entries.map((entry) => entry.id)).toEqual(['local-1']);
    expect(store.syncing).toBe(false);
  });

  it('云端响应回来时用户已切到别的日期：不覆盖当前列表', async () => {
    const repository = new DietRepository(getStorageAdapter());
    repository.saveByDate(DATE, [dietEntry('d12', DATE)]);
    repository.saveByDate(NEXT_DATE, [dietEntry('d13', NEXT_DATE)]);

    let releaseFirst: () => void = () => {};
    let calls = 0;
    mocks.pullDiets.mockImplementation(async (date: string) => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        // 12 号的云端结果此刻才回写本地
        repository.saveByDate(date, [dietEntry('from-cloud-12', date)]);
      }
    });

    const store = useDietStore();
    store.load(DATE);
    store.load(NEXT_DATE);
    await vi.waitFor(() => expect(calls).toBe(2));

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.loadedDate).toBe(NEXT_DATE);
    expect(store.entries.map((entry) => entry.id)).toEqual(['d13']);
  });

  it('运动 store 同样走本地优先 + 云端合并', async () => {
    const repository = new WorkoutRepository(getStorageAdapter());
    repository.saveByDate(DATE, [workoutEntry('local-w', DATE)]);
    mocks.pullWorkouts.mockImplementation(async (date: string) => {
      repository.saveByDate(date, [workoutEntry('local-w', date), workoutEntry('remote-w', date)]);
    });

    const store = useWorkoutStore();
    store.load(DATE);
    expect(store.entries).toHaveLength(1);

    await vi.waitFor(() => expect(store.entries).toHaveLength(2));
    expect(mocks.pullWorkouts).toHaveBeenCalledWith(DATE);
  });
});

describe('store 读取：云同步前置条件', () => {
  it('未登录时不发起云端拉取（本地照常显示）', async () => {
    // 必须在首次读取 isLoggedIn 之前改 token：computed 无响应式依赖，读过一次就定型
    stubUni('');
    const repository = new DietRepository(getStorageAdapter());
    repository.saveByDate(DATE, [dietEntry('local-1', DATE)]);

    const store = useDietStore();
    store.load(DATE);
    await Promise.resolve();

    expect(mocks.pullDiets).not.toHaveBeenCalled();
    expect(store.entries).toHaveLength(1);
  });

  it('已登录但未加入家庭时不发起云端拉取', async () => {
    joinFamily('');

    const store = useDietStore();
    store.load(DATE);
    await Promise.resolve();

    expect(mocks.pullDiets).not.toHaveBeenCalled();
  });

  it('已登录且已加入家庭时才拉取', async () => {
    const store = useWorkoutStore();
    store.load(DATE);

    await vi.waitFor(() => expect(mocks.pullWorkouts).toHaveBeenCalledWith(DATE));
  });
});

describe('store 写入：本地即时生效 + 登记待同步 + 尝试重发', () => {
  it('add 登记 add 动作并触发重发', () => {
    joinFamily();
    const store = useDietStore();
    store.load(DATE);

    const added = store.add(DATE, { mealType: 'lunch', foodName: '米饭', quantity: '1碗' });

    // 本地立即生效，不等云端
    expect(store.entries.map((entry) => entry.id)).toEqual([added.id]);
    expect(mocks.markDirty).toHaveBeenCalledWith('diet', 'add', { id: added.id, date: DATE });
    expect(mocks.flush).toHaveBeenCalled();
  });

  it('update / remove 登记对应动作', () => {
    joinFamily();
    const store = useWorkoutStore();
    store.load(DATE);
    const added = store.add(DATE, {
      exerciseName: '卧推',
      sets: [{ reps: 8, weightKg: 60 }],
    });
    mocks.markDirty.mockClear();

    store.update(DATE, added.id, { exerciseName: '上斜卧推' });
    expect(mocks.markDirty).toHaveBeenCalledWith('workout', 'update', {
      id: added.id,
      date: DATE,
    });

    mocks.markDirty.mockClear();
    store.remove(DATE, added.id);
    expect(mocks.markDirty).toHaveBeenCalledWith('workout', 'remove', {
      id: added.id,
      date: DATE,
    });
  });

  it('未登录时登记标记但**不**触发重发（标记留着，等条件具备再推）', () => {
    stubUni('');
    const store = useDietStore();
    store.load(DATE);

    const added = store.add(DATE, { mealType: 'lunch', foodName: '米饭', quantity: '1碗' });

    // 这一条是本步最关键的对称性：markDirty 无条件，flush 有前置条件。
    // 若 markDirty 也被门挡住，用户「先打卡、后加入家庭」的记录将永远不上云。
    expect(mocks.markDirty).toHaveBeenCalledWith('diet', 'add', { id: added.id, date: DATE });
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(store.entries).toHaveLength(1);
  });

  it('未加入家庭时同样只登记不重发', () => {
    joinFamily('');

    const store = useWorkoutStore();
    store.load(DATE);
    store.add(DATE, { exerciseName: '深蹲', sets: [{ reps: 10, weightKg: 60 }] });

    expect(mocks.markDirty).toHaveBeenCalled();
    expect(mocks.flush).not.toHaveBeenCalled();
  });
});

describe('生命周期接线（源码级守卫）', () => {
  const read = (relativePath: string) =>
    readFileSync(join(process.cwd(), relativePath), 'utf8');

  it('App.vue 回到前台时补传待同步', () => {
    const source = read('src/App.vue');

    expect(source).toContain('flushPendingCheckins');
    expect(source).toMatch(/onShow\(\(\) => \{[\s\S]{0,400}?flushPendingCheckins\(\)/);
  });

  it('两个打卡页进入时也会补传（App onShow 覆盖不到页面间跳转）', () => {
    for (const page of ['src/pages/checkin/diet.vue', 'src/pages/checkin/workout.vue']) {
      const source = read(page);
      expect(source, `${page} 未接入补传`).toContain('flushPendingCheckins');
      expect(source, `${page} 未在 onShow 中调用`).toMatch(
        /onShow\(\(\) => \{[\s\S]{0,400}?flushPendingCheckins\(\)/,
      );
    }
  });

  it('store 不直接引用裸 uniCloud（云调用一律经服务层）', () => {
    for (const store of ['src/stores/diet.ts', 'src/stores/workout.ts']) {
      const source = read(store);
      expect(/(^|[^.\w$])uniCloud\s*\./.test(source), `${store} 出现裸 uniCloud`).toBe(false);
    }
  });
});
