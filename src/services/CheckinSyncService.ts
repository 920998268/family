import type { DietEntry, StudyCheckin, StudyPlan, WorkoutEntry } from '@/types/models';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import type { DietRepository } from '@/repositories/DietRepository';
import type { WorkoutRepository } from '@/repositories/WorkoutRepository';
import type { StudyPlanRepository } from '@/repositories/StudyPlanRepository';
import type { StudyCheckinRepository } from '@/repositories/StudyCheckinRepository';
import type { DietRemoteRepo } from '@/repositories/remote/DietRemoteRepo';
import type { WorkoutRemoteRepo } from '@/repositories/remote/WorkoutRemoteRepo';
import type { StudyPlanRemoteRepo } from '@/repositories/remote/StudyPlanRemoteRepo';
import type { StudyCheckinRemoteRepo } from '@/repositories/remote/StudyCheckinRemoteRepo';
import type { TombstoneRemoteRepo } from '@/repositories/remote/TombstoneRemoteRepo';
import { mergeCheckins } from '@/utils/checkinMerge';
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
  dietRemote: DietRemoteRepo;
  workoutRemote: WorkoutRemoteRepo;
  studyPlanRemote: StudyPlanRemoteRepo;
  studyCheckinRemote: StudyCheckinRemoteRepo;
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
 * 打卡数据同步服务（饮食 + 运动 + 学习计划 + 学习打卡）。
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
}
