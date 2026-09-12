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
import { CheckinSyncService } from '@/services/CheckinSyncService';
import { MAX_SYNC_ATTEMPTS, readPendingSync } from '@/utils/pendingSync';
import type { StudyCheckin, StudyPlan } from '@/types/models';

const DATE = '2026-09-12';

function plan(overrides: Partial<StudyPlan> = {}): StudyPlan {
  return {
    id: 'study-1',
    title: '每天背单词',
    subject: '英语',
    frequency: 'daily',
    targetTimes: 1,
    createdAt: '2026-09-12T03:20:00.000Z',
    ...overrides,
  };
}

function checkin(overrides: Partial<StudyCheckin> = {}): StudyCheckin {
  return {
    id: 'checkin-1',
    planId: 'study-1',
    date: DATE,
    note: '背了 50 个词',
    ...overrides,
  };
}

function inertRemotes() {
  const dietRemote: DietRemoteRepo = {
    listByDate: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 'd' }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    listFavoriteFoods: vi.fn().mockResolvedValue([]),
    removeFavoriteFood: vi.fn().mockResolvedValue(undefined),
  };
  const workoutRemote: WorkoutRemoteRepo = {
    listByDate: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 'w' }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  return { dietRemote, workoutRemote };
}

function createHarness() {
  const storage = new InMemoryStorageAdapter();
  const dietRepository = new DietRepository(storage);
  const workoutRepository = new WorkoutRepository(storage);
  const studyPlanRepository = new StudyPlanRepository(storage);
  const studyCheckinRepository = new StudyCheckinRepository(storage);
  const { dietRemote, workoutRemote } = inertRemotes();

  const studyPlanRemote: StudyPlanRemoteRepo = {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 'p1' }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue({ removed: true, deletedCheckins: 0 }),
  };
  const studyCheckinRemote: StudyCheckinRemoteRepo = {
    listByDate: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 'c1' }),
    remove: vi.fn().mockResolvedValue({ removed: true }),
  };

  let clock = 1000;
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
    now: () => (clock += 1),
  });

  return {
    storage,
    studyPlanRepository,
    studyCheckinRepository,
    studyPlanRemote,
    studyCheckinRemote,
    sync,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('domain 隔离（学习占两个 domain，不能互相误清）', () => {
  it('计划与打卡的标记各自独立记账', () => {
    const { sync, storage } = createHarness();

    sync.markDirty('studyPlan', 'add', { id: 'study-1', date: '' });
    sync.markDirty('studyCheckin', 'add', { id: 'checkin-1', date: DATE });

    expect(sync.pendingCount()).toBe(2);
    const items = readPendingSync(storage);
    expect(items.map((item) => item.domain).sort()).toEqual(['studyCheckin', 'studyPlan']);
  });

  it('出队计划不会误清掉同 id 的打卡标记（反之亦然）', async () => {
    const { sync, storage, studyPlanRepository, studyCheckinRepository } = createHarness();

    // 故意让两者的 clientId 相同，验证 domain 是隔离维度
    studyPlanRepository.saveAll([plan({ id: 'same-id' })]);
    studyCheckinRepository.saveByDate(DATE, [checkin({ id: 'same-id' })]);

    sync.markDirty('studyPlan', 'add', { id: 'same-id', date: '' });
    sync.markDirty('studyCheckin', 'add', { id: 'same-id', date: DATE });

    await sync.flush();

    // 两条都应成功推送并出队
    expect(readPendingSync(storage)).toEqual([]);
  });
});

describe('推送学习计划', () => {
  it('add：推 create，成功后出队', async () => {
    const { sync, storage, studyPlanRepository, studyPlanRemote } = createHarness();
    studyPlanRepository.saveAll([plan()]);
    sync.markDirty('studyPlan', 'add', { id: 'study-1', date: '' });

    const summary = await sync.flush();

    expect(studyPlanRemote.create).toHaveBeenCalledTimes(1);
    expect(summary.succeeded).toBe(1);
    expect(readPendingSync(storage)).toEqual([]);
  });

  it('add 命中 duplicated 时补一次 update（否则首推后做的编辑会永远停在云端旧版本）', async () => {
    const { sync, studyPlanRepository, studyPlanRemote } = createHarness();
    vi.mocked(studyPlanRemote.create).mockResolvedValue({ _id: 'p1', duplicated: true });
    studyPlanRepository.saveAll([plan()]);
    sync.markDirty('studyPlan', 'add', { id: 'study-1', date: '' });

    await sync.flush();

    expect(studyPlanRemote.create).toHaveBeenCalledTimes(1);
    expect(studyPlanRemote.update).toHaveBeenCalledTimes(1);
  });

  it('remove：调远端删除（服务端会级联删打卡），且**不需要**本地还留着计划', async () => {
    const { sync, storage, studyPlanRemote } = createHarness();
    sync.markDirty('studyPlan', 'remove', { id: 'study-1', date: '' });

    const summary = await sync.flush();

    expect(studyPlanRemote.remove).toHaveBeenCalledWith('study-1');
    expect(summary.succeeded).toBe(1);
    expect(readPendingSync(storage)).toEqual([]);
  });

  it('⚠️ 远端删除失败（例如级联没删完）时标记保留、计入失败，计划不会被误删', async () => {
    const { sync, storage, studyPlanRemote } = createHarness();
    vi.mocked(studyPlanRemote.remove).mockRejectedValue(new Error('历史打卡较多，请稍后重试'));
    sync.markDirty('studyPlan', 'remove', { id: 'study-1', date: '' });

    const summary = await sync.flush();

    expect(summary.failed).toBe(1);
    expect(summary.succeeded).toBe(0);
    const items = readPendingSync(storage);
    expect(items).toHaveLength(1);
    expect(items[0].attempts).toBe(1);
    expect(items[0].lastError).toContain('请稍后重试');
  });

  it('本地已无该计划（非删除动作）时标记直接放弃，不打注定 404 的云调用', async () => {
    const { sync, storage, studyPlanRemote } = createHarness();
    sync.markDirty('studyPlan', 'update', { id: 'gone', date: '' });

    const summary = await sync.flush();

    expect(studyPlanRemote.update).not.toHaveBeenCalled();
    expect(summary.dropped).toBe(1);
    expect(readPendingSync(storage)).toEqual([]);
  });
});

describe('推送学习打卡', () => {
  it('add：推 create', async () => {
    const { sync, studyCheckinRepository, studyCheckinRemote } = createHarness();
    studyCheckinRepository.saveByDate(DATE, [checkin()]);
    sync.markDirty('studyCheckin', 'add', { id: 'checkin-1', date: DATE });

    await sync.flush();

    expect(studyCheckinRemote.create).toHaveBeenCalledTimes(1);
  });

  it('打卡没有 update 动作：update 标记同样走 create（服务端幂等）', async () => {
    const { sync, studyCheckinRepository, studyCheckinRemote } = createHarness();
    studyCheckinRepository.saveByDate(DATE, [checkin()]);
    sync.markDirty('studyCheckin', 'update', { id: 'checkin-1', date: DATE });

    await sync.flush();

    expect(studyCheckinRemote.create).toHaveBeenCalledTimes(1);
  });

  it('remove：调远端删除', async () => {
    const { sync, studyCheckinRemote } = createHarness();
    sync.markDirty('studyCheckin', 'remove', { id: 'checkin-1', date: DATE });

    await sync.flush();

    expect(studyCheckinRemote.remove).toHaveBeenCalledWith('checkin-1');
  });

  it('⚠️ 本地已无该打卡（计划被删后级联清掉）时直接放弃，不打云调用', async () => {
    const { sync, storage, studyCheckinRemote } = createHarness();
    sync.markDirty('studyCheckin', 'add', { id: 'checkin-orphan', date: DATE });

    const summary = await sync.flush();

    expect(studyCheckinRemote.create).not.toHaveBeenCalled();
    expect(summary.dropped).toBe(1);
    expect(readPendingSync(storage)).toEqual([]);
  });

  it('连续失败达上限才放弃，未达上限保留标记', async () => {
    const { sync, storage, studyCheckinRepository, studyCheckinRemote } = createHarness();
    vi.mocked(studyCheckinRemote.create).mockRejectedValue(new Error('网络异常'));
    studyCheckinRepository.saveByDate(DATE, [checkin()]);
    sync.markDirty('studyCheckin', 'add', { id: 'checkin-1', date: DATE });

    for (let round = 1; round < MAX_SYNC_ATTEMPTS; round += 1) {
      await sync.flush();
      expect(readPendingSync(storage)).toHaveLength(1);
    }

    const last = await sync.flush();

    expect(last.dropped).toBe(1);
    expect(readPendingSync(storage)).toEqual([]);
  });
});

describe('拉取与合并', () => {
  it('pullStudyPlans 是**全量**拉取（无 date 参数），并按 id 合并回写', async () => {
    const { sync, studyPlanRepository, studyPlanRemote } = createHarness();
    studyPlanRepository.saveAll([plan({ id: 'local-only', title: '本地独有' })]);
    vi.mocked(studyPlanRemote.list).mockResolvedValue([plan({ id: 'cloud-1', title: '云端计划' })]);

    const merged = await sync.pullStudyPlans();

    expect(studyPlanRemote.list).toHaveBeenCalledWith();
    expect(merged.map((item) => item.id).sort()).toEqual(['cloud-1', 'local-only']);
    expect(studyPlanRepository.getAll().map((item) => item.id).sort()).toEqual([
      'cloud-1',
      'local-only',
    ]);
  });

  it('pullStudyCheckins 按日期拉取', async () => {
    const { sync, studyCheckinRemote } = createHarness();

    await sync.pullStudyCheckins(DATE);

    expect(studyCheckinRemote.listByDate).toHaveBeenCalledWith(DATE);
  });

  it('🔴 已记录的缺口：云端已删除的计划**不会**被本地合并删除（本地独有记录被保留）', async () => {
    // 这是当前 mergeCheckins 的既定行为（云端为准，但本地独有记录保留），
    // 后果是「A 删了计划，B 刷新后仍然看得到」。
    // 用测试把这个行为**显式固定下来**，避免以后误以为它已经支持跨设备删除同步。
    const { sync, studyPlanRepository, studyPlanRemote } = createHarness();
    studyPlanRepository.saveAll([plan({ id: 'deleted-on-cloud' })]);
    vi.mocked(studyPlanRemote.list).mockResolvedValue([]);

    const merged = await sync.pullStudyPlans();

    expect(merged.map((item) => item.id)).toEqual(['deleted-on-cloud']);
  });

  it('本地有待同步修改的计划不会被云端旧值覆盖', async () => {
    const { sync, studyPlanRepository, studyPlanRemote } = createHarness();
    studyPlanRepository.saveAll([plan({ id: 'study-1', title: '本地新标题' })]);
    vi.mocked(studyPlanRemote.list).mockResolvedValue([plan({ id: 'study-1', title: '云端旧标题' })]);
    sync.markDirty('studyPlan', 'update', { id: 'study-1', date: '' });

    const merged = await sync.pullStudyPlans();

    expect(merged[0].title).toBe('本地新标题');
  });

  it('打卡同理：待同步的本地打卡不被云端旧值覆盖', async () => {
    const { sync, studyCheckinRepository, studyCheckinRemote } = createHarness();
    studyCheckinRepository.saveByDate(DATE, [checkin({ note: '本地备注' })]);
    vi.mocked(studyCheckinRemote.listByDate).mockResolvedValue([
      checkin({ note: '云端旧备注' }),
    ]);
    sync.markDirty('studyCheckin', 'add', { id: 'checkin-1', date: DATE });

    const merged = await sync.pullStudyCheckins(DATE);

    expect(merged[0].note).toBe('本地备注');
  });
});

describe('flush 并发去重（沿用 M2-A 语义）', () => {
  it('并发调用共享同一次执行', async () => {
    const { sync, studyCheckinRepository, studyCheckinRemote } = createHarness();
    studyCheckinRepository.saveByDate(DATE, [checkin()]);
    sync.markDirty('studyCheckin', 'add', { id: 'checkin-1', date: DATE });

    await Promise.all([sync.flush(), sync.flush(), sync.flush()]);

    expect(studyCheckinRemote.create).toHaveBeenCalledTimes(1);
  });
});
