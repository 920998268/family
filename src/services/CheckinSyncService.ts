import type { DietEntry, WorkoutEntry } from '@/types/models';
import type { StorageAdapter } from '@/storage/StorageAdapter';
import type { DietRepository } from '@/repositories/DietRepository';
import type { WorkoutRepository } from '@/repositories/WorkoutRepository';
import type { DietRemoteRepo } from '@/repositories/remote/DietRemoteRepo';
import type { WorkoutRemoteRepo } from '@/repositories/remote/WorkoutRemoteRepo';
import { mergeCheckins } from '@/utils/checkinMerge';
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
  dietRemote: DietRemoteRepo;
  workoutRemote: WorkoutRemoteRepo;
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
 * 打卡数据同步服务（饮食 + 运动）。
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
export class CheckinSyncService {
  private inFlight: Promise<FlushSummary> | null = null;

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
   * 拉取某日饮食记录并与本地合并，合并结果回写本地缓存后返回。
   * 云端失败的异常**会向上抛出**，由调用方决定是否保留本地画面（本地已先渲染过）。
   */
  async pullDiets(date: string): Promise<DietEntry[]> {
    const local = this.deps.dietRepository.getByDate(date);
    const remote = await this.deps.dietRemote.listByDate(date);
    const merged = mergeCheckins(local, remote, this.pendingIds('diet'));
    this.deps.dietRepository.saveByDate(date, merged);
    return merged;
  }

  /** 拉取某日运动记录并与本地合并，逻辑同 `pullDiets` */
  async pullWorkouts(date: string): Promise<WorkoutEntry[]> {
    const local = this.deps.workoutRepository.getByDate(date);
    const remote = await this.deps.workoutRemote.listByDate(date);
    const merged = mergeCheckins(local, remote, this.pendingIds('workout'));
    this.deps.workoutRepository.saveByDate(date, merged);
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
    return item.domain === 'diet' ? this.pushDiet(item) : this.pushWorkout(item);
  }

  private async pushDiet(item: PendingSyncItem): Promise<PushOutcome> {
    if (item.op === 'remove') {
      await this.deps.dietRemote.remove(item.clientId);
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
      await this.deps.workoutRemote.remove(item.clientId);
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
