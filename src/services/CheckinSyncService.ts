import type {
  DietEntry,
  MealPlan,
  StudyCheckin,
  StudyPlan,
  TravelItem,
  TravelPlan,
  WorkoutEntry,
} from '@/types/models';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import type { DietRepository } from '@/repositories/DietRepository';
import type { WorkoutRepository } from '@/repositories/WorkoutRepository';
import type { StudyPlanRepository } from '@/repositories/StudyPlanRepository';
import type { StudyCheckinRepository } from '@/repositories/StudyCheckinRepository';
import type { MealPlanRepository } from '@/repositories/MealPlanRepository';
import type { TravelRepository } from '@/repositories/TravelRepository';
import type { DietRemoteRepo } from '@/repositories/remote/DietRemoteRepo';
import type { WorkoutRemoteRepo } from '@/repositories/remote/WorkoutRemoteRepo';
import type { StudyPlanRemoteRepo } from '@/repositories/remote/StudyPlanRemoteRepo';
import type { StudyCheckinRemoteRepo } from '@/repositories/remote/StudyCheckinRemoteRepo';
import type { MealPlanRemoteRepo } from '@/repositories/remote/MealPlanRemoteRepo';
import type { TravelPlanRemoteRepo } from '@/repositories/remote/TravelPlanRemoteRepo';
import type { TravelItemRemoteRepo } from '@/repositories/remote/TravelItemRemoteRepo';
import type { TombstoneRemoteRepo } from '@/repositories/remote/TombstoneRemoteRepo';
import { mergeCheckins } from '@/utils/checkinMerge';
import { sortTravelItems } from '@/utils/travel';
import {
  groupTombstonesByDomain,
  nextTombstoneCursor,
  readTombstoneCursor,
  writeTombstoneCursor,
} from '@/utils/tombstone';
import {
  MAX_SYNC_ATTEMPTS,
  dequeuePendingSync,
  dropPendingSync,
  failPendingSync,
  pendingClientIds,
  queuePendingSync,
  readPendingSync,
  type PendingSyncItem,
  type SyncDomain,
  type SyncOp,
} from '@/utils/pendingSync';

/** 同步服务的依赖（全部注入，单测可用内存实现替换） */
export interface CheckinSyncDeps {
  storage: StorageAdapter;
  dietRepository: DietRepository;
  workoutRepository: WorkoutRepository;
  studyPlanRepository: StudyPlanRepository;
  studyCheckinRepository: StudyCheckinRepository;
  /** 食谱：按日期分区存储，与饮食 / 运动同构 */
  mealPlanRepository: MealPlanRepository;
  /**
   * 出行计划。
   *
   * ⚠️ 明细**没有独立的本地仓储**：它嵌在 `TravelPlan.items` 里，
   * 所以 `travelItem` 的增删改都要先找到承载它的计划、再整份 `saveAll` 回写。
   */
  travelRepository: TravelRepository;
  dietRemote: DietRemoteRepo;
  workoutRemote: WorkoutRemoteRepo;
  studyPlanRemote: StudyPlanRemoteRepo;
  studyCheckinRemote: StudyCheckinRemoteRepo;
  mealPlanRemote: MealPlanRemoteRepo;
  travelPlanRemote: TravelPlanRemoteRepo;
  travelItemRemote: TravelItemRemoteRepo;
  /** 墓碑（删除日志）远端读取，用于跨设备同步删除 */
  tombstoneRemote: TombstoneRemoteRepo;
  /** 便于测试固定时间；默认 `Date.now` */
  now?: () => number;
}

/** 记录引用：同步定位只认 `id`（= 云端 clientId），`date` 仅用于快速定位与排查 */
export interface CheckinRef {
  id: string;
  date: string;
}

export interface FlushSummary {
  /** 本轮扫描到的待同步条目数 */
  attempted: number;
  succeeded: number;
  /** 仍可重试的失败数 */
  failed: number;
  /** 被放弃的条目数（本地记录已不存在，或连续失败达上限） */
  dropped: number;
}

/** 单条推送结果：`skip` 表示本地已无内容可推，标记应当直接放弃 */
type PushOutcome = 'ok' | 'skip';

/**
 * 打卡数据同步服务。
 *
 * 覆盖 7 个 domain：饮食 / 运动 / 学习计划 / 学习打卡（M2b）+
 * 食谱 / 出行计划 / 行程明细（M3 第 6 步）。
 *
 * 策略（对应方案文档 §5.4）：
 * - **写＝本地优先**：store 先写本地缓存让 UI 即时生效，再 `markDirty()` 登记待同步；
 * - **读＝云端为准、本地兜底**：`pullXxx()` 拉云端 → 合并 → 回写本地缓存；
 * - **重试**：`flush()` 扫描待同步标记逐条重发，连续失败达 `MAX_SYNC_ATTEMPTS` 次则放弃并告警。
 *
 * ⚠️ 调用前置条件：`flush()` 与 `pullXxx()` 都要求「已登录且已加入家庭」。
 * 未加入家庭时云函数会一直报错，而失败次数累加到上限会把标记丢掉＝本地记录再也上不了云。
 * 调用方（App / 页面的 onShow）需先判断登录与家庭状态，见第 6 步接线。
 */
/** 应用墓碑的结果 */
export interface TombstoneSummary {
  /** 本轮拉到的墓碑条数 */
  fetched: number;
  /** 实际删除的本地记录条数（本地本来就没有的不计） */
  removed: number;
  /** 推进后的游标 */
  cursor: number;
}

/** 明细勾选直连的结果（见 `toggleTravelItem`） */
export interface ToggleTravelItemResult {
  /** 服务端是否成功翻转；`false` 表示已降级为排队重发 */
  synced: boolean;
  /** 服务端算出的最终值。仅在 `synced: true` 时有意义 */
  done?: boolean;
}

export class CheckinSyncService {
  private inFlight: Promise<FlushSummary> | null = null;
  private tombstoneInFlight: Promise<void> | null = null;

  constructor(private readonly deps: CheckinSyncDeps) {}

  /** 本地写入后登记待同步。同一记录重复登记会被合并成一条（见 pendingSync.coalesceOp） */
  markDirty(domain: SyncDomain, op: SyncOp, ref: CheckinRef): void {
    queuePendingSync(
      this.deps.storage,
      { domain, op, clientId: ref.id, date: ref.date },
      this.now(),
    );
  }

  /** 待同步条目数，可用于在界面上提示「N 条待同步」 */
  pendingCount(): number {
    return readPendingSync(this.deps.storage).length;
  }

  /**
   * 拉取并应用墓碑（删除日志）：让「别的设备删掉的记录」在本机也消失。
   *
   * 这是跨设备删除同步的落地（详见 `docs/0.3.4-cross-device-delete-sync.md`）。
   * 之所以需要墓碑而不是「云端没有即删除」：本地有大量**从未上云的历史记录**，
   * 它们同样表现为「云端没有」，靠推断会把这些记录全部误删。
   *
   * ⚠️ **删除优先**：被墓碑命中的记录，连同它身上可能存在的待同步标记一起清掉。
   * 不清的话，`push` 的 `add` 分支会把记录重新建回云端 ——
   * A 端刚删又看到它，两端来回横跳，比丢一次离线编辑严重。
   */
  async applyTombstones(): Promise<TombstoneSummary> {
    const since = readTombstoneCursor(this.deps.storage);
    const items = await this.deps.tombstoneRemote.listAll(since);

    let removed = 0;
    for (const [domain, list] of groupTombstonesByDomain(items)) {
      for (const item of list) {
        if (this.removeLocalByTombstone(domain, item.clientId, item.date)) {
          removed += 1;
          // 不传 queuedAt = 无条件丢弃（不做代次校验），因为删除优先于任何待推送的修改
          dropPendingSync(this.deps.storage, domain, item.clientId);
        }
      }
    }

    const cursor = nextTombstoneCursor(since, items);
    writeTombstoneCursor(this.deps.storage, cursor);
    return { fetched: items.length, removed, cursor };
  }

  /**
   * 保证本轮已经应用过墓碑；并发调用共享同一次执行。
   *
   * ⚠️ 失败时**只告警、不抛出**：删除同步是增强能力，
   * 不该因为它挂了就让整个读取流程拿不到数据（本地已先渲染过画面）。
   */
  private ensureTombstonesApplied(): Promise<void> {
    if (this.tombstoneInFlight) {
      return this.tombstoneInFlight;
    }
    const run = this.applyTombstones()
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn('[同步] 墓碑应用失败，本轮跳过删除同步：', error);
      })
      .finally(() => {
        this.tombstoneInFlight = null;
      });
    this.tombstoneInFlight = run;
    return run;
  }

  /** 按 id 删掉本地记录；本地本来就没有则返回 false（不产生多余写操作） */
  private removeLocalByTombstone(domain: SyncDomain, clientId: string, hintDate = ''): boolean {
    switch (domain) {
      case 'diet':
        return this.removeFromPartitioned(this.deps.dietRepository, clientId, hintDate);
      case 'workout':
        return this.removeFromPartitioned(this.deps.workoutRepository, clientId, hintDate);
      case 'studyCheckin':
        return this.removeFromPartitioned(this.deps.studyCheckinRepository, clientId, hintDate);
      case 'studyPlan':
        return this.removeStudyPlanLocal(clientId);
      case 'mealPlan':
        // 食谱的本地存储同样按日期分区，直接复用分区删除（含 hintDate 兜底）
        return this.removeFromPartitioned(this.deps.mealPlanRepository, clientId, hintDate);
      case 'travelPlan':
        return this.removeTravelPlanLocal(clientId);
      case 'travelItem':
        return this.removeTravelItemLocal(clientId);
      default:
        return false;
    }
  }

  /**
   * 「按日期分区存储」的仓储通用的按 id 删除。
   *
   * ⚠️ 要同时清两个日期：**记录自身的 date** 与**墓碑上带的 date**。
   * 正常情况两者一致；但历史脏数据里可能存在「存在 A 日期键下、date 字段却是 B」的记录，
   * 只清其中一个会漏删，漏删的后果是「删不掉的记录」，比多清一次严重。
   * （这条正是被单测逼出来的：用例里 checkin-2 就属于这种不一致数据。）
   */
  private removeFromPartitioned<T extends { id: string; date: string }>(
    repo: {
      getAll(): T[];
      getByDate(date: string): T[];
      saveByDate(date: string, entries: T[]): void;
    },
    clientId: string,
    hintDate = '',
  ): boolean {
    const dates = new Set<string>();
    for (const entry of repo.getAll()) {
      if (entry.id === clientId) {
        dates.add(entry.date);
      }
    }
    if (dates.size === 0 && !hintDate) {
      return false;
    }
    if (hintDate) {
      dates.add(hintDate);
    }

    let removed = false;
    for (const date of dates) {
      const before = repo.getByDate(date);
      const next = before.filter((entry) => entry.id !== clientId);
      if (next.length !== before.length) {
        repo.saveByDate(date, next);
        removed = true;
      }
    }
    return removed;
  }

  /** 学习计划是全量单键存储（不分日期），单独处理 */
  private removeStudyPlanLocal(clientId: string): boolean {
    const all = this.deps.studyPlanRepository.getAll();
    if (!all.some((plan) => plan.id === clientId)) {
      return false;
    }
    this.deps.studyPlanRepository.saveAll(all.filter((plan) => plan.id !== clientId));
    return true;
  }

  /**
   * 出行计划同样是全量单键存储。
   *
   * ⚠️ 明细嵌在计划里，删计划即连同它的 `items` 一起消失 ——
   * 云端级联删明细时也会为每条明细写 `travelItem` 墓碑，
   * 那些墓碑随后到达时本地已经找不到对应明细，`removeTravelItemLocal` 返回 false，
   * 不会产生多余写操作，也不会报错。
   */
  private removeTravelPlanLocal(clientId: string): boolean {
    const all = this.deps.travelRepository.getAll();
    if (!all.some((plan) => plan.id === clientId)) {
      return false;
    }
    this.deps.travelRepository.saveAll(all.filter((plan) => plan.id !== clientId));
    return true;
  }

  /**
   * 删除一条行程明细 —— 明细嵌在计划里，所以要**扫全部计划**找到承载它的那份，
   * 只回写被改动的那份计划。
   *
   * 扫全部而不是按某份计划定位：墓碑里只有 `clientId`，云端 `travel_items`
   * 虽是独立集合、带 `travelId`，但墓碑不带 `travelId`（明细 id 全局唯一，够用）。
   * 家庭出行明细的量级（十几条）下这点扫描可以忽略。
   */
  private removeTravelItemLocal(clientId: string): boolean {
    const plans = this.deps.travelRepository.getAll();
    let removed = false;

    const next = plans.map((plan) => {
      if (!plan.items.some((item) => item.id === clientId)) {
        return plan;
      }
      removed = true;
      return { ...plan, items: plan.items.filter((item) => item.id !== clientId) };
    });

    if (removed) {
      this.deps.travelRepository.saveAll(next);
    }
    return removed;
  }

  /**
   * 拉取某日饮食记录并与本地合并，合并结果回写本地缓存后返回。
   * 云端失败的异常**会向上抛出**，由调用方决定是否保留本地画面（本地已先渲染过）。
   *
   * ⚠️ 合并前**先应用墓碑**：否则本地那条已被别处删除的记录会被当成
   * 「本地独有」保留下来，合并结果又把它写回本地 —— 删了等于没删。
   */
  async pullDiets(date: string): Promise<DietEntry[]> {
    await this.ensureTombstonesApplied();
    const local = this.deps.dietRepository.getByDate(date);
    const remote = await this.deps.dietRemote.listByDate(date);
    const merged = mergeCheckins(local, remote, this.pendingIds('diet'));
    this.deps.dietRepository.saveByDate(date, merged);
    return merged;
  }

  /** 拉取某日运动记录并与本地合并，逻辑同 `pullDiets` */
  async pullWorkouts(date: string): Promise<WorkoutEntry[]> {
    await this.ensureTombstonesApplied();
    const local = this.deps.workoutRepository.getByDate(date);
    const remote = await this.deps.workoutRemote.listByDate(date);
    const merged = mergeCheckins(local, remote, this.pendingIds('workout'));
    this.deps.workoutRepository.saveByDate(date, merged);
    return merged;
  }

  /**
   * 拉取**全部**学习计划并与本地合并。
   *
   * ⚠️ 与饮食 / 运动不同：计划**不分日期**（本地也是单键存全部），
   * 所以这里没有 date 参数，拉的是全量列表。
   */
  async pullStudyPlans(): Promise<StudyPlan[]> {
    await this.ensureTombstonesApplied();
    const local = this.deps.studyPlanRepository.getAll();
    const remote = await this.deps.studyPlanRemote.list();
    const merged = mergeCheckins(local, remote, this.pendingIds('studyPlan'));
    this.deps.studyPlanRepository.saveAll(merged);
    return merged;
  }

  /** 拉取某日学习打卡并与本地合并（打卡按日期组织，同饮食 / 运动） */
  async pullStudyCheckins(date: string): Promise<StudyCheckin[]> {
    await this.ensureTombstonesApplied();
    const local = this.deps.studyCheckinRepository.getByDate(date);
    const remote = await this.deps.studyCheckinRemote.listByDate(date);
    const merged = mergeCheckins(local, remote, this.pendingIds('studyCheckin'));
    this.deps.studyCheckinRepository.saveByDate(date, merged);
    return merged;
  }

  /** 拉取某日食谱并与本地合并（同饮食 / 运动：本地按日期分区） */
  async pullMealPlans(date: string): Promise<MealPlan[]> {
    await this.ensureTombstonesApplied();
    const local = this.deps.mealPlanRepository.getByDate(date);
    const remote = await this.deps.mealPlanRemote.listByDate(date);
    const merged = mergeCheckins(local, remote, this.pendingIds('mealPlan'));
    this.deps.mealPlanRepository.saveByDate(date, merged);
    return merged;
  }

  /**
   * 拉取**全部**出行计划并与本地合并。
   *
   * ⚠️ 与其它 pull 的**关键差别**：云端 `listPlans` 返回的 `items` 恒为空数组
   * —— 它是「全家庭一次查、上限 500 条」的便捷聚合，明细多的家庭会被截断，
   * 只服务于首屏渲染，**不是明细的权威口径**。
   *
   * 所以这里绝不能像其它领域那样「整条记录以云端为准」回写：那会把本地明细整体抹掉。
   * 合并结果一律把**本地 items 原样贴回**；明细的增 / 删 / 改完全不经过这条路径，
   * 它的权威口径是 `pullTravelItems(travelId)`（按计划查，天然有界）。
   */
  async pullTravelPlans(): Promise<TravelPlan[]> {
    await this.ensureTombstonesApplied();

    const local = this.deps.travelRepository.getAll();
    // ⚠️ 必须在 ensureTombstonesApplied() 之后读：墓碑已经把「别处删掉的明细」
    //    从本地计划里摘掉了，这里贴回的才是清理过的版本。
    const localItems = new Map(local.map((plan) => [plan.id, plan.items]));

    const remote = await this.deps.travelPlanRemote.list();
    const merged = mergeCheckins(local, remote, this.pendingIds('travelPlan')).map((plan) => ({
      ...plan,
      // 云端来的恒为空；本地独有 / 待同步的计划则原样保留自己的明细
      items: localItems.get(plan.id) ?? [],
    }));

    this.deps.travelRepository.saveAll(merged);
    return merged;
  }

  /**
   * 拉取某个计划的全部行程明细，合并进本地计划后回写。
   *
   * 返回合并后的明细列表。**计划不在本地时返回空数组**而不是抛错：
   * 「另一台设备刚建的计划」与「它的明细」是两个独立的拉取动作，
   * 明细先到的时序是正常的，不该让整个读取流程失败。
   */
  async pullTravelItems(travelId: string): Promise<TravelItem[]> {
    await this.ensureTombstonesApplied();

    const plans = this.deps.travelRepository.getAll();
    const index = plans.findIndex((plan) => plan.id === travelId);
    if (index === -1) {
      return [];
    }

    const local = plans[index].items;
    const remote = await this.deps.travelItemRemote.listByPlan(travelId);
    // 云端返回顺序不保证稳定，用 order 还原（老数据缺 order 时按下标兜底）
    const merged = sortTravelItems(mergeCheckins(local, remote, this.pendingIds('travelItem')));

    plans[index] = { ...plans[index], items: merged };
    this.deps.travelRepository.saveAll(plans);
    return merged;
  }

  /**
   * 重发全部待同步标记。
   *
   * 并发调用共享同一次执行：`onShow` 与 App 回前台可能几乎同时触发，
   * 不共享的话会对同一条记录并发推两次。
   */
  flush(): Promise<FlushSummary> {
    if (this.inFlight) {
      return this.inFlight;
    }
    const run = this.runFlush().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  /**
   * 直连推送一次「行程明细勾选」（M3 第 7 步）。
   *
   * ⚠️ **为什么不走队列**：队列的 `SyncOp` 只有 `add / update / remove`，
   * 表达不了「翻转」—— 而翻转恰恰是这个动作的全部意义：
   * 两端同时点同一条明细时，服务端**串行翻转**后结果确定；
   * 若改成「设值」，最终状态取决于谁后到，还可能把对方的勾选覆盖掉。
   * 所以在线时直接调服务端的翻转接口。
   *
   * ⚠️ **失败时降级为排一条 `travelItem` update 标记**，而不是把错误丢掉：
   * 网络抖动 / 未入家庭都会走到这里。降级后推上去的是「整条明细含 done」，
   * 语义上退化成 last-write-wins，但**比「离线勾选直接被云端旧值覆盖回去」好得多**，
   * 而且出队 / 重试复用了常规 `flush()` 那一套（含 5 次上限）。
   *
   * 调用方拿到 `synced: true` 时应当用 `done` 校正本地 ——
   * 本地那次翻转只是乐观展示，权威值在服务端。
   *
   * ⚠️ 前置条件（已登录且已加入家庭）由调用方判断，同 `flush()` / `pullXxx()`。
   */
  async toggleTravelItem(itemId: string): Promise<ToggleTravelItemResult> {
    try {
      const result = await this.deps.travelItemRemote.toggle(itemId);
      const done = result?.done;
      // ⚠️ 别把「响应缺 done」硬写成 false —— 那会把用户刚勾上的明细静默改成未勾选。
      // 拿不到布尔值就只报「连上了」，让调用方保留本地乐观值。
      return { synced: true, done: typeof done === 'boolean' ? done : undefined };
    } catch (error) {
      console.warn('[同步] 明细勾选直连失败，降级为排队重发:', error);
      this.markDirty('travelItem', 'update', { id: itemId, date: '' });
      return { synced: false };
    }
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private pendingIds(domain: SyncDomain): Set<string> {
    return pendingClientIds(readPendingSync(this.deps.storage), domain);
  }

  private async runFlush(): Promise<FlushSummary> {
    const summary: FlushSummary = { attempted: 0, succeeded: 0, failed: 0, dropped: 0 };

    // 先用快照：推送过程中标记可能被新增或重新入队，本轮只负责快照内的条目，
    // 新产生的标记留给下一轮（配合 queuedAt 代次校验，不会误清新标记）。
    const snapshot = readPendingSync(this.deps.storage);

    for (const item of snapshot) {
      summary.attempted += 1;

      let outcome: PushOutcome;
      try {
        outcome = await this.pushOne(item);
      } catch (error) {
        const failed = failPendingSync(
          this.deps.storage,
          item.domain,
          item.clientId,
          error,
          item.queuedAt,
        );
        if (failed && failed.attempts >= MAX_SYNC_ATTEMPTS) {
          dropPendingSync(this.deps.storage, item.domain, item.clientId, item.queuedAt);
          console.warn(
            `[同步] ${item.domain}/${item.clientId} 连续失败 ${failed.attempts} 次，放弃重试：`,
            failed.lastError,
          );
          summary.dropped += 1;
        } else {
          summary.failed += 1;
        }
        continue;
      }

      // 本地已无内容可推（缓存被清过、记录已被删）——标记失去意义，直接放弃
      if (outcome === 'skip') {
        dropPendingSync(this.deps.storage, item.domain, item.clientId, item.queuedAt);
        summary.dropped += 1;
        continue;
      }

      dequeuePendingSync(this.deps.storage, item.domain, item.clientId, item.queuedAt);
      summary.succeeded += 1;
    }

    return summary;
  }

  private pushOne(item: PendingSyncItem): Promise<PushOutcome> {
    switch (item.domain) {
      case 'diet':
        return this.pushDiet(item);
      case 'workout':
        return this.pushWorkout(item);
      case 'studyPlan':
        return this.pushStudyPlan(item);
      case 'studyCheckin':
        return this.pushStudyCheckin(item);
      case 'mealPlan':
        return this.pushMealPlan(item);
      case 'travelPlan':
        return this.pushTravelPlan(item);
      case 'travelItem':
        return this.pushTravelItem(item);
      default:
        // 未知 domain（例如降级后读到更高版本写入的标记）：直接跳过，
        // 由调用方当作「本地无内容可推」放弃，避免死循环
        return Promise.resolve('skip');
    }
  }

  private async pushDiet(item: PendingSyncItem): Promise<PushOutcome> {
    if (item.op === 'remove') {
      // date 仅作墓碑兜底（记录已不存在时），删不到也不影响删除本身
      await this.deps.dietRemote.remove(item.clientId, item.date);
      return 'ok';
    }

    const entry = this.findDiet(item);
    if (!entry) {
      return 'skip';
    }

    if (item.op === 'update') {
      await this.deps.dietRemote.update(entry);
      return 'ok';
    }

    const result = await this.deps.dietRemote.create(entry);
    if (result?.duplicated) {
      // 服务端已有同 clientId：多半是首次 add 的响应丢了（其实已写入）。
      // 云端 add 命中重复时**不会更新内容**，若不再补一次 update，
      // 用户在首次 add 之后做的编辑就会永远停在云端旧版本。
      await this.deps.dietRemote.update(entry);
    }
    return 'ok';
  }

  private async pushWorkout(item: PendingSyncItem): Promise<PushOutcome> {
    if (item.op === 'remove') {
      await this.deps.workoutRemote.remove(item.clientId, item.date);
      return 'ok';
    }

    const entry = this.findWorkout(item);
    if (!entry) {
      return 'skip';
    }

    if (item.op === 'update') {
      await this.deps.workoutRemote.update(entry);
      return 'ok';
    }

    const result = await this.deps.workoutRemote.create(entry);
    if (result?.duplicated) {
      await this.deps.workoutRemote.update(entry);
    }
    return 'ok';
  }

  /**
   * 推送学习计划。
   *
   * `remove` 分支**不需要**本地还留着这份计划 —— 与饮食 / 运动一致。
   * 服务端会级联删掉该计划的全部打卡；本地那份级联由 `StudyService.removePlan`
   * 在删除当时就完成了，所以这里不做重复清理。
   */
  private async pushStudyPlan(item: PendingSyncItem): Promise<PushOutcome> {
    if (item.op === 'remove') {
      await this.deps.studyPlanRemote.remove(item.clientId);
      return 'ok';
    }

    const plan = this.findStudyPlan(item);
    if (!plan) {
      return 'skip';
    }

    if (item.op === 'update') {
      await this.deps.studyPlanRemote.update(plan);
      return 'ok';
    }

    const result = await this.deps.studyPlanRemote.create(plan);
    if (result?.duplicated) {
      // 服务端已有同 clientId（多半是首次 add 的响应丢了，其实已写入）。
      // 云端 add 命中重复时**不会更新内容**，不再补一次 update 的话，
      // 用户在首次 add 之后做的编辑会永远停在云端旧版本。规则同饮食 / 运动。
      await this.deps.studyPlanRemote.update(plan);
    }
    return 'ok';
  }

  /**
   * 推送学习打卡。
   *
   * ⚠️ 打卡**没有 update 动作**（本地 `StudyService` 也只支持打卡 / 取消打卡），
   * 所以 `update` 与 `add` 同样走 `create` —— 服务端 `addCheckin` 本身幂等，
   * 不会产生副作用。
   */
  private async pushStudyCheckin(item: PendingSyncItem): Promise<PushOutcome> {
    if (item.op === 'remove') {
      await this.deps.studyCheckinRemote.remove(item.clientId, item.date);
      return 'ok';
    }

    const checkin = this.findStudyCheckin(item);
    if (!checkin) {
      // 本地已无这条打卡（例如所属计划被删、级联清理掉了）——
      // 标记失去意义，直接放弃，不去打一次注定 404 的云调用
      return 'skip';
    }

    await this.deps.studyCheckinRemote.create(checkin);
    return 'ok';
  }

  /**
   * 推送食谱。与饮食 / 运动同构：`remove` 不需要本地还留着记录；
   * `add` 命中 `duplicated`（首次 add 的响应丢了、其实已写入）时补一次 `update`，
   * 否则用户在首次 add 之后做的编辑会永远停在云端旧版本。
   */
  private async pushMealPlan(item: PendingSyncItem): Promise<PushOutcome> {
    if (item.op === 'remove') {
      // date 仅作墓碑兜底（记录已不存在时帮别的设备定位本地分区）
      await this.deps.mealPlanRemote.remove(item.clientId, item.date);
      return 'ok';
    }

    const plan = this.findMealPlan(item);
    if (!plan) {
      return 'skip';
    }

    if (item.op === 'update') {
      await this.deps.mealPlanRemote.update(plan);
      return 'ok';
    }

    const result = await this.deps.mealPlanRemote.create(plan);
    if (result?.duplicated) {
      await this.deps.mealPlanRemote.update(plan);
    }
    return 'ok';
  }

  /**
   * 推送出行计划本体（**不含明细** —— `toCloudTravelPlan` 会把 `items` 丢掉，
   * 明细由 `pushTravelItem` 逐条下发）。
   *
   * ⚠️ `remove` 的返回值不能忽略一个事实：服务端在「明细一次没删完」时会
   * **拒绝删除计划**并返回可重试的失败（`TravelPlanRemoteRepo.remove` 会抛出）。
   * 这里刻意不 catch —— 抛出去才会走失败重试，吞掉就等于
   * 「计划没删成功但待同步标记被清掉」，两边永久不一致。
   */
  private async pushTravelPlan(item: PendingSyncItem): Promise<PushOutcome> {
    if (item.op === 'remove') {
      await this.deps.travelPlanRemote.remove(item.clientId);
      return 'ok';
    }

    const plan = this.findTravelPlan(item);
    if (!plan) {
      return 'skip';
    }

    if (item.op === 'update') {
      await this.deps.travelPlanRemote.update(plan);
      return 'ok';
    }

    const result = await this.deps.travelPlanRemote.create(plan);
    if (result?.duplicated) {
      await this.deps.travelPlanRemote.update(plan);
    }
    return 'ok';
  }

  /**
   * 推送单条行程明细。
   *
   * ⚠️ 明细自己**不知道归属**：`travelId` 只存在于「计划 → 它的 items」这一层。
   *    所以推送前必须先扫本地计划找到承载它的那一份；找不到就 `skip` ——
   *    给不存在的计划塞明细会被云端的主从约束拒绝（留下永久孤儿），
   *    而这条标记重试多少次都不会成功。
   *
   * ⚠️ `create` / `update` 都要带 `fallbackOrder`（明细在计划里的下标）：
   *    老数据没有 `order` 字段，云端靠它兜底，否则所有明细的顺序会挤到 0。
   */
  private async pushTravelItem(item: PendingSyncItem): Promise<PushOutcome> {
    if (item.op === 'remove') {
      await this.deps.travelItemRemote.remove(item.clientId);
      return 'ok';
    }

    const found = this.findTravelItem(item);
    if (!found) {
      return 'skip';
    }

    const { travelId, entry, fallbackOrder } = found;

    if (item.op === 'update') {
      await this.deps.travelItemRemote.update(travelId, entry, fallbackOrder);
      return 'ok';
    }

    const result = await this.deps.travelItemRemote.create(travelId, entry, fallbackOrder);
    if (result?.duplicated) {
      // 服务端 add 命中重复时**不会更新内容**，补一次 update 把内容对齐（规则同其它领域）
      await this.deps.travelItemRemote.update(travelId, entry, fallbackOrder);
    }
    return 'ok';
  }

  /** 计划是全量列表，直接按 id 找（没有日期分区，无需按日期兜底） */
  private findStudyPlan(item: PendingSyncItem): StudyPlan | undefined {
    return this.deps.studyPlanRepository
      .getAll()
      .find((plan) => plan.id === item.clientId);
  }

  /** 按标记里记的日期找；找不到再全量兜底一次（记录可能被改到了别的日期） */
  private findStudyCheckin(item: PendingSyncItem): StudyCheckin | undefined {
    const inDate = this.deps.studyCheckinRepository
      .getByDate(item.date)
      .find((checkin) => checkin.id === item.clientId);
    return (
      inDate ??
      this.deps.studyCheckinRepository.getAll().find((checkin) => checkin.id === item.clientId)
    );
  }

  /** 按标记里记的日期找；找不到再全量兜底一次（记录可能被改到了别的日期） */
  private findDiet(item: PendingSyncItem): DietEntry | undefined {
    const inDate = this.deps.dietRepository
      .getByDate(item.date)
      .find((entry) => entry.id === item.clientId);
    return inDate ?? this.deps.dietRepository.getAll().find((entry) => entry.id === item.clientId);
  }

  private findWorkout(item: PendingSyncItem): WorkoutEntry | undefined {
    const inDate = this.deps.workoutRepository
      .getByDate(item.date)
      .find((entry) => entry.id === item.clientId);
    return (
      inDate ?? this.deps.workoutRepository.getAll().find((entry) => entry.id === item.clientId)
    );
  }

  /** 按标记里记的日期找；找不到再全量兜底一次（记录可能被改到了别的日期） */
  private findMealPlan(item: PendingSyncItem): MealPlan | undefined {
    const inDate = this.deps.mealPlanRepository
      .getByDate(item.date)
      .find((plan) => plan.id === item.clientId);
    return (
      inDate ?? this.deps.mealPlanRepository.getAll().find((plan) => plan.id === item.clientId)
    );
  }

  /** 计划是全量列表，直接按 id 找（没有日期分区，无需按日期兜底） */
  private findTravelPlan(item: PendingSyncItem): TravelPlan | undefined {
    return this.deps.travelRepository.getAll().find((plan) => plan.id === item.clientId);
  }

  /**
   * 找承载某条明细的计划 —— 明细没有独立的本地仓储，必须扫全部计划的 `items`。
   *
   * 同时把明细在数组里的下标作为 `fallbackOrder` 返回：老数据缺 `order` 时
   * 云端按它兜底排序，否则顺序会全部挤到 0。
   */
  private findTravelItem(
    item: PendingSyncItem,
  ): { travelId: string; entry: TravelItem; fallbackOrder: number } | undefined {
    for (const plan of this.deps.travelRepository.getAll()) {
      const index = plan.items.findIndex((entry) => entry.id === item.clientId);
      if (index !== -1) {
        return { travelId: plan.id, entry: plan.items[index], fallbackOrder: index };
      }
    }
    return undefined;
  }
}
