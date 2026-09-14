import type {
  BackupPayload,
  DietEntry,
  MealPlan,
  StudyCheckin,
  StudyPlan,
  Transaction,
  TravelItem,
  TravelPlan,
  WorkoutEntry,
} from '@/types/models';
import { errorMessage } from '@/utils/error';

/**
 * 老数据导入（数据认领）的纯逻辑：**枚举 → 依赖排序 → 限并发逐条下发**。
 *
 * 背景：M2-A 起就明确「老数据不主动上云，批量导入留到 M4」。本模块是那次欠账的偿还。
 *
 * ## 两个刻意的设计
 *
 * 1. **复用各域既有的写入接口，不新增批量接口**（方案 §2.1 决策 3）。
 *    导入要覆盖 8 个域、跨 6 个云函数：只给账本加批量接口只解决 1/8；
 *    给 6 个都加则要重传 5 个已部署的云函数。复用既有 `create()` 的额外好处是
 *    **导入与正常写入走完全同一条服务端代码路径** —— 不可能出现
 *    「导入能写进去、正常写入写不进去」的契约漂移。
 *    代价是调用次数多，用**限并发**换时间（千条量级约 35 秒）。
 *
 * 2. **导入层不做字段归一**。归一（`members` 去重、可空文本 `null` ↔ `''`、
 *    明细 `order` 兜底…）全部由既有的映射层 + 云端 lib 负责，那两层都有守卫。
 *    这里只负责「枚举出来、排对顺序、把明细挂到正确的父计划上」。
 */

/**
 * 导入域。**数组顺序即依赖顺序**：父记录必须先于子记录。
 *
 * ⚠️ 为什么顺序是硬约束（不是优化）：云端对子记录有**主从校验** ——
 *    `study/index.js` 的 `addCheckin` 在计划不存在时返回 404「未找到该学习计划」，
 *    `travel/index.js` 的 `addItem` 同理。顺序错了子记录会**整批失败**，
 *    而且失败原因是「父不存在」这种看起来不相关的报错。
 */
export const IMPORT_DOMAINS = [
  'diet',
  'workout',
  'studyPlan',
  'studyCheckin',
  'mealPlan',
  'travelPlan',
  'travelItem',
  'transaction',
] as const;

export type ImportDomain = (typeof IMPORT_DOMAINS)[number];

/**
 * 一条待导入记录。
 *
 * 用**判别联合**而不是 `{ domain, record: unknown }`：明细要带上父计划 id
 * 与在数组里的下标，只有联合类型能强制调用方处理这两个字段。
 */
export type ImportRecord =
  | { domain: 'diet'; record: DietEntry }
  | { domain: 'workout'; record: WorkoutEntry }
  | { domain: 'studyPlan'; record: StudyPlan }
  | { domain: 'studyCheckin'; record: StudyCheckin }
  | { domain: 'mealPlan'; record: MealPlan }
  | { domain: 'travelPlan'; record: TravelPlan }
  | {
      domain: 'travelItem';
      record: TravelItem;
      /** 所属出行计划的 id（= 云端 `travelId` / `clientId`） */
      parentId: string;
      /**
       * 明细在计划数组里的下标。
       *
       * 必须传下去：M3 之前的老明细**没有 `order` 字段**，云端排序靠它兜底，
       * 不传则所有老明细的顺序会一起挤到 0（`toCloudTravelItem` 的第三个参数）。
       */
      fallbackOrder: number;
    }
  | { domain: 'transaction'; record: Transaction };

export interface ImportPlan {
  /** 按 `IMPORT_DOMAINS` 的顺序排好的记录 */
  records: ImportRecord[];
  /** 各域条数（键齐全，缺省 0），供界面展示与核对 */
  counts: Record<ImportDomain, number>;
  /** = `records.length` */
  total: number;
  /**
   * 本机重复 id 被丢弃的条数。
   *
   * 本机存储按日期分区，脏数据里完全可能出现「同一条记录躺在两个日期键下」，
   * 逐条推上去第二次必然幂等命中 —— 白跑一趟，所以在计划阶段就去重。
   * 报出来是为了让「总数对不上」时有据可查，而不是让用户以为丢了数据。
   */
  skippedDuplicates: number;
}

function emptyCounts(): Record<ImportDomain, number> {
  return {
    diet: 0,
    workout: 0,
    studyPlan: 0,
    studyCheckin: 0,
    mealPlan: 0,
    travelPlan: 0,
    travelItem: 0,
    transaction: 0,
  };
}

/**
 * 把本机全量数据（`BackupService.export()` 的产物）拍成一份可执行的导入计划。
 *
 * 纯函数：不读存储、不发请求，因此可以被穷举单测覆盖 ——
 * 这是「导入」这件一次性、难复现的操作里**唯一能被自动化守住**的部分。
 */
export function buildImportPlan(payload: BackupPayload): ImportPlan {
  const counts = emptyCounts();
  const seen = new Set<string>();
  const records: ImportRecord[] = [];
  let skippedDuplicates = 0;

  /** 去重键 = 域 + id（与云端幂等域一致，域间虽然不会撞 id，分开写更清晰） */
  const push = (item: ImportRecord, id: string): void => {
    const key = `${item.domain}:${id}`;
    if (seen.has(key)) {
      skippedDuplicates += 1;
      return;
    }
    seen.add(key);
    counts[item.domain] += 1;
    records.push(item);
  };

  // ---- 打卡三件套 ----
  for (const record of payload.diet) {
    push({ domain: 'diet', record }, record.id);
  }
  for (const record of payload.workout) {
    push({ domain: 'workout', record }, record.id);
  }

  // ---- 学习：计划必须先于打卡（云端有主从校验） ----
  for (const record of payload.studyPlans) {
    push({ domain: 'studyPlan', record }, record.id);
  }
  for (const record of payload.studyCheckins) {
    push({ domain: 'studyCheckin', record }, record.id);
  }

  // ---- 食谱 ----
  for (const record of payload.mealPlans) {
    push({ domain: 'mealPlan', record }, record.id);
  }

  // ---- 出行：计划必须先于明细；明细要从计划里拆出来 ----
  for (const plan of payload.travelPlans) {
    push({ domain: 'travelPlan', record: plan }, plan.id);
  }
  for (const plan of payload.travelPlans) {
    plan.items.forEach((item, index) => {
      push({ domain: 'travelItem', record: item, parentId: plan.id, fallbackOrder: index }, item.id);
    });
  }

  // ---- 账本 ----
  for (const record of payload.transactions) {
    push({ domain: 'transaction', record }, record.id);
  }

  return { records, counts, total: records.length, skippedDuplicates };
}

/** 单条导入的失败明细：必须能定位到具体记录，否则「失败 3 条」没法排查 */
export interface ImportFailure {
  domain: ImportDomain;
  id: string;
  message: string;
}

export interface ImportOutcome {
  /** 计划里排了多少条（不含被去重的） */
  attempted: number;
  /** 真正新建成功的条数 */
  created: number;
  /** 幂等命中、云端本来就有（重复点导入时全是这个） */
  duplicated: number;
  failed: number;
  failures: ImportFailure[];
}

export interface RunImportOptions {
  /** 并发上限，缺省 6 */
  concurrency?: number;
  /** 每完成一条（无论成败）回调一次；用于进度条 */
  onProgress?: (done: number, total: number) => void;
}

/**
 * 并发上限缺省值。
 *
 * 取 6 而不是更高的理由：小程序端同时发起的网络请求数本身有限（微信端 `wx.request`
 * 上限 10），并发太高会被平台排队，反而看不到提速；6 留了余量。
 */
export const DEFAULT_IMPORT_CONCURRENCY = 6;

/** 上限保护：即使调用方传了离谱的值也不会把手机打爆 */
const MAX_IMPORT_CONCURRENCY = 32;

/**
 * 单条下发的返回类型**故意留成 `unknown`**。
 *
 * 实际调用方返回 `CloudWriteResult`（`{ _id, duplicated? }`），
 * 但写死成 `{ duplicated?: boolean }` 会让 TS 的弱类型检查拒绝
 * 「只有 `_id`、没有 `duplicated`」这种同样合法的情况（幂等未命中时服务端就是这样）。
 * 导入真正关心的只有一件事：**这是新建还是幂等命中**，用 `isDuplicatedResult` 判即可。
 */
export type ImportCreateOne = (item: ImportRecord) => Promise<unknown>;

/** 判断一次写入是不是幂等命中（服务端 `duplicated: true`） */
export function isDuplicatedResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') {
    return false;
  }
  return (result as { duplicated?: unknown }).duplicated === true;
}

/**
 * 收敛并发上限。
 *
 * 规则（三条都要，缺一条就会出现「看着没问题、真机变慢或打爆」的模糊地带）：
 * - **没传** → 默认值；
 * - **传了但不是有限数**（`NaN`）→ 收敛到 `1`。这是保守选择：
 *   它是明确的调用方 bug，慢一点比并发打满更安全；
 * - **有限数** → 夹到 `[1, MAX]`（`Infinity` 会自然落到 `MAX`）。
 */
function clampConcurrency(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_IMPORT_CONCURRENCY;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 1;
  }
  return Math.max(1, Math.min(MAX_IMPORT_CONCURRENCY, Math.floor(value)));
}

/**
 * 按计划限并发下发。
 *
 * 三条刻意的行为（都已用测试固化，改的时候别当成 bug）：
 *
 * 1. **单条失败不中断整体**：脏数据只让这一条失败，并按 `domain + id` 记进 `failures`。
 *    导入是「尽力搬迁」，一条坏数据卡住后面几百条是不可接受的；
 * 2. **不重试**：失败留给用户再点一次导入（幂等，已成功的会被跳过）。
 *    在这里加重试等于把「服务端确实拒绝」和「网络抖动」混为一谈，还会放大耗时；
 * 3. **不改动 `records` 顺序决定谁先发**：worker 池按序取号，所以先发的仍是父记录，
 *    并发只是「同时最多 6 条在飞」，不会让子记录抢到父记录前面。
 */
export async function runImportPlan(
  plan: ImportPlan,
  createOne: ImportCreateOne,
  options: RunImportOptions = {},
): Promise<ImportOutcome> {
  const total = plan.total;
  const concurrency = clampConcurrency(options.concurrency);

  const outcome: ImportOutcome = {
    attempted: total,
    created: 0,
    duplicated: 0,
    failed: 0,
    failures: [],
  };

  let cursor = 0;
  let done = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= total) {
        return;
      }

      const item = plan.records[index];
      try {
        const result = await createOne(item);
        if (isDuplicatedResult(result)) {
          outcome.duplicated += 1;
        } else {
          outcome.created += 1;
        }
      } catch (error) {
        outcome.failed += 1;
        outcome.failures.push({
          domain: item.domain,
          id: item.record.id,
          message: errorMessage(error, '云端写入失败'),
        });
      }

      done += 1;
      options.onProgress?.(done, total);
    }
  }

  const workerCount = Math.min(concurrency, total);
  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // 失败清单按域 + id 排一下，界面展示时不会因为并发而每次顺序都变
  outcome.failures.sort((a, b) =>
    a.domain === b.domain ? a.id.localeCompare(b.id) : a.domain.localeCompare(b.domain),
  );

  return outcome;
}
