import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { getStorageAdapter, setStorageAdapter } from '@/storage';
import { DietRepository } from '@/repositories/DietRepository';
import { WorkoutRepository } from '@/repositories/WorkoutRepository';
import { StudyPlanRepository } from '@/repositories/StudyPlanRepository';
import { StudyCheckinRepository } from '@/repositories/StudyCheckinRepository';
import { MealPlanRepository } from '@/repositories/MealPlanRepository';
import { TravelRepository } from '@/repositories/TravelRepository';
import { LedgerRepository } from '@/repositories/LedgerRepository';
import { createBackupService } from '@/services';
import { createImportSender } from '@/services/DataImportService';
import { useAuthStore } from '@/stores/auth';
import { useBackupStore } from '@/stores/backup';
import { IMPORT_RECORD_KEY } from '@/utils/storageKeys';
import type { ImportRecord } from '@/utils/importData';
import { readPendingSync } from '@/utils/pendingSync';
import type {
  DietEntry,
  MealPlan,
  StudyCheckin,
  StudyPlan,
  Transaction,
  TravelItem,
  TravelPlan,
  WorkoutEntry,
} from '@/types/models';

const DATE = '2026-09-14';
const TOKEN_KEY = 'uni_id_token';

// 每个域一条本机记录（形态与 App 里真实存的一致）
const DIET: DietEntry = {
  id: 'diet-1',
  date: DATE,
  mealType: 'lunch',
  foodName: '鸡胸肉',
  quantity: '200g',
};
const WORKOUT: WorkoutEntry = {
  id: 'workout-1',
  date: DATE,
  category: 'strength',
  exerciseName: '卧推',
  sets: [{ id: 'set-1', order: 1, reps: 8, weightKg: 60 }],
};
const STUDY_PLAN: StudyPlan = {
  id: 'plan-1',
  title: '每天背单词',
  subject: '英语',
  frequency: 'daily',
  targetTimes: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
};
const STUDY_CHECKIN: StudyCheckin = { id: 'checkin-1', planId: 'plan-1', date: DATE, note: '' };
const MEAL: MealPlan = {
  id: 'meal-1',
  date: DATE,
  slot: 'lunch',
  dishName: '番茄炒蛋',
  ingredients: '',
  cook: '',
  done: false,
  note: '',
};
const TRAVEL_PLAN: TravelPlan = {
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
};
const TRAVEL_ITEM: TravelItem = {
  id: 'trip-1',
  order: 0,
  time: '09:00',
  activity: '出发',
  note: '',
  done: false,
};
const TXN: Transaction = {
  id: 'txn-1',
  type: 'expense',
  amount: 58.5,
  category: '餐饮',
  date: DATE,
  note: '',
};

/** 每个域一条；`travelItem` 那条必须带 `parentId` 与 `fallbackOrder` */
const RECORDS: ImportRecord[] = [
  { domain: 'diet', record: DIET },
  { domain: 'workout', record: WORKOUT },
  { domain: 'studyPlan', record: STUDY_PLAN },
  { domain: 'studyCheckin', record: STUDY_CHECKIN },
  { domain: 'mealPlan', record: MEAL },
  { domain: 'travelPlan', record: TRAVEL_PLAN },
  { domain: 'travelItem', record: TRAVEL_ITEM, parentId: 'travel-1', fallbackOrder: 0 },
  { domain: 'transaction', record: TXN },
];

const cloudCalls: Array<{ name: string; action: string; data: Record<string, unknown> }> = [];

/** stub 全局 uniCloud：记录每次调用，并返回成功信封 */
function stubCloud(reply: Record<string, unknown> = { _id: 'cloud-id' }): void {
  cloudCalls.length = 0;
  (globalThis as any).uniCloud = {
    callFunction: vi.fn(async (options: { name: string; data: Record<string, unknown> }) => {
      cloudCalls.push({
        name: options.name,
        action: String(options.data.action),
        data: options.data,
      });
      return { result: { code: 0, data: reply } };
    }),
  };
}

function stubUni(token: string): void {
  (globalThis as any).uni = {
    getStorageSync: (key: string) => (key === TOKEN_KEY ? token : ''),
    setStorageSync: () => {},
    removeStorageSync: () => {},
  };
}

/** 把 8 个域各写一条到本机（走各域真实的仓储，与 App 里的形态一致） */
function seedLocalData(): void {
  const storage = getStorageAdapter();
  new DietRepository(storage).saveByDate(DATE, [DIET]);
  new WorkoutRepository(storage).saveByDate(DATE, [WORKOUT]);
  new StudyPlanRepository(storage).saveAll([STUDY_PLAN]);
  new StudyCheckinRepository(storage).saveByDate(DATE, [STUDY_CHECKIN]);
  new MealPlanRepository(storage).saveByDate(DATE, [MEAL]);
  // ⚠️ 出行本地形态是「计划内嵌 items」：明细单独写不进去，
  //    必须挂在计划的 items 上（这是导入要拆分子记录的根源）
  new TravelRepository(storage).saveAll([{ ...TRAVEL_PLAN, items: [TRAVEL_ITEM] }]);
  new LedgerRepository(storage).saveByDate(DATE, [TXN]);
}

beforeEach(() => {
  setStorageAdapter(new InMemoryStorageAdapter());
  setActivePinia(createPinia());
  stubUni('token-test');
  stubCloud();
  useAuthStore().familyId = 'f-1';
});

afterEach(() => {
  delete (globalThis as any).uniCloud;
  vi.restoreAllMocks();
});

/**
 * 导入分发器的接线守卫。
 *
 * 这一层最容易出的错是「**张冠李戴**」：把某个域接到隔壁域的 create 上，
 * 或者（出行明细）忘了传父计划 id 与下标。前者在运行时只会表现为
 * 「云端多了一堆形状不对的记录」，后者会被云端主从校验整条拒掉 ——
 * 两种都很难从「失败 N 条」这个报数里看出来。
 */
describe('导入分发器：8 个域各自打对云函数与 action', () => {
  const EXPECTED: Record<string, { name: string; action: string }> = {
    diet: { name: 'diet', action: 'add' },
    workout: { name: 'workout', action: 'add' },
    studyPlan: { name: 'study', action: 'addPlan' },
    studyCheckin: { name: 'study', action: 'addCheckin' },
    mealPlan: { name: 'meal', action: 'add' },
    travelPlan: { name: 'travel', action: 'addPlan' },
    travelItem: { name: 'travel', action: 'addItem' },
    transaction: { name: 'ledger', action: 'add' },
  };

  it('逐条发送：每条都打到正确的云函数与 action', async () => {
    const sendOne = createImportSender();

    for (const item of RECORDS) {
      cloudCalls.length = 0;
      await sendOne(item);

      expect(cloudCalls).toHaveLength(1);
      expect(cloudCalls[0], `${item.domain} 打错了云函数`).toMatchObject(EXPECTED[item.domain]);
    }
  });

  it('⚠️ 出行明细必须带父计划 id（缺了会被云端主从校验判为孤儿）', async () => {
    const sendOne = createImportSender();
    const travelItem = RECORDS.find((item) => item.domain === 'travelItem');

    await sendOne(travelItem as ImportRecord);

    expect(cloudCalls[0].data).toMatchObject({
      travelId: 'travel-1',
      clientId: 'trip-1',
      order: 0,
    });
  });

  /**
   * ⚠️ `fallbackOrder` 这条**必须用「缺 `order` 的老明细」来测**：
   * `toCloudTravelItem` 是「有 `order` 就用 `order`、没有才用 `fallbackOrder`」，
   * 拿一条带 `order: 0` 的正常明细去断言，把 `fallbackOrder` 参数整个删掉也照样通过
   * ——本该拦住这个漏传的用例会变成假通过。
   */
  it('⚠️ 老明细缺 order 时靠数组下标兜底（不传则顺序会全部挤到 0）', async () => {
    const sendOne = createImportSender();
    // M3 之前的老明细就是长这样：没有 order 字段
    const legacy = { ...TRAVEL_ITEM, order: undefined } as unknown as TravelItem;

    await sendOne({
      domain: 'travelItem',
      record: legacy,
      parentId: 'travel-1',
      fallbackOrder: 5,
    });

    expect(cloudCalls[0].data).toMatchObject({ travelId: 'travel-1', order: 5 });
  });

  it('上行的是云端契约的字段名（clientId，不是前端的 id）', async () => {
    const sendOne = createImportSender();

    for (const item of RECORDS) {
      cloudCalls.length = 0;
      await sendOne(item);

      const payload = cloudCalls[0].data;
      expect(payload.action, `${item.domain} 未走云函数入参`).toBeTruthy();
      expect(typeof payload.clientId, `${item.domain} 缺 clientId`).toBe('string');
      expect('id' in payload).toBe(false);
    }
  });
});

describe('DataImportService：计划与执行', () => {
  it('plan() 只读本机、不产生任何云调用', async () => {
    seedLocalData();
    const { createDataImportService } = await import('@/services');

    const plan = createDataImportService().plan();

    expect(plan.total).toBe(8);
    expect(cloudCalls).toEqual([]);
  });

  it('run() 逐条下发，全部成功计入 created', async () => {
    seedLocalData();
    const { createDataImportService } = await import('@/services');
    const service = createDataImportService();

    const outcome = await service.run(service.plan());

    expect(outcome).toMatchObject({ attempted: 8, created: 8, duplicated: 0, failed: 0 });
    // 8 个域 → 8 次云调用（父记录先于子记录，由 IMPORT_DOMAINS 保证）
    expect(cloudCalls.map((call) => `${call.name}.${call.action}`)).toEqual([
      'diet.add',
      'workout.add',
      'study.addPlan',
      'study.addCheckin',
      'meal.add',
      'travel.addPlan',
      'travel.addItem',
      'ledger.add',
    ]);
  });

  it('云端已有（duplicated）计入 duplicated 而不是失败 —— 重复点导入是安全的', async () => {
    seedLocalData();
    stubCloud({ _id: 'cloud-id', duplicated: true });
    const { createDataImportService } = await import('@/services');
    const service = createDataImportService();

    const outcome = await service.run(service.plan());

    expect(outcome).toMatchObject({ attempted: 8, created: 0, duplicated: 8, failed: 0 });
  });

  it('某一条被云端拒掉只影响它自己，并回报到具体 id', async () => {
    seedLocalData();
    // 只让账本那条失败
    (globalThis as any).uniCloud = {
      callFunction: vi.fn(async (options: { name: string; data: Record<string, unknown> }) => {
        cloudCalls.push({
          name: options.name,
          action: String(options.data.action),
          data: options.data,
        });
        if (options.name === 'ledger') {
          return { result: { code: 400, msg: '金额不合法' } };
        }
        return { result: { code: 0, data: { _id: 'cloud-id' } } };
      }),
    };
    const { createDataImportService } = await import('@/services');
    const service = createDataImportService();

    const outcome = await service.run(service.plan());

    expect(outcome).toMatchObject({ attempted: 8, created: 7, failed: 1 });
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]).toMatchObject({ domain: 'transaction', id: 'txn-1' });
    expect(outcome.failures[0].message).toContain('金额不合法');
  });
});

/**
 * 留档的意义：一次导入要跑几十秒，用户很可能中途杀掉小程序。
 * 回来时「传没传成功」必须能从本机读出来，而不是靠翻云端列表猜。
 */
describe('导入留档：读写与容错', () => {
  const RECORD = {
    finishedAt: '2026-09-14T10:00:00.000Z',
    attempted: 300,
    created: 297,
    duplicated: 3,
    failed: 0,
    skippedDuplicates: 0,
  };

  it('写入后能原样读回', () => {
    const service = createBackupService();
    service.saveImportRecord(RECORD);

    expect(service.readImportRecord()).toEqual(RECORD);
  });

  it('没有留档时返回 null（首次进入上传页不能报错）', () => {
    expect(createBackupService().readImportRecord()).toBeNull();
  });

  it('留档损坏 / 字段缺失时安全降级，绝不让页面挂掉', () => {
    const storage = getStorageAdapter();

    storage.setItem(IMPORT_RECORD_KEY, '{不是 JSON');
    expect(createBackupService().readImportRecord()).toBeNull();

    storage.setItem(IMPORT_RECORD_KEY, '"字符串"');
    expect(createBackupService().readImportRecord()).toBeNull();

    // 缺 finishedAt：整条不可信
    storage.setItem(IMPORT_RECORD_KEY, JSON.stringify({ created: 3 }));
    expect(createBackupService().readImportRecord()).toBeNull();

    // 计数缺失 → 补 0，而不是留 undefined 让页面显示 "NaN 条"
    storage.setItem(IMPORT_RECORD_KEY, JSON.stringify({ finishedAt: RECORD.finishedAt }));
    expect(createBackupService().readImportRecord()).toMatchObject({
      finishedAt: RECORD.finishedAt,
      created: 0,
      duplicated: 0,
      failed: 0,
      attempted: 0,
      skippedDuplicates: 0,
    });
  });
});

describe('备份 store：上传到云端', () => {
  it('未登录 / 未加入家庭时 cloudReady 为 false', () => {
    const store = useBackupStore();
    expect(store.cloudReady()).toBe(true);

    useAuthStore().familyId = '';
    expect(store.cloudReady()).toBe(false);

    stubUni('');
    expect(store.cloudReady()).toBe(false);
  });

  it('⚠️ 前置条件不满足时直接抛错（否则会白跑几千条请求）', async () => {
    seedLocalData();
    useAuthStore().familyId = '';

    const store = useBackupStore();
    store.previewCloudImport();

    await expect(store.runCloudImport()).rejects.toThrow(/登录并加入家庭/);
    expect(cloudCalls).toEqual([]);
    // 失败不得留下「已上传」的假留档
    expect(createBackupService().readImportRecord()).toBeNull();
  });

  it('preview → run：报数与留档都对得上，且不排待同步标记', async () => {
    seedLocalData();
    const store = useBackupStore();

    const plan = store.previewCloudImport();
    expect(plan.total).toBe(8);
    expect(store.importPlan?.total).toBe(8);

    const outcome = await store.runCloudImport();

    expect(outcome).toMatchObject({ attempted: 8, created: 8, failed: 0 });
    const record = store.lastCloudImport;
    expect(record).toMatchObject({ attempted: 8, created: 8, duplicated: 0, failed: 0 });
    // 留档同时落盘，杀进程后回来还在
    expect(createBackupService().readImportRecord()).toEqual(record);
    expect(store.importing).toBe(false);
    expect(store.importProgress).toEqual({ done: 8, total: 8 });

    // 导入是「直连写」：全程不落 pendingSync，否则几千条标记要空跑很久
    expect(readPendingSync(getStorageAdapter())).toEqual([]);
  });

  it('未先点「检查」直接上传时会自动拍一次计划（不能静默什么都不做）', async () => {
    seedLocalData();
    const store = useBackupStore();

    const outcome = await store.runCloudImport();

    expect(outcome.attempted).toBe(8);
    expect(cloudCalls).toHaveLength(8);
  });

  it('loadCloudImportRecord 把留档读进 store（页面 onShow 用）', () => {
    const service = createBackupService();
    service.saveImportRecord({
      finishedAt: '2026-09-14T10:00:00.000Z',
      attempted: 2,
      created: 1,
      duplicated: 1,
      failed: 0,
      skippedDuplicates: 0,
    });

    const store = useBackupStore();
    expect(store.lastCloudImport).toBeNull();

    store.loadCloudImportRecord();
    expect(store.lastCloudImport).toMatchObject({ created: 1, duplicated: 1 });
  });
});
