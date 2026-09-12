import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { DietRepository } from '@/repositories/DietRepository';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';
import { StudyPlanRepository } from '@/repositories/StudyPlanRepository';
import { StudyCheckinRepository } from '@/repositories/StudyCheckinRepository';
import type { DietRemoteRepo } from '@/repositories/remote/DietRemoteRepo';
import type { WorkoutRemoteRepo } from '@/repositories/remote/WorkoutRemoteRepo';
import type { StudyPlanRemoteRepo } from '@/repositories/remote/StudyPlanRemoteRepo';
import type { StudyCheckinRemoteRepo } from '@/repositories/remote/StudyCheckinRemoteRepo';
import type { TombstoneRemoteRepo } from '@/repositories/remote/TombstoneRemoteRepo';
import { CheckinSyncService } from '@/services/CheckinSyncService';
import { readPendingSync } from '@/utils/pendingSync';
import { readTombstoneCursor, type Tombstone } from '@/utils/tombstone';
import type { DietEntry, StudyCheckin, StudyPlan, WorkoutEntry } from '@/types/models';

const DATE = '2026-09-12';
const T1 = 1_700_000_000_000;
const T2 = 1_700_000_100_000;

function tombstone(overrides: Partial<Tombstone> = {}): Tombstone {
  return { domain: 'diet', clientId: 'diet-1', date: DATE, deletedAt: T1, ...overrides };
}

function dietEntry(overrides: Partial<DietEntry> = {}): DietEntry {
  return {
    id: 'diet-1',
    date: DATE,
    mealType: 'lunch',
    foodName: '鸡胸肉',
    quantity: '200g',
    ...overrides,
  };
}

function workoutEntry(overrides: Partial<WorkoutEntry> = {}): WorkoutEntry {
  return {
    id: 'workout-1',
    date: DATE,
    category: 'strength',
    exerciseName: '卧推',
    sets: [{ id: 'set-1', order: 1, reps: 8, weightKg: 60 }],
    ...overrides,
  };
}

function studyPlan(overrides: Partial<StudyPlan> = {}): StudyPlan {
  return {
    id: 'plan-1',
    title: '每天背单词',
    subject: '英语',
    frequency: 'daily',
    targetTimes: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function studyCheckin(overrides: Partial<StudyCheckin> = {}): StudyCheckin {
  return { id: 'checkin-1', planId: 'plan-1', date: DATE, note: '', ...overrides };
}

function noopRemote<T extends object>(extra: T) {
  return extra;
}

/** 构造带墓碑假实现的同步服务；`listAll` 按 since 过滤，模拟云端游标语义 */
function createHarness(tombstones: Tombstone[] = []) {
  const storage = new InMemoryStorageAdapter();
  const dietRepository = new DietRepository(storage);
  const workoutRepository = new WorkoutRepository(storage);
  const studyPlanRepository = new StudyPlanRepository(storage);
  const studyCheckinRepository = new StudyCheckinRepository(storage);

  const dietRemote = noopRemote<DietRemoteRepo>({
    listByDate: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 'doc-1' }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    listFavoriteFoods: vi.fn().mockResolvedValue([]),
    removeFavoriteFood: vi.fn().mockResolvedValue(undefined),
  });
  const workoutRemote = noopRemote<WorkoutRemoteRepo>({
    listByDate: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 'doc-2' }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  });
  const studyPlanRemote = noopRemote<StudyPlanRemoteRepo>({
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 'doc-3' }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue({ removed: true, deletedCheckins: 0 }),
  });
  const studyCheckinRemote = noopRemote<StudyCheckinRemoteRepo>({
    listByDate: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 'doc-4' }),
    remove: vi.fn().mockResolvedValue({ removed: true }),
  });

  const tombstoneRemote = noopRemote<TombstoneRemoteRepo>({
    listAll: vi
      .fn()
      .mockImplementation(async (since?: number) =>
        tombstones.filter((item) => item.deletedAt > (since ?? 0)),
      ),
  });

  const sync = new CheckinSyncService({
    storage,
    dietRepository,
    workoutRepository,
    studyPlanRepository,
    studyCheckinRepository,
    dietRemote,
    workoutRemote,
    studyPlanRemote,
    studyCheckinRemote,
    tombstoneRemote,
    now: () => T1,
  });

  return {
    storage,
    dietRepository,
    workoutRepository,
    studyPlanRepository,
    studyCheckinRepository,
    dietRemote,
    tombstoneRemote,
    sync,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('应用墓碑：删除本地记录', () => {
  it('墓碑命中 → 本地记录被删', async () => {
    const { sync, dietRepository } = createHarness([tombstone()]);
    dietRepository.saveByDate(DATE, [dietEntry()]);

    const summary = await sync.applyTombstones();

    expect(summary).toMatchObject({ fetched: 1, removed: 1 });
    expect(dietRepository.getByDate(DATE)).toEqual([]);
  });

  it('本地本来就没有这条 → 不计入 removed，也不产生多余写操作', async () => {
    const { sync, dietRepository } = createHarness([tombstone()]);
    dietRepository.saveByDate(DATE, [dietEntry({ id: 'other' })]);

    const summary = await sync.applyTombstones();

    expect(summary.removed).toBe(0);
    expect(dietRepository.getByDate(DATE)).toHaveLength(1);
  });

  it('只删被墓碑命中的那条，同日期其它记录保留', async () => {
    const { sync, dietRepository } = createHarness([tombstone({ clientId: 'diet-1' })]);
    dietRepository.saveByDate(DATE, [dietEntry({ id: 'diet-1' }), dietEntry({ id: 'diet-2' })]);

    await sync.applyTombstones();

    expect(dietRepository.getByDate(DATE).map((entry) => entry.id)).toEqual(['diet-2']);
  });

  it('记录被改到别的日期也能删掉（按 id 全量定位，不只信墓碑上的 date）', async () => {
    const { sync, dietRepository } = createHarness([tombstone({ date: '2026-01-01' })]);
    dietRepository.saveByDate(DATE, [dietEntry()]);

    const summary = await sync.applyTombstones();

    expect(summary.removed).toBe(1);
    expect(dietRepository.getByDate(DATE)).toEqual([]);
  });

  it('运动记录同样生效', async () => {
    const { sync, workoutRepository } = createHarness([
      tombstone({ domain: 'workout', clientId: 'workout-1' }),
    ]);
    workoutRepository.saveByDate(DATE, [workoutEntry()]);

    const summary = await sync.applyTombstones();

    expect(summary.removed).toBe(1);
    expect(workoutRepository.getByDate(DATE)).toEqual([]);
  });

  it('学习计划是全量存储，走单独分支', async () => {
    const { sync, studyPlanRepository } = createHarness([
      tombstone({ domain: 'studyPlan', clientId: 'plan-1', date: '' }),
    ]);
    studyPlanRepository.saveAll([studyPlan(), studyPlan({ id: 'plan-2' })]);

    const summary = await sync.applyTombstones();

    expect(summary.removed).toBe(1);
    expect(studyPlanRepository.getAll().map((plan) => plan.id)).toEqual(['plan-2']);
  });

  it('级联：计划与它的两条打卡一起被删（B 端不会留下孤儿打卡）', async () => {
    const { sync, studyPlanRepository, studyCheckinRepository } = createHarness([
      tombstone({ domain: 'studyPlan', clientId: 'plan-1', date: '' }),
      tombstone({ domain: 'studyCheckin', clientId: 'checkin-1' }),
      tombstone({ domain: 'studyCheckin', clientId: 'checkin-2', date: '2026-09-13' }),
    ]);
    studyPlanRepository.saveAll([studyPlan()]);
    studyCheckinRepository.saveByDate(DATE, [studyCheckin({ id: 'checkin-1' })]);
    // 刻意让「存储键的日期」与「记录自身的 date」不一致（脏数据），
    // 验证墓碑 date 的兜底作用 —— 只按记录 date 清会漏掉这一条
    studyCheckinRepository.saveByDate('2026-09-13', [studyCheckin({ id: 'checkin-2' })]);

    const summary = await sync.applyTombstones();

    expect(summary.removed).toBe(3);
    expect(studyPlanRepository.getAll()).toEqual([]);
    expect(studyCheckinRepository.getAll()).toEqual([]);
  });
});

describe('应用墓碑：删除优先', () => {
  it('被墓碑命中的记录，连同它的待同步标记一起清掉', async () => {
    const { sync, dietRepository, storage } = createHarness([tombstone()]);
    dietRepository.saveByDate(DATE, [dietEntry()]);
    sync.markDirty('diet', 'update', { id: 'diet-1', date: DATE });
    expect(sync.pendingCount()).toBe(1);

    await sync.applyTombstones();

    expect(dietRepository.getByDate(DATE)).toEqual([]);
    // 不清的话，push 的 add 分支会把记录重新建回云端 → A 端刚删又看到它
    expect(readPendingSync(storage)).toEqual([]);
  });

  it('本地没有记录但有待同步标记时，标记保持不动（不误清）', async () => {
    const { sync, storage } = createHarness([tombstone()]);
    sync.markDirty('diet', 'add', { id: 'diet-1', date: DATE });

    await sync.applyTombstones();

    expect(readPendingSync(storage)).toHaveLength(1);
  });
});

describe('应用墓碑：游标', () => {
  it('应用后游标推进到本批最大 deletedAt', async () => {
    const { sync, storage } = createHarness([tombstone({ deletedAt: T1 })]);

    const summary = await sync.applyTombstones();

    expect(summary.cursor).toBe(T1);
    expect(readTombstoneCursor(storage)).toBe(T1);
  });

  it('第二次拉取带上 since，已应用过的墓碑不会再来一遍', async () => {
    const { sync, tombstoneRemote } = createHarness([tombstone({ deletedAt: T1 })]);

    await sync.applyTombstones();
    await sync.applyTombstones();

    expect(tombstoneRemote.listAll).toHaveBeenNthCalledWith(1, 0);
    expect(tombstoneRemote.listAll).toHaveBeenNthCalledWith(2, T1);
  });

  it('新墓碑（deletedAt 更大）仍会被拉到', async () => {
    const { sync, dietRepository, tombstoneRemote } = createHarness();
    dietRepository.saveByDate(DATE, [dietEntry({ id: 'diet-1' }), dietEntry({ id: 'diet-2' })]);

    // 模拟「第二次才产生新墓碑」：每轮返回不同的一批
    const batches = [
      [tombstone({ clientId: 'diet-1', deletedAt: T1 })],
      [tombstone({ clientId: 'diet-2', deletedAt: T2 })],
    ];
    let call = 0;
    tombstoneRemote.listAll = vi.fn().mockImplementation(async (since?: number) => {
      const batch = batches[call] ?? [];
      call += 1;
      return batch.filter((item) => item.deletedAt > (since ?? 0));
    });

    const first = await sync.applyTombstones();
    const second = await sync.applyTombstones();

    expect(first.fetched).toBe(1);
    expect(second.fetched).toBe(1);
    expect(second.cursor).toBe(T2);
    expect(dietRepository.getByDate(DATE)).toEqual([]);
  });
});

describe('读取流程中的墓碑应用', () => {
  it('pull 前先应用墓碑：合并结果里不含被删记录，本地缓存也不含', async () => {
    const { sync, dietRepository } = createHarness([tombstone()]);
    dietRepository.saveByDate(DATE, [dietEntry(), dietEntry({ id: 'diet-2' })]);

    const merged = await sync.pullDiets(DATE);

    expect(merged.map((entry) => entry.id)).toEqual(['diet-2']);
    expect(dietRepository.getByDate(DATE).map((entry) => entry.id)).toEqual(['diet-2']);
  });

  it('从未上云的本地老记录不受影响（墓碑里没有它的 id）', async () => {
    const { sync, dietRepository } = createHarness([tombstone({ clientId: 'someone-else' })]);
    dietRepository.saveByDate(DATE, [dietEntry({ id: 'legacy-1' })]);

    const merged = await sync.pullDiets(DATE);

    expect(merged.map((entry) => entry.id)).toEqual(['legacy-1']);
  });

  it('墓碑拉取失败时降级：只告警，pull 仍然成功', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sync, dietRepository, tombstoneRemote } = createHarness();
    tombstoneRemote.listAll = vi.fn().mockRejectedValue(new Error('网络错误'));
    dietRepository.saveByDate(DATE, [dietEntry()]);

    const merged = await sync.pullDiets(DATE);

    expect(merged).toHaveLength(1);
    expect(console.warn).toHaveBeenCalled();
  });

  it('同一轮里多个 pull 共享一次墓碑拉取（并发去重）', async () => {
    const { sync, tombstoneRemote } = createHarness();

    await Promise.all([sync.pullDiets(DATE), sync.pullWorkouts(DATE)]);

    expect(tombstoneRemote.listAll).toHaveBeenCalledTimes(1);
  });
});
