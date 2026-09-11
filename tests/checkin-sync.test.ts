import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { DietRepository } from '@/repositories/DietRepository';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';
import type { DietRemoteRepo } from '@/repositories/remote/DietRemoteRepo';
import type { WorkoutRemoteRepo } from '@/repositories/remote/WorkoutRemoteRepo';
import { CheckinSyncService } from '@/services/CheckinSyncService';
import { MAX_SYNC_ATTEMPTS, readPendingSync } from '@/utils/pendingSync';
import type { DietEntry, WorkoutEntry } from '@/types/models';

const DATE = '2026-09-12';

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

function createDietRemote(): DietRemoteRepo {
  return {
    listByDate: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 'doc-1' }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    listFavoriteFoods: vi.fn().mockResolvedValue([]),
    removeFavoriteFood: vi.fn().mockResolvedValue(undefined),
  };
}

function createWorkoutRemote(): WorkoutRemoteRepo {
  return {
    listByDate: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 'doc-2' }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function createHarness() {
  const storage = new InMemoryStorageAdapter();
  const dietRepository = new DietRepository(storage);
  const workoutRepository = new WorkoutRepository(storage);
  const dietRemote = createDietRemote();
  const workoutRemote = createWorkoutRemote();

  // 单调递增的时钟，便于断言 queuedAt 的代次变化
  let clock = 1000;
  const sync = new CheckinSyncService({
    storage,
    dietRepository,
    workoutRepository,
    dietRemote,
    workoutRemote,
    now: () => (clock += 1),
  });

  return { storage, dietRepository, workoutRepository, dietRemote, workoutRemote, sync };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('markDirty / pendingCount', () => {
  it('本地写入后登记待同步', () => {
    const { sync, storage } = createHarness();

    sync.markDirty('diet', 'add', { id: 'diet-1', date: DATE });

    expect(sync.pendingCount()).toBe(1);
    expect(readPendingSync(storage)[0]).toMatchObject({
      domain: 'diet',
      clientId: 'diet-1',
      op: 'add',
      date: DATE,
    });
  });

  it('同一记录连续写入只留一条待同步', () => {
    const { sync, storage } = createHarness();

    sync.markDirty('diet', 'add', { id: 'diet-1', date: DATE });
    sync.markDirty('diet', 'update', { id: 'diet-1', date: DATE });

    expect(sync.pendingCount()).toBe(1);
    // add 不被 update 顶掉：首次 add 的响应若丢失，update 会让云端 404
    expect(readPendingSync(storage)[0].op).toBe('add');
  });
});

describe('pullDiets / pullWorkouts（云端为准 + 本地兜底）', () => {
  it('把云端记录合并回本地缓存并返回合并结果', async () => {
    const { sync, dietRepository, dietRemote } = createHarness();
    dietRepository.saveByDate(DATE, [dietEntry({ id: 'local-1', foodName: '本地' })]);
    vi.mocked(dietRemote.listByDate).mockResolvedValue([
      dietEntry({ id: 'local-1', foodName: '云端' }),
      dietEntry({ id: 'remote-1', foodName: '别人加的' }),
    ]);

    const merged = await sync.pullDiets(DATE);

    expect(merged.map((entry) => entry.id)).toEqual(['local-1', 'remote-1']);
    expect(merged[0].foodName).toBe('云端');
    // 回写本地缓存（下次进页面秒开用的是它）
    expect(dietRepository.getByDate(DATE).map((entry) => entry.id)).toEqual([
      'local-1',
      'remote-1',
    ]);
  });

  it('不覆盖有待同步修改的本地记录（否则用户刚改的内容会自己变回去）', async () => {
    const { sync, dietRepository, dietRemote } = createHarness();
    dietRepository.saveByDate(DATE, [dietEntry({ id: 'diet-1', foodName: '本地新值' })]);
    sync.markDirty('diet', 'update', { id: 'diet-1', date: DATE });
    vi.mocked(dietRemote.listByDate).mockResolvedValue([
      dietEntry({ id: 'diet-1', foodName: '云端旧值' }),
    ]);

    const merged = await sync.pullDiets(DATE);

    expect(merged[0].foodName).toBe('本地新值');
    expect(dietRepository.getByDate(DATE)[0].foodName).toBe('本地新值');
  });

  it('云端记录拉到本地后，同一天其它记录不受影响', async () => {
    const { sync, dietRepository, dietRemote } = createHarness();
    dietRepository.saveByDate('2026-09-11', [dietEntry({ id: 'other', date: '2026-09-11' })]);
    vi.mocked(dietRemote.listByDate).mockResolvedValue([dietEntry({ id: 'remote-1' })]);

    await sync.pullDiets(DATE);

    expect(dietRepository.getByDate('2026-09-11').map((e) => e.id)).toEqual(['other']);
  });

  it('云端失败时异常向上抛，由调用方保留本地画面', async () => {
    const { sync, dietRepository, dietRemote } = createHarness();
    dietRepository.saveByDate(DATE, [dietEntry()]);
    vi.mocked(dietRemote.listByDate).mockRejectedValue(new Error('网络不可达'));

    await expect(sync.pullDiets(DATE)).rejects.toThrow('网络不可达');
    // 本地缓存没有被清掉
    expect(dietRepository.getByDate(DATE)).toHaveLength(1);
  });

  it('运动记录同样走合并（力量 / 有氧共用一条通路）', async () => {
    const { sync, workoutRepository, workoutRemote } = createHarness();
    workoutRepository.saveByDate(DATE, [workoutEntry({ id: 'local-w' })]);
    vi.mocked(workoutRemote.listByDate).mockResolvedValue([
      workoutEntry({ id: 'local-w', exerciseName: '云端卧推' }),
      workoutEntry({
        id: 'remote-w',
        category: 'cardio',
        exerciseName: '跑步',
        sets: [],
        durationMin: 30,
      }),
    ]);

    const merged = await sync.pullWorkouts(DATE);

    expect(merged.map((entry) => entry.id)).toEqual(['local-w', 'remote-w']);
    expect(merged[0].exerciseName).toBe('云端卧推');
    expect(workoutRepository.getByDate(DATE)).toHaveLength(2);
  });
});

describe('flush（重发待同步）', () => {
  it('没有待同步条目时返回全 0', async () => {
    const { sync } = createHarness();

    await expect(sync.flush()).resolves.toEqual({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      dropped: 0,
    });
  });

  it('add 成功后出队', async () => {
    const { sync, dietRepository, dietRemote } = createHarness();
    const entry = dietEntry();
    dietRepository.saveByDate(DATE, [entry]);
    sync.markDirty('diet', 'add', { id: entry.id, date: DATE });

    await expect(sync.flush()).resolves.toEqual({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      dropped: 0,
    });

    expect(dietRemote.create).toHaveBeenCalledWith(entry);
    expect(sync.pendingCount()).toBe(0);
  });

  it('add 命中 duplicated 时补一次 update（否则首次 add 之后的编辑永远停在云端旧版本）', async () => {
    const { sync, dietRepository, dietRemote } = createHarness();
    const entry = dietEntry({ foodName: '改过的名字' });
    dietRepository.saveByDate(DATE, [entry]);
    sync.markDirty('diet', 'add', { id: entry.id, date: DATE });
    vi.mocked(dietRemote.create).mockResolvedValue({ _id: 'doc-1', duplicated: true });

    const summary = await sync.flush();

    expect(dietRemote.create).toHaveBeenCalledWith(entry);
    expect(dietRemote.update).toHaveBeenCalledWith(entry);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('duplicated 为假时不补 update（省一次网络往返）', async () => {
    const { sync, dietRepository, dietRemote } = createHarness();
    const entry = dietEntry();
    dietRepository.saveByDate(DATE, [entry]);
    sync.markDirty('diet', 'add', { id: entry.id, date: DATE });

    await sync.flush();

    expect(dietRemote.update).not.toHaveBeenCalled();
  });

  it('update 直接推送当前本地内容', async () => {
    const { sync, dietRepository, dietRemote } = createHarness();
    const entry = dietEntry({ quantity: '300g' });
    dietRepository.saveByDate(DATE, [entry]);
    sync.markDirty('diet', 'update', { id: entry.id, date: DATE });

    await sync.flush();

    expect(dietRemote.update).toHaveBeenCalledWith(entry);
    expect(dietRemote.create).not.toHaveBeenCalled();
  });

  it('remove 不需要本地记录，直接按 clientId 推送', async () => {
    const { sync, dietRemote } = createHarness();
    sync.markDirty('diet', 'remove', { id: 'diet-gone', date: DATE });

    const summary = await sync.flush();

    expect(dietRemote.remove).toHaveBeenCalledWith('diet-gone');
    expect(summary.succeeded).toBe(1);
    expect(sync.pendingCount()).toBe(0);
  });

  it('运动记录走 workout 远端', async () => {
    const { sync, workoutRepository, workoutRemote, dietRemote } = createHarness();
    const entry = workoutEntry();
    workoutRepository.saveByDate(DATE, [entry]);
    sync.markDirty('workout', 'add', { id: entry.id, date: DATE });

    await sync.flush();

    expect(workoutRemote.create).toHaveBeenCalledWith(entry);
    expect(dietRemote.create).not.toHaveBeenCalled();
    expect(sync.pendingCount()).toBe(0);
  });

  it('记录被改到别的日期后仍能按兜底查询找到并推送', async () => {
    const { sync, dietRepository, dietRemote } = createHarness();
    const entry = dietEntry({ date: '2026-09-13' });
    dietRepository.saveByDate('2026-09-13', [entry]);
    // 标记里记的还是旧日期
    sync.markDirty('diet', 'add', { id: entry.id, date: DATE });

    await sync.flush();

    expect(dietRemote.create).toHaveBeenCalledWith(entry);
  });
});

describe('flush：失败与放弃', () => {
  it('失败后保留标记并累加次数', async () => {
    const { sync, dietRepository, dietRemote, storage } = createHarness();
    const entry = dietEntry();
    dietRepository.saveByDate(DATE, [entry]);
    sync.markDirty('diet', 'add', { id: entry.id, date: DATE });
    vi.mocked(dietRemote.create).mockRejectedValue(new Error('网络不可达'));

    const summary = await sync.flush();

    expect(summary).toEqual({ attempted: 1, succeeded: 0, failed: 1, dropped: 0 });
    const item = readPendingSync(storage)[0];
    expect(item.attempts).toBe(1);
    expect(item.lastError).toBe('网络不可达');
  });

  it('连续失败达上限后丢弃并告警（避免无限重试）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sync, dietRepository, dietRemote } = createHarness();
    const entry = dietEntry();
    dietRepository.saveByDate(DATE, [entry]);
    sync.markDirty('diet', 'add', { id: entry.id, date: DATE });
    vi.mocked(dietRemote.create).mockRejectedValue(new Error('网络不可达'));

    for (let i = 0; i < MAX_SYNC_ATTEMPTS - 1; i += 1) {
      // 前 4 次失败：仍保留标记
      const summary = await sync.flush();
      expect(summary.failed).toBe(1);
      expect(sync.pendingCount()).toBe(1);
    }

    // 第 5 次：放弃
    const last = await sync.flush();

    expect(last.dropped).toBe(1);
    expect(sync.pendingCount()).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('本地记录已不存在时跳过并丢弃标记（没有内容可推）', async () => {
    const { sync, dietRemote } = createHarness();
    sync.markDirty('diet', 'add', { id: 'never-stored', date: DATE });

    const summary = await sync.flush();

    expect(summary).toEqual({ attempted: 1, succeeded: 0, failed: 0, dropped: 1 });
    expect(dietRemote.create).not.toHaveBeenCalled();
    expect(sync.pendingCount()).toBe(0);
  });

  it('失败后用户再次操作会重置重试次数（给它新的机会）', async () => {
    const { sync, dietRepository, dietRemote, storage } = createHarness();
    const entry = dietEntry();
    dietRepository.saveByDate(DATE, [entry]);
    sync.markDirty('diet', 'add', { id: entry.id, date: DATE });
    vi.mocked(dietRemote.create).mockRejectedValue(new Error('x'));
    await sync.flush();
    await sync.flush();
    expect(readPendingSync(storage)[0].attempts).toBe(2);

    sync.markDirty('diet', 'update', { id: entry.id, date: DATE });

    expect(readPendingSync(storage)[0].attempts).toBe(0);
  });
});

describe('flush：并发与代次', () => {
  it('并发调用共享同一次执行（onShow 与回前台可能同时触发）', async () => {
    const { sync, dietRepository, dietRemote } = createHarness();
    const entry = dietEntry();
    dietRepository.saveByDate(DATE, [entry]);
    sync.markDirty('diet', 'add', { id: entry.id, date: DATE });

    let release: (value: { _id: string }) => void = () => {};
    vi.mocked(dietRemote.create).mockImplementation(
      () => new Promise<{ _id: string }>((resolve) => {
        release = resolve;
      }),
    );

    const first = sync.flush();
    const second = sync.flush();

    expect(dietRemote.create).toHaveBeenCalledTimes(1);
    release({ _id: 'doc-1' });
    await Promise.all([first, second]);
    expect(sync.pendingCount()).toBe(0);
  });

  it('推送期间用户又改了一次：新标记保留下来留给下一轮（代次守卫）', async () => {
    const { sync, dietRepository, dietRemote, storage } = createHarness();
    const entry = dietEntry();
    dietRepository.saveByDate(DATE, [entry]);
    sync.markDirty('diet', 'add', { id: entry.id, date: DATE });
    const firstGeneration = readPendingSync(storage)[0].queuedAt;

    let release: (value: { _id: string }) => void = () => {};
    vi.mocked(dietRemote.create).mockImplementation(
      () => new Promise<{ _id: string }>((resolve) => {
        release = resolve;
      }),
    );

    const flushing = sync.flush();
    // 同步进行中，用户又编辑了一次
    sync.markDirty('diet', 'update', { id: entry.id, date: DATE });
    const secondGeneration = readPendingSync(storage)[0].queuedAt;
    expect(secondGeneration).not.toBe(firstGeneration);

    release({ _id: 'doc-1' });
    await flushing;

    // 推送的是老一代标记，出队不能把新标记一起清掉
    const remaining = readPendingSync(storage);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].queuedAt).toBe(secondGeneration);
  });

  it('一次 flush 结束后可以再次 flush（inFlight 已释放）', async () => {
    const { sync, dietRepository, dietRemote } = createHarness();
    const entry = dietEntry();
    dietRepository.saveByDate(DATE, [entry]);
    sync.markDirty('diet', 'add', { id: entry.id, date: DATE });

    await sync.flush();
    // 再次入队后能继续推送
    sync.markDirty('diet', 'update', { id: entry.id, date: DATE });
    const summary = await sync.flush();

    expect(summary.succeeded).toBe(1);
    expect(dietRemote.update).toHaveBeenCalledTimes(1);
  });
});
