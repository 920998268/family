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
import { SYNC_DOMAINS, readPendingSync, type SyncDomain } from '@/utils/pendingSync';
import type { Tombstone } from '@/utils/tombstone';
import type {
  DietEntry,
  MealPlan,
  StudyCheckin,
  StudyPlan,
  TravelItem,
  TravelPlan,
  WorkoutEntry,
} from '@/types/models';
import { createInertMealTravelDeps } from './helpers/mealTravelDeps';

const DATE = '2026-09-12';
const NOW = 1_700_000_000_000;

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
    id: 'study-1',
    title: '每天背单词',
    subject: '英语',
    frequency: 'daily',
    targetTimes: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function studyCheckin(overrides: Partial<StudyCheckin> = {}): StudyCheckin {
  return { id: 'checkin-1', planId: 'study-1', date: DATE, note: '', ...overrides };
}

function meal(overrides: Partial<MealPlan> = {}): MealPlan {
  return {
    id: 'meal-1',
    date: DATE,
    slot: 'lunch',
    dishName: '番茄炒蛋',
    ingredients: '鸡蛋 2 个',
    cook: '妈妈',
    done: false,
    note: '',
    ...overrides,
  };
}

function tripItem(overrides: Partial<TravelItem> = {}): TravelItem {
  return {
    id: 'trip-1',
    order: 0,
    time: '09:00',
    activity: '出发',
    note: '',
    done: false,
    ...overrides,
  };
}

function travel(overrides: Partial<TravelPlan> = {}): TravelPlan {
  return {
    id: 'travel-1',
    title: '杭州三日',
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    destination: '杭州',
    members: [],
    budget: 3000,
    status: 'planned',
    note: '',
    items: [],
    ...overrides,
  };
}

function tombstone(overrides: Partial<Tombstone> = {}): Tombstone {
  return { domain: 'mealPlan', clientId: 'meal-1', date: DATE, deletedAt: NOW - 1000, ...overrides };
}

/** 构造同步服务；食谱 / 出行的仓储与远端用共享的惰性实现，用例内按需改写 mock */
function createHarness(tombstones: Tombstone[] = []) {
  const storage = new InMemoryStorageAdapter();
  const mealTravel = createInertMealTravelDeps(storage, 'mts');

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
  const tombstoneRemote: TombstoneRemoteRepo = {
    listAll: async (since?: number) =>
      tombstones.filter((item) => item.deletedAt > (since ?? 0)),
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
    ...mealTravel,
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
    ...mealTravel,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('墓碑应用：食谱（mealPlan）', () => {
  it('命中按日期分区的本地食谱 → 删除', async () => {
    const { sync, mealPlanRepository } = createHarness([
      tombstone({ domain: 'mealPlan', clientId: 'meal-1', date: DATE }),
    ]);
    mealPlanRepository.saveByDate(DATE, [meal(), meal({ id: 'meal-2' })]);

    const summary = await sync.applyTombstones();

    expect(summary).toMatchObject({ fetched: 1, removed: 1 });
    expect(mealPlanRepository.getByDate(DATE).map((plan) => plan.id)).toEqual(['meal-2']);
  });

  /**
   * 与饮食 / 学习打卡同一条规则：**墓碑的 `date` 是「删除设备当时看到的分区键」**，
   * 记录自身的 `date` 字段可能与之不同（历史脏数据）。只清其中一个会漏删。
   *
   * 这条用例同时钉住「`mealPlan` 分支必须把 `hintDate` 透传进
   * `removeFromPartitioned`」—— 漏传的话该条记录永远删不掉。
   */
  it('墓碑 date 指向存储分区、记录字段是另一个日期时，靠 hintDate 兜底删掉', async () => {
    const { sync, mealPlanRepository } = createHarness([
      tombstone({ domain: 'mealPlan', clientId: 'meal-1', date: '2026-09-13' }),
    ]);
    // 存在 09-13 分区下，但记录自身的 date 字段是 09-12（脏数据）
    mealPlanRepository.saveByDate('2026-09-13', [meal({ date: DATE })]);

    const summary = await sync.applyTombstones();

    expect(summary.removed).toBe(1);
    expect(mealPlanRepository.getAll()).toEqual([]);
  });

  it('墓碑 date 为空串时，靠记录自身的 date 仍能定位并删除', async () => {
    const { sync, mealPlanRepository } = createHarness([
      tombstone({ domain: 'mealPlan', clientId: 'meal-1', date: '' }),
    ]);
    mealPlanRepository.saveByDate(DATE, [meal()]);

    const summary = await sync.applyTombstones();

    expect(summary.removed).toBe(1);
    expect(mealPlanRepository.getByDate(DATE)).toEqual([]);
  });

  it('本地没有该记录 → 不计数、不产生多余写操作', async () => {
    const { sync, mealPlanRepository } = createHarness([
      tombstone({ domain: 'mealPlan', clientId: '不存在', date: DATE }),
    ]);
    mealPlanRepository.saveByDate(DATE, [meal()]);

    const summary = await sync.applyTombstones();

    expect(summary).toMatchObject({ fetched: 1, removed: 0 });
    expect(mealPlanRepository.getByDate(DATE)).toHaveLength(1);
  });
});

describe('墓碑应用：出行计划与行程明细', () => {
  it('travelPlan 墓碑 → 删除计划（连同它嵌入的明细）', async () => {
    const { sync, travelRepository } = createHarness([
      tombstone({ domain: 'travelPlan', clientId: 'travel-1', date: '' }),
    ]);
    travelRepository.saveAll([
      travel({ items: [tripItem(), tripItem({ id: 'trip-2', order: 1 })] }),
      travel({ id: 'travel-2' }),
    ]);

    const summary = await sync.applyTombstones();

    expect(summary).toMatchObject({ fetched: 1, removed: 1 });
    expect(travelRepository.getAll().map((plan) => plan.id)).toEqual(['travel-2']);
  });

  /**
   * 明细嵌在计划里，所以删一条明细不可能只改「一条记录」——
   * 必须找到承载它的计划、整份回写，同时**不能**碰同一计划里的其它明细。
   */
  it('travelItem 墓碑 → 只摘掉那一条明细，计划与其它明细保持不动', async () => {
    const { sync, travelRepository } = createHarness([
      tombstone({ domain: 'travelItem', clientId: 'trip-1', date: '' }),
    ]);
    travelRepository.saveAll([
      travel({
        items: [
          tripItem(),
          tripItem({ id: 'trip-2', order: 1, activity: '西湖' }),
          tripItem({ id: 'trip-3', order: 2, activity: '返程' }),
        ],
      }),
    ]);

    const summary = await sync.applyTombstones();

    expect(summary.removed).toBe(1);
    const plan = travelRepository.getAll()[0];
    expect(plan.id).toBe('travel-1');
    expect(plan.title).toBe('杭州三日');
    expect(plan.items.map((item) => item.id)).toEqual(['trip-2', 'trip-3']);
  });

  it('travelItem 墓碑在多个计划间定位（只影响承载它的那一份）', async () => {
    const { sync, travelRepository } = createHarness([
      tombstone({ domain: 'travelItem', clientId: 'trip-b', date: '' }),
    ]);
    travelRepository.saveAll([
      travel({ id: 'travel-1', items: [tripItem({ id: 'trip-a' })] }),
      travel({ id: 'travel-2', items: [tripItem({ id: 'trip-b' })] }),
    ]);

    const summary = await sync.applyTombstones();

    expect(summary.removed).toBe(1);
    const plans = travelRepository.getAll();
    expect(plans[0].items.map((item) => item.id)).toEqual(['trip-a']);
    expect(plans[1].items).toEqual([]);
  });

  it('计划已不存在时，级联而来的明细墓碑不会报错也不会多算', async () => {
    const { sync } = createHarness([
      tombstone({ domain: 'travelPlan', clientId: 'travel-1', date: '' }),
      tombstone({ domain: 'travelItem', clientId: 'trip-1', date: '' }),
    ]);

    const summary = await sync.applyTombstones();

    expect(summary).toMatchObject({ fetched: 2, removed: 0 });
  });
});

describe('删除优先：墓碑命中时连待同步标记一起丢弃', () => {
  /**
   * 不清标记的话，`push` 的 `add` 分支会把记录重新建回云端 ——
   * A 端刚删又看到它，两端来回横跳，比丢一次离线编辑严重。
   */
  it('食谱：本地有待推送的新增，墓碑到达后标记被丢弃', async () => {
    const { sync, storage, mealPlanRepository } = createHarness([
      tombstone({ domain: 'mealPlan', clientId: 'meal-1', date: DATE }),
    ]);
    mealPlanRepository.saveByDate(DATE, [meal()]);
    sync.markDirty('mealPlan', 'add', { id: 'meal-1', date: DATE });
    expect(readPendingSync(storage)).toHaveLength(1);

    await sync.applyTombstones();

    expect(readPendingSync(storage)).toEqual([]);
  });

  it('行程明细：同上', async () => {
    const { sync, storage, travelRepository } = createHarness([
      tombstone({ domain: 'travelItem', clientId: 'trip-1', date: '' }),
    ]);
    travelRepository.saveAll([travel({ items: [tripItem()] })]);
    sync.markDirty('travelItem', 'update', { id: 'trip-1', date: '' });

    await sync.applyTombstones();

    expect(readPendingSync(storage)).toEqual([]);
    expect(travelRepository.getAll()[0].items).toEqual([]);
  });
});

describe('拉取合并：食谱', () => {
  it('同 id 以云端为准、本地独有保留，并回写本地缓存', async () => {
    const { sync, mealPlanRepository, mealPlanRemote } = createHarness();
    mealPlanRepository.saveByDate(DATE, [
      meal({ dishName: '本地旧值' }),
      meal({ id: 'meal-local', dishName: '本地独有' }),
    ]);
    vi.mocked(mealPlanRemote.listByDate).mockResolvedValue([
      meal({ dishName: '云端新值' }),
      meal({ id: 'meal-cloud', dishName: '云端独有' }),
    ]);

    const merged = await sync.pullMealPlans(DATE);

    // 顺序：云端条目按云端顺序在前，本地独有的追加在后（mergeCheckins 的既有语义）
    expect(merged.map((plan) => plan.dishName)).toEqual(['云端新值', '云端独有', '本地独有']);
    expect(mealPlanRepository.getByDate(DATE)).toEqual(merged);
  });

  it('本地待同步的记录不被云端旧值覆盖', async () => {
    const { sync, mealPlanRepository, mealPlanRemote } = createHarness();
    mealPlanRepository.saveByDate(DATE, [meal({ dishName: '离线改的' })]);
    sync.markDirty('mealPlan', 'update', { id: 'meal-1', date: DATE });
    vi.mocked(mealPlanRemote.listByDate).mockResolvedValue([meal({ dishName: '云端旧值' })]);

    const merged = await sync.pullMealPlans(DATE);

    expect(merged[0].dishName).toBe('离线改的');
  });
});

describe('拉取合并：出行计划', () => {
  /**
   * ⚠️ 这是 M3 最容易写错的一处：云端 `listPlans` 的 `items` **恒为空数组**
   * （全家庭一次查、上限 500 条，明细多的家庭会被截断），它只服务首屏渲染。
   *
   * 若像其它领域那样「整条记录以云端为准」直接回写，用户的行程明细会被**整体抹掉**。
   * 这条用例就是钉死这个行为：标题取云端、明细必须原样保留本地那份。
   */
  it('⚠️ 云端 items 恒空，合并后本地明细必须原样保留', async () => {
    const { sync, travelRepository, travelPlanRemote } = createHarness();
    travelRepository.saveAll([
      travel({ title: '本地标题', items: [tripItem(), tripItem({ id: 'trip-2', order: 1 })] }),
    ]);
    // 云端返回的 items 被映射层置空 —— 这里如实模拟
    vi.mocked(travelPlanRemote.list).mockResolvedValue([
      travel({ title: '云端标题', items: [] }),
    ]);

    const merged = await sync.pullTravelPlans();

    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('云端标题');
    expect(merged[0].items.map((item) => item.id)).toEqual(['trip-1', 'trip-2']);
    // 也要真的落盘，而不只是返回值好看
    expect(travelRepository.getAll()[0].items).toHaveLength(2);
  });

  it('云端新计划（本地没有）以空明细落地，等 pullTravelItems 填充', async () => {
    const { sync, travelPlanRemote } = createHarness();
    vi.mocked(travelPlanRemote.list).mockResolvedValue([
      travel({ id: 'travel-cloud', title: '另一台设备建的' }),
    ]);

    const merged = await sync.pullTravelPlans();

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('travel-cloud');
    expect(merged[0].items).toEqual([]);
  });

  it('本地待同步的计划整体保留本地版本', async () => {
    const { sync, travelRepository, travelPlanRemote } = createHarness();
    travelRepository.saveAll([travel({ title: '离线改的', items: [tripItem()] })]);
    sync.markDirty('travelPlan', 'update', { id: 'travel-1', date: '' });
    vi.mocked(travelPlanRemote.list).mockResolvedValue([travel({ title: '云端旧值', items: [] })]);

    const merged = await sync.pullTravelPlans();

    expect(merged[0].title).toBe('离线改的');
    expect(merged[0].items).toHaveLength(1);
  });

  it('墓碑先应用、再贴回本地明细 —— 别处删掉的明细不会借这条路径复活', async () => {
    const { sync, travelRepository } = createHarness([
      tombstone({ domain: 'travelItem', clientId: 'trip-1', date: '' }),
    ]);
    travelRepository.saveAll([travel({ items: [tripItem(), tripItem({ id: 'trip-2', order: 1 })] })]);

    const merged = await sync.pullTravelPlans();

    expect(merged[0].items.map((item) => item.id)).toEqual(['trip-2']);
  });
});

describe('拉取合并：行程明细', () => {
  it('云端 + 本地合并，并按 order 还原顺序（云端顺序不保证稳定）', async () => {
    const { sync, travelRepository, travelItemRemote } = createHarness();
    travelRepository.saveAll([travel({ items: [tripItem({ order: 0, activity: '本地第一条' })] })]);
    vi.mocked(travelItemRemote.listByPlan).mockResolvedValue([
      tripItem({ id: 'trip-c', order: 2, activity: '第三条' }),
      tripItem({ id: 'trip-a', order: 0, activity: '第一条' }),
      tripItem({ id: 'trip-b', order: 1, activity: '第二条' }),
    ]);

    const merged = await sync.pullTravelItems('travel-1');

    expect(merged.map((item) => item.activity)).toEqual(['第一条', '本地第一条', '第二条', '第三条']);
    expect(travelRepository.getAll()[0].items).toEqual(merged);
  });

  it('本地待同步的明细保留本地版本', async () => {
    const { sync, travelRepository, travelItemRemote } = createHarness();
    travelRepository.saveAll([travel({ items: [tripItem({ activity: '离线改的' })] })]);
    sync.markDirty('travelItem', 'update', { id: 'trip-1', date: '' });
    vi.mocked(travelItemRemote.listByPlan).mockResolvedValue([tripItem({ activity: '云端旧值' })]);

    const merged = await sync.pullTravelItems('travel-1');

    expect(merged[0].activity).toBe('离线改的');
  });

  /**
   * 「另一台设备刚建的计划」与「它的明细」是两个独立的拉取动作，
   * 明细先到是正常时序 —— 不该让整个读取流程抛错。
   */
  it('计划不在本地时返回空数组（不抛错）', async () => {
    const { sync, travelItemRemote } = createHarness();

    const merged = await sync.pullTravelItems('不存在的计划');

    expect(merged).toEqual([]);
    expect(travelItemRemote.listByPlan).not.toHaveBeenCalled();
  });
});

describe('推送：食谱', () => {
  it('add 走 create，命中 duplicated 时补一次 update', async () => {
    const { sync, mealPlanRepository, mealPlanRemote } = createHarness();
    mealPlanRepository.saveByDate(DATE, [meal()]);
    sync.markDirty('mealPlan', 'add', { id: 'meal-1', date: DATE });
    vi.mocked(mealPlanRemote.create).mockResolvedValue({ _id: 'x', duplicated: true });

    const summary = await sync.flush();

    expect(summary).toMatchObject({ attempted: 1, succeeded: 1, dropped: 0 });
    expect(mealPlanRemote.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'meal-1' }));
    /**
     * 云端 add 命中重复时**不会更新内容** —— 首次 add 的响应丢了、其实已写入，
     * 用户在之后做的编辑若不补这次 update，就会永远停在云端旧版本。
     */
    expect(mealPlanRemote.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'meal-1' }));
  });

  it('remove 直接下发，不需要本地还留着记录', async () => {
    const { sync, mealPlanRemote } = createHarness();
    sync.markDirty('mealPlan', 'remove', { id: 'meal-1', date: DATE });

    const summary = await sync.flush();

    expect(summary).toMatchObject({ attempted: 1, succeeded: 1 });
    expect(mealPlanRemote.remove).toHaveBeenCalledWith('meal-1', DATE);
  });

  it('本地已无记录且操作为 update → skip（当作放弃，不去打注定 404 的调用）', async () => {
    const { sync, mealPlanRemote } = createHarness();
    sync.markDirty('mealPlan', 'update', { id: 'meal-1', date: DATE });

    const summary = await sync.flush();

    expect(summary).toMatchObject({ attempted: 1, dropped: 1, succeeded: 0 });
    expect(mealPlanRemote.create).not.toHaveBeenCalled();
    expect(mealPlanRemote.update).not.toHaveBeenCalled();
  });
});

describe('推送：出行计划与明细', () => {
  it('pushTravelPlan 走计划本体（明细不在这一层下发）', async () => {
    const { sync, travelRepository, travelPlanRemote } = createHarness();
    travelRepository.saveAll([travel({ items: [tripItem()] })]);
    sync.markDirty('travelPlan', 'add', { id: 'travel-1', date: '' });

    const summary = await sync.flush();

    expect(summary).toMatchObject({ attempted: 1, succeeded: 1 });
    expect(travelPlanRemote.create).toHaveBeenCalledTimes(1);
    // 明细必须**没有**被这条路径顺手推上去 —— 它走 pushTravelItem（记录级）
    expect(travelPlanRemote.update).not.toHaveBeenCalled();
  });

  /**
   * 服务端在「明细一次没删完」时会**拒绝删除计划**并返回可重试的失败。
   * 这个异常必须抛出去，否则就成了「计划没删成功、待同步标记却被清掉」，
   * 两边永久不一致且再也不会重试。
   */
  it('⚠️ pushTravelPlan remove 失败时不能被吞掉：标记保留、计入 failed', async () => {
    const { sync, storage, travelPlanRemote } = createHarness();
    sync.markDirty('travelPlan', 'remove', { id: 'travel-1', date: '' });
    vi.mocked(travelPlanRemote.remove).mockRejectedValue(new Error('明细较多，本次未清理完'));

    const summary = await sync.flush();

    expect(summary).toMatchObject({ attempted: 1, succeeded: 0, failed: 1, dropped: 0 });
    expect(readPendingSync(storage)).toHaveLength(1);
  });

  /**
   * 明细自己不知道归属：`travelId` 只存在于「计划 → 它的 items」这一层。
   * 推送前必须先在本地找到承载它的计划，并把明细在数组里的下标作为
   * `fallbackOrder` 一并传下去（老数据缺 `order` 时云端靠它兜底排序）。
   */
  it('pushTravelItem add：带上承载它的 travelId 与 fallbackOrder', async () => {
    const { sync, travelRepository, travelItemRemote } = createHarness();
    travelRepository.saveAll([
      travel({
        items: [
          tripItem({ id: 'trip-a', order: 0 }),
          tripItem({ id: 'trip-b', order: 1, activity: '西湖' }),
        ],
      }),
    ]);
    sync.markDirty('travelItem', 'add', { id: 'trip-b', date: '' });

    const summary = await sync.flush();

    expect(summary).toMatchObject({ attempted: 1, succeeded: 1 });
    expect(travelItemRemote.create).toHaveBeenCalledWith(
      'travel-1',
      expect.objectContaining({ id: 'trip-b', activity: '西湖' }),
      1,
    );
  });

  it('pushTravelItem：老数据缺 order 时 fallbackOrder 取数组下标', async () => {
    const { sync, travelRepository, travelItemRemote } = createHarness();
    const legacy = tripItem({ id: 'trip-legacy', activity: '老数据' });
    delete (legacy as { order?: number }).order;
    travelRepository.saveAll([travel({ items: [tripItem({ id: 'trip-0' }), legacy] })]);
    sync.markDirty('travelItem', 'add', { id: 'trip-legacy', date: '' });

    await sync.flush();

    expect(travelItemRemote.create).toHaveBeenCalledWith(
      'travel-1',
      expect.objectContaining({ id: 'trip-legacy' }),
      1,
    );
  });

  it('pushTravelItem duplicated → 补一次 update', async () => {
    const { sync, travelRepository, travelItemRemote } = createHarness();
    travelRepository.saveAll([travel({ items: [tripItem()] })]);
    sync.markDirty('travelItem', 'add', { id: 'trip-1', date: '' });
    vi.mocked(travelItemRemote.create).mockResolvedValue({ _id: 'x', duplicated: true });

    await sync.flush();

    expect(travelItemRemote.update).toHaveBeenCalledWith(
      'travel-1',
      expect.objectContaining({ id: 'trip-1' }),
      0,
    );
  });

  it('pushTravelItem remove 不需要承载计划（直接按 clientId 下发）', async () => {
    const { sync, travelItemRemote } = createHarness();
    sync.markDirty('travelItem', 'remove', { id: 'trip-1', date: '' });

    const summary = await sync.flush();

    expect(summary).toMatchObject({ attempted: 1, succeeded: 1 });
    expect(travelItemRemote.remove).toHaveBeenCalledWith('trip-1');
  });

  /**
   * 计划被删（或明细被别处摘走）后，这条标记重试多少次都不会成功 ——
   * 给不存在的计划塞明细会被云端主从约束拒绝，留下永久孤儿。直接放弃。
   */
  it('pushTravelItem 找不到承载它的计划 → skip，且不打任何云调用', async () => {
    const { sync, travelItemRemote } = createHarness();
    sync.markDirty('travelItem', 'add', { id: '孤儿明细', date: '' });

    const summary = await sync.flush();

    expect(summary).toMatchObject({ attempted: 1, dropped: 1, succeeded: 0 });
    expect(travelItemRemote.create).not.toHaveBeenCalled();
    expect(travelItemRemote.update).not.toHaveBeenCalled();
  });
});

describe('⚠️ 七个 domain 全部接通（没有落进 default: skip）', () => {
  /**
   * 第 6 步的核心风险不是某一条链路写错，而是**漏接一条**：
   * `pushOne` 的 `default` 分支会把未知 domain 当成「本地无内容可推」直接放弃，
   * 于是该类数据表面上「同步成功」，实际每条都被静默丢弃。
   *
   * 这条用例给七个 domain 各放一条本地记录 + 各排一条待同步标记，
   * 跑一轮 `flush()` 后要求**全部成功、零丢弃**。
   */
  it('七个 domain 各推一条，全部 succeeded、零 dropped', async () => {
    const {
      sync,
      storage,
      dietRepository,
      workoutRepository,
      studyPlanRepository,
      studyCheckinRepository,
      mealPlanRepository,
      travelRepository,
    } = createHarness();

    dietRepository.saveByDate(DATE, [dietEntry()]);
    workoutRepository.saveByDate(DATE, [workoutEntry()]);
    studyPlanRepository.saveAll([studyPlan()]);
    studyCheckinRepository.saveByDate(DATE, [studyCheckin()]);
    mealPlanRepository.saveByDate(DATE, [meal()]);
    travelRepository.saveAll([
      travel({ items: [tripItem({ id: 'trip-1', order: 0 })] }),
    ]);

    sync.markDirty('diet', 'add', { id: 'diet-1', date: DATE });
    sync.markDirty('workout', 'add', { id: 'workout-1', date: DATE });
    sync.markDirty('studyPlan', 'add', { id: 'study-1', date: '' });
    sync.markDirty('studyCheckin', 'add', { id: 'checkin-1', date: DATE });
    sync.markDirty('mealPlan', 'add', { id: 'meal-1', date: DATE });
    sync.markDirty('travelPlan', 'add', { id: 'travel-1', date: '' });
    sync.markDirty('travelItem', 'add', { id: 'trip-1', date: '' });

    expect(readPendingSync(storage)).toHaveLength(7);

    const summary = await sync.flush();

    expect(summary).toEqual({ attempted: 7, succeeded: 7, failed: 0, dropped: 0 });
    expect(readPendingSync(storage)).toEqual([]);
  });

  it('白名单里的每个 domain 都真的有分支在接（数量守卫）', () => {
    expect(SYNC_DOMAINS.size).toBe(7);

    const handled: SyncDomain[] = [
      'diet',
      'workout',
      'studyPlan',
      'studyCheckin',
      'mealPlan',
      'travelPlan',
      'travelItem',
    ];

    for (const domain of handled) {
      expect(SYNC_DOMAINS.has(domain), `SYNC_DOMAINS 缺少 ${domain}`).toBe(true);
    }
  });
});
