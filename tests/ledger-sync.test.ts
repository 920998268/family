import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { DietRepository } from '@/repositories/DietRepository';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';
import { StudyPlanRepository } from '@/repositories/StudyPlanRepository';
import { StudyCheckinRepository } from '@/repositories/StudyCheckinRepository';
import type { DietRemoteRepo } from '@/repositories/remote/DietRemoteRepo';
import type { WorkoutRemoteRepo } from '@/repositories/remote/WorkoutRemoteRepo';
import type { StudyPlanRemoteRepo } from '@/repositories/remote/StudyPlanRemoteRepo';
import type { StudyCheckinRemoteRepo } from '@/repositories/remote/StudyCheckinRemoteRepo';
import type { LedgerRemoteRepo } from '@/repositories/remote/LedgerRemoteRepo';
import type { TombstoneRemoteRepo } from '@/repositories/remote/TombstoneRemoteRepo';
import { CheckinSyncService } from '@/services/CheckinSyncService';
import { SYNC_DOMAINS, readPendingSync } from '@/utils/pendingSync';
import type { Tombstone } from '@/utils/tombstone';
import type { Transaction } from '@/types/models';
import { createInertSyncDeps } from './helpers/inertSyncDeps';

const DATE = '2026-09-14';
const DATE2 = '2026-09-15';
const OUT_OF_RANGE = '2026-08-01';
const NOW = 1_700_000_000_000;
const RANGE = { from: '2026-09-01', to: '2026-09-30' } as const;

const require = createRequire(import.meta.url);
const sharedLib = require('../uniCloud-alipay/cloudfunctions/common/checkin-shared/lib');
const ledgerLib = require('../uniCloud-alipay/cloudfunctions/ledger/lib');

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-1',
    type: 'expense',
    amount: 25.5,
    category: '餐饮',
    date: DATE,
    memberId: 'member-1',
    note: '午饭',
    ...overrides,
  };
}

function tombstone(overrides: Partial<Tombstone> = {}): Tombstone {
  return {
    domain: 'transaction',
    clientId: 'txn-1',
    date: DATE,
    deletedAt: NOW - 1000,
    ...overrides,
  };
}

/** 构造同步服务；四个 M2 域的远端是本地 spy，其余用共享的惰性实现 */
function createHarness(tombstones: Tombstone[] = []) {
  const storage = new InMemoryStorageAdapter();
  const inert = createInertSyncDeps(storage, 'ls');

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
  const studyPlanRemote: StudyPlanRemoteRepo = {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 'p' }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue({ removed: true, deletedCheckins: 0 }),
  };
  const studyCheckinRemote: StudyCheckinRemoteRepo = {
    listByDate: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 'c' }),
    remove: vi.fn().mockResolvedValue({ removed: true }),
  };
  const ledgerRemote: LedgerRemoteRepo = {
    listRange: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ _id: 't' }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue({ removed: true }),
  };
  const tombstoneRemote: TombstoneRemoteRepo = {
    listAll: async (since?: number) => tombstones.filter((item) => item.deletedAt > (since ?? 0)),
  };

  const dietRepository = new DietRepository(storage);
  const workoutRepository = new WorkoutRepository(storage);
  const studyPlanRepository = new StudyPlanRepository(storage);
  const studyCheckinRepository = new StudyCheckinRepository(storage);

  const sync = new CheckinSyncService({
    storage,
    dietRepository,
    workoutRepository,
    studyPlanRepository,
    studyCheckinRepository,
    // ⚠️ 惰性依赖在前、真实实现（含账本的一切）在后：账本绝不能落到惰性桩上，
    //    否则所有账本用例都会「通过」但什么都没验证
    ...inert,
    ledgerRemote,
    dietRemote,
    workoutRemote,
    studyPlanRemote,
    studyCheckinRemote,
    tombstoneRemote,
    now: () => NOW,
  });

  return {
    storage,
    sync,
    dietRepository,
    workoutRepository,
    studyPlanRepository,
    studyCheckinRepository,
    ledgerRepository: inert.ledgerRepository,
    mealPlanRepository: inert.mealPlanRepository,
    travelRepository: inert.travelRepository,
    mealPlanRemote: inert.mealPlanRemote,
    travelPlanRemote: inert.travelPlanRemote,
    travelItemRemote: inert.travelItemRemote,
    dietRemote,
    workoutRemote,
    studyPlanRemote,
    studyCheckinRemote,
    ledgerRemote,
    tombstoneRemote,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('墓碑应用：账本（transaction）', () => {
  it('命中按日期分区的本地收支记录 → 删除', async () => {
    const { sync, ledgerRepository } = createHarness([tombstone({ clientId: 'txn-1' })]);
    ledgerRepository.saveByDate(DATE, [txn(), txn({ id: 'txn-2' })]);

    const summary = await sync.applyTombstones();

    expect(summary).toMatchObject({ fetched: 1, removed: 1 });
    expect(ledgerRepository.getByDate(DATE).map((entry) => entry.id)).toEqual(['txn-2']);
  });

  /**
   * 与饮食 / 食谱同一条规则：**墓碑的 `date` 是「删除设备当时看到的分区键」**，
   * 记录自身的 `date` 字段可能与之不同（历史脏数据）。只清其中一个会漏删。
   *
   * 这条用例同时钉住「`transaction` 分支必须把 `hintDate` 透传进
   * `removeFromPartitioned`」—— 漏传的话该条记录永远删不掉。
   */
  it('墓碑 date 指向存储分区、记录字段是另一个日期时，靠 hintDate 兜底删掉', async () => {
    const { sync, ledgerRepository } = createHarness([
      tombstone({ clientId: 'txn-1', date: DATE2 }),
    ]);
    // 存在 09-15 分区下，但记录自身的 date 字段是 09-14（脏数据）
    ledgerRepository.saveByDate(DATE2, [txn({ date: DATE })]);

    const summary = await sync.applyTombstones();

    expect(summary.removed).toBe(1);
    expect(ledgerRepository.getAll()).toEqual([]);
  });

  it('墓碑 date 为空串时，靠记录自身的 date 仍能定位并删除', async () => {
    const { sync, ledgerRepository } = createHarness([tombstone({ clientId: 'txn-1', date: '' })]);
    ledgerRepository.saveByDate(DATE, [txn()]);

    const summary = await sync.applyTombstones();

    expect(summary.removed).toBe(1);
    expect(ledgerRepository.getAll()).toEqual([]);
  });

  it('本地本来就没有这条 → 不计入 removed，也不产生多余写操作', async () => {
    const { sync, ledgerRepository } = createHarness([tombstone({ clientId: 'txn-1' })]);
    ledgerRepository.saveByDate(DATE, [txn({ id: 'other' })]);

    const summary = await sync.applyTombstones();

    expect(summary.removed).toBe(0);
    expect(ledgerRepository.getByDate(DATE)).toHaveLength(1);
  });

  it('⚠️ 被墓碑删除的记录，其待同步标记一并清掉（否则会被重新推回云端）', async () => {
    const { sync, storage, ledgerRepository } = createHarness([tombstone({ clientId: 'txn-1' })]);
    ledgerRepository.saveByDate(DATE, [txn()]);
    sync.markDirty('transaction', 'add', { id: 'txn-1', date: DATE });

    await sync.applyTombstones();

    expect(readPendingSync(storage)).toEqual([]);
  });
});

describe('pullTransactions：按日期区间拉取并分桶回写', () => {
  it('把区间内的本地记录与云端合并，并按各自日期回写分区', async () => {
    const { sync, ledgerRepository, ledgerRemote } = createHarness();
    ledgerRepository.saveByDate(DATE, [txn({ id: 'local-1' })]);
    (ledgerRemote.listRange as ReturnType<typeof vi.fn>).mockResolvedValue([
      txn({ id: 'remote-1', date: DATE2 }),
    ]);

    const merged = await sync.pullTransactions(RANGE.from, RANGE.to);

    expect(merged.map((entry) => entry.id).sort()).toEqual(['local-1', 'remote-1']);
    // ⚠️ 逐日分桶：两个日期各自的分区都要有内容，不能把两天的记录挤进同一个键
    expect(ledgerRepository.getByDate(DATE).map((entry) => entry.id)).toEqual(['local-1']);
    expect(ledgerRepository.getByDate(DATE2).map((entry) => entry.id)).toEqual(['remote-1']);
  });

  it('云端调用拿到的是区间两端（不是单日、也不是无参）', async () => {
    const { sync, ledgerRemote } = createHarness();

    await sync.pullTransactions(RANGE.from, RANGE.to);

    expect(ledgerRemote.listRange).toHaveBeenCalledWith(RANGE.from, RANGE.to);

    // 用真实的云端校验器确认这一对入参合法（两端齐全）：
    // 缺一端时云端直接 400，而 400 在客户端只表现为「拉不到数据」——
    // 月汇总立刻偏小，但没有任何报错指向这里
    expect(ledgerLib.validateTransactionQuery({ from: RANGE.from, to: RANGE.to }).ok).toBe(true);
    expect(ledgerLib.validateTransactionQuery({ from: RANGE.from }).ok).toBe(false);
  });

  /**
   * ⚠️ 两个方向都要断言：**仓储**（区间外的分区不被改）与**返回值**。
   *
   * 只断言仓储是不够的 —— 区间外的记录被一起合并进来、再原样写回自己的分区，
   * 磁盘上看起来**完全没变**，但 `merged` 的返回值会把 8 月的记录塞进 9 月的列表，
   * `ledger.vue` 直接渲染它，用户会看到「9 月里混着 8 月的账」。
   */
  it('⚠️ 区间外的本地记录一律不动，且不出现在返回值里', async () => {
    const { sync, ledgerRepository } = createHarness();
    ledgerRepository.saveByDate(OUT_OF_RANGE, [txn({ id: 'outside', date: OUT_OF_RANGE })]);

    const merged = await sync.pullTransactions(RANGE.from, RANGE.to);

    expect(merged).toEqual([]);
    expect(ledgerRepository.getByDate(OUT_OF_RANGE).map((entry) => entry.id)).toEqual(['outside']);
  });

  /**
   * ⚠️ 这两条一起说明「墓碑 + 合并」的**真实语义**，别把它想强了：
   *
   * 墓碑的作用是「删掉本地记录 + 清掉它身上的待同步标记」，
   * 它**不是**一张永久的「已删除名单」。所以：
   * - 云端不再返回这条（正常情况：服务端 `remove` 先删记录、后写墓碑）→ 不会复活；
   * - 云端**仍然**返回这条 → 会被拉回来。这是刻意的「云端为准」：
   *   记录还在云端只可能是**别的设备又把它推了回来**，那就该以云端为准
   *   （`mergeCheckins` 的注释：合并从不做隐式删除；`applyTombstones` 的注释：
   *    删除优先只到「清本地 + 清标记」这一步）。
   *
   * 把「不会复活」想成「墓碑永久压制」是常见的误读 —— 下面两条把这个边界钉住。
   */
  it('墓碑删除后，云端也不再返回这条 → 本地不会「复活」它', async () => {
    const { sync, storage, ledgerRepository } = createHarness([tombstone({ clientId: 'txn-1' })]);
    ledgerRepository.saveByDate(DATE, [txn()]);
    sync.markDirty('transaction', 'add', { id: 'txn-1', date: DATE });

    const merged = await sync.pullTransactions(RANGE.from, RANGE.to);

    expect(merged).toEqual([]);
    expect(ledgerRepository.getAll()).toEqual([]);
    // 待同步标记必须一并清掉，否则 `flush()` 的 add 分支会把它重新建回云端
    expect(readPendingSync(storage)).toEqual([]);
  });

  it('⚠️ 云端仍返回这条时会被拉回来（墓碑不是永久压制名单）', async () => {
    const { sync, ledgerRepository, ledgerRemote } = createHarness([tombstone({ clientId: 'txn-1' })]);
    ledgerRepository.saveByDate(DATE, [txn()]);
    (ledgerRemote.listRange as ReturnType<typeof vi.fn>).mockResolvedValue([txn()]);

    const merged = await sync.pullTransactions(RANGE.from, RANGE.to);

    expect(merged.map((entry) => entry.id)).toEqual(['txn-1']);
  });

  it('本机独有（尚未上云）的记录被保留 —— 账本按日期回写依赖这条不变式', async () => {
    const { sync, ledgerRepository } = createHarness();
    ledgerRepository.saveByDate(DATE, [txn({ id: 'local-only' })]);

    const merged = await sync.pullTransactions(RANGE.from, RANGE.to);

    expect(merged.map((entry) => entry.id)).toEqual(['local-only']);
    expect(ledgerRepository.getByDate(DATE).map((entry) => entry.id)).toEqual(['local-only']);
  });

  it('待同步的记录以本地版本为准（离线改的内容不被云端旧值覆盖）', async () => {
    const { sync, ledgerRepository, ledgerRemote } = createHarness();
    ledgerRepository.saveByDate(DATE, [txn({ amount: 99 })]);
    sync.markDirty('transaction', 'update', { id: 'txn-1', date: DATE });
    (ledgerRemote.listRange as ReturnType<typeof vi.fn>).mockResolvedValue([txn({ amount: 1 })]);

    const merged = await sync.pullTransactions(RANGE.from, RANGE.to);

    expect(merged[0].amount).toBe(99);
  });
});

describe('pushTransaction：出队三条写入通路', () => {
  it('add 走 create，成功后出队', async () => {
    const { sync, storage, ledgerRepository, ledgerRemote } = createHarness();
    ledgerRepository.saveByDate(DATE, [txn()]);
    sync.markDirty('transaction', 'add', { id: 'txn-1', date: DATE });

    const summary = await sync.flush();

    expect(summary).toEqual({ attempted: 1, succeeded: 1, failed: 0, dropped: 0 });
    expect(ledgerRemote.create).toHaveBeenCalledWith(txn());
    expect(readPendingSync(storage)).toEqual([]);
  });

  it('update 走 update', async () => {
    const { sync, ledgerRepository, ledgerRemote } = createHarness();
    ledgerRepository.saveByDate(DATE, [txn()]);
    sync.markDirty('transaction', 'update', { id: 'txn-1', date: DATE });

    await sync.flush();

    expect(ledgerRemote.update).toHaveBeenCalledWith(txn());
    expect(ledgerRemote.create).not.toHaveBeenCalled();
  });

  it('⚠️ add 命中 duplicated 时补一次 update（否则首次 add 之后的编辑永远留在本地）', async () => {
    const { sync, ledgerRepository, ledgerRemote } = createHarness();
    ledgerRepository.saveByDate(DATE, [txn()]);
    (ledgerRemote.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: 't',
      duplicated: true,
    });
    sync.markDirty('transaction', 'add', { id: 'txn-1', date: DATE });

    await sync.flush();

    expect(ledgerRemote.update).toHaveBeenCalledWith(txn());
  });

  it('remove 走 remove，并把标记里的 date 作为墓碑兜底传下去', async () => {
    const { sync, storage, ledgerRemote } = createHarness();
    sync.markDirty('transaction', 'remove', { id: 'txn-1', date: DATE });

    const summary = await sync.flush();

    expect(summary.succeeded).toBe(1);
    expect(ledgerRemote.remove).toHaveBeenCalledWith('txn-1', DATE);
    expect(readPendingSync(storage)).toEqual([]);
  });

  it('本地已无这条记录且不是 remove → skip（丢标记，不去打注定失败的云调用）', async () => {
    const { sync, ledgerRemote } = createHarness();
    sync.markDirty('transaction', 'add', { id: 'txn-missing', date: DATE });

    const summary = await sync.flush();

    expect(summary).toEqual({ attempted: 1, succeeded: 0, failed: 0, dropped: 1 });
    expect(ledgerRemote.create).not.toHaveBeenCalled();
  });

  it('找不到标记里记的日期时按 id 全量兜底（记录被挪到别的日期也能推到）', async () => {
    const { sync, ledgerRepository, ledgerRemote } = createHarness();
    ledgerRepository.saveByDate(DATE2, [txn({ date: DATE2 })]);
    sync.markDirty('transaction', 'update', { id: 'txn-1', date: DATE });

    await sync.flush();

    expect(ledgerRemote.update).toHaveBeenCalledWith(txn({ date: DATE2 }));
  });
});

describe('⚠️ domain 全接通守卫（8 个域一个都不能漏）', () => {
  /**
   * `pushOne` 的 `default: skip` 是个**静默黑洞**：漏接一个 domain 分支时，
   * 那个域会把标记当成「本地无内容可推」直接丢弃 —— 数据表面同步成功、
   * 实际每条都被丢掉，且计数里看不出任何异常。
   *
   * 所以这里给 8 个域各放一条**真实的本地记录** + 各排一条待同步标记，
   * 要求 `flush()` 的结果是 `{attempted: 8, succeeded: 8, failed: 0, dropped: 0}`。
   * 光有「每个 domain 都有分支」的源码断言不够 —— 源码里有分支但走不到真实数据
   * （例如 findXxx 找错了仓储）照样是静默失败。
   */
  it('8 个域各推一条，全部真实接通', async () => {
    const h = createHarness();

    h.dietRepository.saveByDate(DATE, [
      { id: 'diet-1', date: DATE, mealType: 'lunch', foodName: '鸡胸肉', quantity: '200g' },
    ]);
    h.workoutRepository.saveByDate(DATE, [
      {
        id: 'workout-1',
        date: DATE,
        category: 'strength',
        exerciseName: '卧推',
        sets: [{ id: 'set-1', order: 1, reps: 8, weightKg: 60 }],
      },
    ]);
    h.studyPlanRepository.saveAll([
      {
        id: 'study-1',
        title: '每天背单词',
        subject: '英语',
        frequency: 'daily',
        targetTimes: 1,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
    h.studyCheckinRepository.saveByDate(DATE, [
      { id: 'checkin-1', planId: 'study-1', date: DATE, note: '' },
    ]);
    h.mealPlanRepository.saveByDate(DATE, [
      {
        id: 'meal-1',
        date: DATE,
        slot: 'lunch',
        dishName: '番茄炒蛋',
        ingredients: '',
        cook: '',
        done: false,
        note: '',
      },
    ]);
    h.travelRepository.saveAll([
      {
        id: 'travel-1',
        title: '杭州三日',
        startDate: '2026-10-01',
        endDate: '2026-10-03',
        destination: '杭州',
        members: [],
        budget: 3000,
        status: 'planned',
        note: '',
        items: [
          { id: 'trip-1', order: 0, time: '09:00', activity: '出发', note: '', done: false },
        ],
      },
    ]);
    h.ledgerRepository.saveByDate(DATE, [txn()]);

    h.sync.markDirty('diet', 'add', { id: 'diet-1', date: DATE });
    h.sync.markDirty('workout', 'add', { id: 'workout-1', date: DATE });
    h.sync.markDirty('studyPlan', 'add', { id: 'study-1', date: '' });
    h.sync.markDirty('studyCheckin', 'add', { id: 'checkin-1', date: DATE });
    h.sync.markDirty('mealPlan', 'add', { id: 'meal-1', date: DATE });
    h.sync.markDirty('travelPlan', 'add', { id: 'travel-1', date: '' });
    h.sync.markDirty('travelItem', 'add', { id: 'trip-1', date: '' });
    h.sync.markDirty('transaction', 'add', { id: 'txn-1', date: DATE });

    expect(readPendingSync(h.storage)).toHaveLength(8);

    const summary = await h.sync.flush();

    expect(summary).toEqual({ attempted: 8, succeeded: 8, failed: 0, dropped: 0 });
    expect(readPendingSync(h.storage)).toEqual([]);

    // ⚠️ 计数通过**不足以**说明每个域都真推上去了：`default: skip` 也会让
    //    `attempted === succeeded`（skip 计入 dropped，这里 dropped 为 0，所以
    //    计数其实是有区分度的）—— 但真正能把「走对了实现」钉死的，是逐个断言
    //    每个域的 create 都被调到，且账本推上去的内容就是本地那条。
    expect(h.dietRemote.create).toHaveBeenCalledTimes(1);
    expect(h.workoutRemote.create).toHaveBeenCalledTimes(1);
    expect(h.studyPlanRemote.create).toHaveBeenCalledTimes(1);
    expect(h.studyCheckinRemote.create).toHaveBeenCalledTimes(1);
    expect(h.mealPlanRemote.create).toHaveBeenCalledTimes(1);
    expect(h.travelPlanRemote.create).toHaveBeenCalledTimes(1);
    expect(h.travelItemRemote.create).toHaveBeenCalledTimes(1);
    expect(h.ledgerRemote.create).toHaveBeenCalledTimes(1);
    expect(h.ledgerRemote.create).toHaveBeenCalledWith(txn());
  });

  it('白名单 8 个值，且与云侧逐值相等', () => {
    expect(SYNC_DOMAINS.size).toBe(8);
    expect([...SYNC_DOMAINS].sort()).toEqual([
      'diet',
      'mealPlan',
      'studyCheckin',
      'studyPlan',
      'transaction',
      'travelItem',
      'travelPlan',
      'workout',
    ]);
    // 云侧白名单必须逐值相等 —— 少一个 domain，那类删除就静默不传播
    expect([...sharedLib.TOMBSTONE_DOMAINS].sort()).toEqual([...SYNC_DOMAINS].sort());
  });
});
