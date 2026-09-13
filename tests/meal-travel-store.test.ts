import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  pullMealPlans: vi.fn(),
  pullTravelPlans: vi.fn(),
  pullTravelItems: vi.fn(),
  toggleTravelItem: vi.fn(),
  flush: vi.fn(),
  markDirty: vi.fn(),
  pendingCount: vi.fn(),
}));

/**
 * 只替换同步服务的取用入口，其余（各 service / repository 工厂）保持真实 ——
 * store 的本地路径与「本地优先」语义必须跑真代码。
 */
vi.mock('@/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services')>();
  return {
    ...actual,
    getCheckinSyncService: () => ({
      pullMealPlans: mocks.pullMealPlans,
      pullTravelPlans: mocks.pullTravelPlans,
      pullTravelItems: mocks.pullTravelItems,
      toggleTravelItem: mocks.toggleTravelItem,
      flush: mocks.flush,
      markDirty: mocks.markDirty,
      pendingCount: mocks.pendingCount,
    }),
  };
});

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { getStorageAdapter, setStorageAdapter } from '@/storage';
import { MealPlanRepository } from '@/repositories/MealPlanRepository';
import { TravelRepository } from '@/repositories/TravelRepository';
import { useAuthStore } from '@/stores/auth';
import { useMealStore } from '@/stores/meal';
import { useTravelStore } from '@/stores/travel';
import type { MealPlan, TravelItem, TravelPlan } from '@/types/models';

const DATE = '2026-09-12';
const NEXT_DATE = '2026-09-13';
const TOKEN_KEY = 'uni_id_token';

function meal(id: string, overrides: Partial<MealPlan> = {}): MealPlan {
  return {
    id,
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

function item(id: string, overrides: Partial<TravelItem> = {}): TravelItem {
  return { id, order: 0, time: '09:00', activity: '出发', note: '', done: false, ...overrides };
}

function travelPlan(id: string, overrides: Partial<TravelPlan> = {}): TravelPlan {
  return {
    id,
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

function travelRepo(): TravelRepository {
  return new TravelRepository(getStorageAdapter());
}

function mealRepo(): MealPlanRepository {
  return new MealPlanRepository(getStorageAdapter());
}

beforeEach(() => {
  setStorageAdapter(new InMemoryStorageAdapter());
  setActivePinia(createPinia());
  stubUni('token-test');
  // 默认就是「已登录 + 已加入家庭」的正常态；测前置条件的用例各自退出
  joinFamily('f-1');

  mocks.pullMealPlans.mockReset().mockResolvedValue([]);
  mocks.pullTravelPlans.mockReset().mockResolvedValue([]);
  mocks.pullTravelItems.mockReset().mockResolvedValue([]);
  mocks.toggleTravelItem.mockReset().mockResolvedValue({ synced: true, done: true });
  mocks.flush.mockReset().mockResolvedValue({ attempted: 0, succeeded: 0, failed: 0, dropped: 0 });
  mocks.markDirty.mockReset();
  mocks.pendingCount.mockReset().mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('食谱 store：本地优先 + 云端合并', () => {
  it('load 先用本地缓存立即渲染，云端结果回来后刷新', async () => {
    mealRepo().saveByDate(DATE, [meal('local-1', { dishName: '本地缓存' })]);
    mocks.pullMealPlans.mockImplementation(async (date: string) => {
      mealRepo().saveByDate(date, [meal('local-1', { date, dishName: '云端' }), meal('remote-1', { date })]);
    });

    const store = useMealStore();
    store.load(DATE);

    // 同步阶段就已经有画面，不等云端（秒开）
    expect(store.plans.map((plan) => plan.id)).toEqual(['local-1']);
    expect(store.plans[0].dishName).toBe('本地缓存');

    await vi.waitFor(() => {
      expect(store.plans.map((plan) => plan.id)).toEqual(['local-1', 'remote-1']);
    });
    expect(mocks.pullMealPlans).toHaveBeenCalledWith(DATE);
    expect(store.plans[0].dishName).toBe('云端');
  });

  it('云端失败时保留本地缓存，不把页面打空', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mealRepo().saveByDate(DATE, [meal('local-1')]);
    mocks.pullMealPlans.mockRejectedValue(new Error('网络不可达'));

    const store = useMealStore();
    store.load(DATE);

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(store.plans.map((plan) => plan.id)).toEqual(['local-1']);
    expect(store.syncing).toBe(false);
  });

  it('云端响应回来时用户已切到别的日期：不覆盖当前列表', async () => {
    mealRepo().saveByDate(DATE, [meal('m12')]);
    mealRepo().saveByDate(NEXT_DATE, [meal('m13', { date: NEXT_DATE })]);

    let releaseFirst: () => void = () => {};
    let calls = 0;
    mocks.pullMealPlans.mockImplementation(async (date: string) => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        mealRepo().saveByDate(date, [meal('from-cloud-12', { date })]);
      }
    });

    const store = useMealStore();
    store.load(DATE);
    store.load(NEXT_DATE);
    await vi.waitFor(() => expect(calls).toBe(2));

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.loadedDate).toBe(NEXT_DATE);
    expect(store.plans.map((plan) => plan.id)).toEqual(['m13']);
  });
});

describe('食谱 store：云同步前置条件', () => {
  it('未登录时不发起云端拉取（本地照常显示）', async () => {
    stubUni('');
    mealRepo().saveByDate(DATE, [meal('local-1')]);

    const store = useMealStore();
    store.load(DATE);
    await Promise.resolve();

    expect(mocks.pullMealPlans).not.toHaveBeenCalled();
    expect(store.plans).toHaveLength(1);
  });

  it('已登录但未加入家庭时不发起云端拉取', async () => {
    joinFamily('');

    useMealStore().load(DATE);
    await Promise.resolve();

    expect(mocks.pullMealPlans).not.toHaveBeenCalled();
  });
});

describe('食谱 store：写入登记待同步', () => {
  it('add / update / remove 各自登记 mealPlan 动作并触发重发', () => {
    const store = useMealStore();
    store.load(DATE);

    const added = store.add(DATE, {
      slot: 'lunch',
      dishName: '番茄炒蛋',
      ingredients: '鸡蛋 2 个',
      cook: '妈妈',
      done: false,
      note: '',
    });
    expect(store.plans.map((plan) => plan.id)).toEqual([added.id]);
    expect(mocks.markDirty).toHaveBeenCalledWith('mealPlan', 'add', { id: added.id, date: DATE });
    expect(mocks.flush).toHaveBeenCalled();

    mocks.markDirty.mockClear();
    store.update(DATE, added.id, { done: true });
    expect(mocks.markDirty).toHaveBeenCalledWith('mealPlan', 'update', {
      id: added.id,
      date: DATE,
    });

    mocks.markDirty.mockClear();
    store.remove(DATE, added.id);
    expect(mocks.markDirty).toHaveBeenCalledWith('mealPlan', 'remove', {
      id: added.id,
      date: DATE,
    });
    expect(store.plans).toEqual([]);
  });

  it('未登录时登记标记但**不**触发重发（标记留着，等条件具备再推）', () => {
    stubUni('');
    const store = useMealStore();
    store.load(DATE);

    const added = store.add(DATE, {
      slot: 'lunch',
      dishName: '番茄炒蛋',
      ingredients: '',
      cook: '',
      done: false,
      note: '',
    });

    // markDirty 无条件、flush 有前置条件 —— 写反了会让「先记录、后入家庭」的数据永不上云
    expect(mocks.markDirty).toHaveBeenCalledWith('mealPlan', 'add', { id: added.id, date: DATE });
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(store.plans).toHaveLength(1);
  });
});

describe('出行 store：读取通路（计划全量 + 明细按计划）', () => {
  it('load 先本地渲染，随后拉计划并**逐个计划**拉明细', async () => {
    travelRepo().saveAll([travelPlan('local-1', { items: [item('i-local')] })]);
    // 模拟真实 `pullTravelPlans`：合并后回写本地（不是只返回）
    mocks.pullTravelPlans.mockImplementation(async () => {
      const repo = travelRepo();
      const merged = [
        ...repo.getAll().map((plan) => ({ ...plan })),
        travelPlan('cloud-1', { title: '另一台设备建的' }),
      ];
      repo.saveAll(merged);
      return merged;
    });

    const store = useTravelStore();
    store.load();

    // 本地优先
    expect(store.plans.map((plan) => plan.id)).toEqual(['local-1']);

    await vi.waitFor(() => expect(store.plans).toHaveLength(2));
    /**
     * ⚠️ 这条是本模块的关键：`listPlans` 返回的明细是会被 500 条上限截断的聚合结果，
     * 不是权威口径 —— 必须再按计划逐条拉，否则明细可能一直缺失。
     */
    expect(mocks.pullTravelItems.mock.calls.map((call) => call[0])).toEqual([
      'local-1',
      'cloud-1',
    ]);
  });

  it('云端失败时保留本地缓存，不把页面打空', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    travelRepo().saveAll([travelPlan('local-1')]);
    mocks.pullTravelPlans.mockRejectedValue(new Error('网络不可达'));

    const store = useTravelStore();
    store.load();

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(store.plans.map((plan) => plan.id)).toEqual(['local-1']);
    expect(store.syncing).toBe(false);
  });

  it('未加入家庭时不发起云端拉取', async () => {
    joinFamily('');

    useTravelStore().load();
    await Promise.resolve();

    expect(mocks.pullTravelPlans).not.toHaveBeenCalled();
    expect(mocks.pullTravelItems).not.toHaveBeenCalled();
  });
});

describe('出行 store：明细的记录级下发（不整包覆盖）', () => {
  /**
   * 这是 M3 第 7 步的核心：表单一次提交整份明细，
   * 但**绝不能**把这些明细整包丢给云端 —— 那会变成「后写者覆盖前写者」，
   * 两人同时编辑同一份行程时会互相覆盖。必须拆成记录级的 add / update / remove。
   */
  it('新增计划时逐条登记计划与它的每条明细', () => {
    const store = useTravelStore();
    store.load();

    const added = store.add({
      title: '杭州三日',
      destination: '杭州',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      budget: 3000,
      members: [],
      status: 'planned',
      note: '',
      items: [
        { time: '09:00', activity: '出发', note: '', done: false },
        { time: '14:00', activity: '西湖', note: '', done: false },
      ],
    });

    expect(added.items).toHaveLength(2);
    expect(mocks.markDirty).toHaveBeenCalledWith('travelPlan', 'add', { id: added.id, date: '' });
    // 只登记计划的话，明细永远上不了云
    for (const entry of added.items) {
      expect(mocks.markDirty).toHaveBeenCalledWith('travelItem', 'add', {
        id: entry.id,
        date: '',
      });
    }
    expect(mocks.flush).toHaveBeenCalled();
  });

  it('编辑表单：增行 → item add、删行 → item remove、改序 → item update', () => {
    const store = useTravelStore();
    store.load();
    const created = store.add({
      title: '杭州三日',
      destination: '杭州',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      budget: 3000,
      members: [],
      status: 'planned',
      note: '',
      items: [
        { time: '09:00', activity: '出发', note: '', done: false },
        { time: '14:00', activity: '西湖', note: '', done: false },
      ],
    });
    const [first, second] = created.items;
    mocks.markDirty.mockClear();

    // 保留第一条（改内容 + 换序）、删掉第二条、新增第三条
    store.update(created.id, {
      items: [
        { id: second.id, time: '09:30', activity: '出发（改）', note: '', done: false },
        { id: first.id, time: '09:00', activity: '出发', note: '', done: false },
        { time: '18:00', activity: '晚餐', note: '', done: false },
      ],
    });

    const calls = mocks.markDirty.mock.calls.map((call) => [call[0], call[1], call[2].id]);
    expect(calls).toContainEqual(['travelPlan', 'update', created.id]);
    // 两条既有行都动了（内容变 / 顺序变）→ update；新行 → add
    expect(calls).toContainEqual(['travelItem', 'update', second.id]);
    expect(calls).toContainEqual(['travelItem', 'update', first.id]);
    expect(calls.filter((call) => call[1] === 'add' && call[0] === 'travelItem')).toHaveLength(1);
    // 明细一条都没被删（三条都还在），所以不应有 remove
    expect(calls.filter((call) => call[1] === 'remove')).toEqual([]);
  });

  it('表单里删掉一行 → 只登记那一条的 remove', () => {
    const store = useTravelStore();
    store.load();
    const created = store.add({
      title: '杭州三日',
      destination: '杭州',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      budget: 3000,
      members: [],
      status: 'planned',
      note: '',
      items: [
        { time: '09:00', activity: '出发', note: '', done: false },
        { time: '14:00', activity: '西湖', note: '', done: false },
      ],
    });
    const [first, second] = created.items;
    mocks.markDirty.mockClear();

    store.update(created.id, {
      items: [{ id: first.id, time: first.time, activity: first.activity, note: '', done: false }],
    });

    // 第一条**没有变化**（内容与顺序都没动），所以不应产生 update
    expect(mocks.markDirty).toHaveBeenCalledWith('travelItem', 'remove', {
      id: second.id,
      date: '',
    });
    expect(mocks.markDirty).toHaveBeenCalledTimes(2); // travelPlan update + travelItem remove
  });

  it('只改标题（不传 items）时不产生任何 travelItem 标记', () => {
    const store = useTravelStore();
    store.load();
    const created = store.add({
      title: '杭州三日',
      destination: '杭州',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      budget: 3000,
      members: [],
      status: 'planned',
      note: '',
      items: [{ time: '09:00', activity: '出发', note: '', done: false }],
    });
    mocks.markDirty.mockClear();

    store.update(created.id, { title: '杭州四日' });

    expect(mocks.markDirty).toHaveBeenCalledTimes(1);
    expect(mocks.markDirty).toHaveBeenCalledWith('travelPlan', 'update', {
      id: created.id,
      date: '',
    });
  });

  it('setStatus 只登记计划本体', () => {
    const store = useTravelStore();
    store.load();
    const created = store.add({
      title: '杭州三日',
      destination: '杭州',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      budget: 3000,
      members: [],
      status: 'planned',
      note: '',
      items: [],
    });
    mocks.markDirty.mockClear();

    store.setStatus(created.id, 'ongoing');

    expect(mocks.markDirty).toHaveBeenCalledTimes(1);
    expect(mocks.markDirty).toHaveBeenCalledWith('travelPlan', 'update', {
      id: created.id,
      date: '',
    });
  });

  it('删除计划只登记计划本体（云端级联删明细并逐条写墓碑）', () => {
    const store = useTravelStore();
    store.load();
    const created = store.add({
      title: '杭州三日',
      destination: '杭州',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      budget: 3000,
      members: [],
      status: 'planned',
      note: '',
      items: [{ time: '09:00', activity: '出发', note: '', done: false }],
    });
    mocks.markDirty.mockClear();

    store.remove(created.id);

    expect(mocks.markDirty).toHaveBeenCalledTimes(1);
    expect(mocks.markDirty).toHaveBeenCalledWith('travelPlan', 'remove', {
      id: created.id,
      date: '',
    });
    expect(store.plans).toEqual([]);
  });
});

describe('出行 store：勾选走服务端翻转 + 降级兜底', () => {
  function seedPlan(): { planId: string; itemId: string } {
    const store = useTravelStore();
    store.load();
    const created = store.add({
      title: '杭州三日',
      destination: '杭州',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      budget: 3000,
      members: [],
      status: 'planned',
      note: '',
      items: [{ time: '09:00', activity: '出发', note: '', done: false }],
    });
    mocks.markDirty.mockClear();
    return { planId: created.id, itemId: created.items[0].id };
  }

  it('在线：直连服务端翻转，**不**走队列', async () => {
    const { planId, itemId } = seedPlan();
    mocks.toggleTravelItem.mockResolvedValue({ synced: true, done: true });

    const store = useTravelStore();
    store.toggleItem(planId, itemId);

    // 本地乐观翻转，界面立刻有反馈
    expect(store.plans[0].items[0].done).toBe(true);

    await vi.waitFor(() => expect(mocks.toggleTravelItem).toHaveBeenCalledWith(itemId));
    /**
     * ⚠️ 翻转语义不能落到队列上：队列只有 add / update / remove，
     * 表达不了「翻转」；排成 update 会退化成 last-write-wins，
     * 两端同时点同一条时可能把对方的勾选覆盖掉。
     */
    expect(mocks.markDirty).not.toHaveBeenCalled();
  });

  it('在线：用服务端返回的权威值校正本地（两端同时勾选时本地不会跑偏）', async () => {
    const { planId, itemId } = seedPlan();
    // 服务端说最终是「未完成」——本地那次乐观翻转必须被纠正
    mocks.toggleTravelItem.mockResolvedValue({ synced: true, done: false });

    const store = useTravelStore();
    store.toggleItem(planId, itemId);
    expect(store.plans[0].items[0].done).toBe(true);

    await vi.waitFor(() => expect(store.plans[0].items[0].done).toBe(false));
  });

  it('响应缺 done 时不擅自把明细改成未勾选', async () => {
    const { planId, itemId } = seedPlan();
    mocks.toggleTravelItem.mockResolvedValue({ synced: true });

    const store = useTravelStore();
    store.toggleItem(planId, itemId);
    await vi.waitFor(() => expect(mocks.toggleTravelItem).toHaveBeenCalled());

    expect(store.plans[0].items[0].done).toBe(true);
  });

  it('未登录 / 未入家庭：降级为排一条 travelItem update 标记（离线勾选不能丢）', async () => {
    const { planId, itemId } = seedPlan();
    joinFamily('');

    const store = useTravelStore();
    store.toggleItem(planId, itemId);
    await Promise.resolve();

    expect(mocks.toggleTravelItem).not.toHaveBeenCalled();
    expect(mocks.markDirty).toHaveBeenCalledWith('travelItem', 'update', { id: itemId, date: '' });
    // 本地翻转保留 —— 排了标记后 pull 会优先保留本地版本，不会被云端旧值覆盖
    expect((travelRepo().getAll()[0].items[0] as TravelItem).done).toBe(true);
  });

  it('直连失败（synced: false）时不崩，服务层已代为排好兜底标记', async () => {
    const { planId, itemId } = seedPlan();
    mocks.toggleTravelItem.mockResolvedValue({ synced: false });

    const store = useTravelStore();
    expect(() => store.toggleItem(planId, itemId)).not.toThrow();
    await vi.waitFor(() => expect(mocks.toggleTravelItem).toHaveBeenCalled());

    // 本地乐观值保留，等常规 flush 把队列里的 update 推上去
    expect(store.plans[0].items[0].done).toBe(true);
  });
});

describe('源码级守卫', () => {
  const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');

  /**
   * ⚠️ 不保留 id 的话，「打开编辑 → 保存」会把全部明细当成新行：
   * `computeItemDiff` 匹配不到 → 旧行判 removed、新行判 added →
   * 云端删一轮又建一轮，明细 id 全变、`travelItem` 墓碑乱飞。
   */
  it('出行表单回填明细时必须保留 id', () => {
    const source = read('src/pages/plan/travel-form.vue');

    expect(source, '回填 items 时丢了 id —— 每次保存都会重建全部明细').toMatch(
      /items\.value = plan\.items\.map\(\(item\) => \(\{[\s\S]{0,400}?id:\s*item\.id/,
    );
  });

  it('store 不直接引用裸 uniCloud（云调用一律经服务层）', () => {
    for (const store of ['src/stores/meal.ts', 'src/stores/travel.ts']) {
      const source = read(store);
      expect(/(^|[^.\w$])uniCloud\s*\./.test(source), `${store} 出现裸 uniCloud`).toBe(false);
    }
  });

  it('两个 store 都走 checkinRuntime 的三件套，不各自散写前置条件', () => {
    for (const store of ['src/stores/meal.ts', 'src/stores/travel.ts']) {
      const source = read(store);
      expect(source, `${store} 未接前置条件`).toContain('isCheckinCloudReady');
      expect(source, `${store} 未接登记`).toContain('markCheckinDirty');
      expect(source, `${store} 未接重发`).toContain('flushPendingCheckins');
    }
  });

  /**
   * App 的 `onShow` 覆盖不到「页面之间跳转」——
   * 用户从计划中心跳到食谱页时，App 不会重新 onShow，积压的待同步就没人推。
   * 约定与饮食 / 运动 / 学习三个打卡页一致：模块自己的数据页进入时补一次。
   */
  it('计划模块的数据页进入时也会补传', () => {
    for (const page of [
      'src/pages/plan/meal.vue',
      'src/pages/plan/travel.vue',
      'src/pages/plan/travel-form.vue',
    ]) {
      const source = read(page);
      expect(source, `${page} 未接入补传`).toContain('flushPendingCheckins');
      expect(source, `${page} 未在 onShow 中调用`).toMatch(
        /onShow\(\(\) => \{[\s\S]{0,400}?flushPendingCheckins\(\)/,
      );
    }
  });
});
