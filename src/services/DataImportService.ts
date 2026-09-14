import type { BackupPayload } from '@/types/models';
import type { ImportCreateOne, ImportOutcome, ImportPlan } from '@/utils/importData';
import { buildImportPlan, runImportPlan } from '@/utils/importData';
import { createDietRemoteRepo } from '@/repositories/remote/DietRemoteRepo';
import { createWorkoutRemoteRepo } from '@/repositories/remote/WorkoutRemoteRepo';
import { createStudyPlanRemoteRepo } from '@/repositories/remote/StudyPlanRemoteRepo';
import { createStudyCheckinRemoteRepo } from '@/repositories/remote/StudyCheckinRemoteRepo';
import { createMealPlanRemoteRepo } from '@/repositories/remote/MealPlanRemoteRepo';
import { createTravelPlanRemoteRepo } from '@/repositories/remote/TravelPlanRemoteRepo';
import { createTravelItemRemoteRepo } from '@/repositories/remote/TravelItemRemoteRepo';
import { createLedgerRemoteRepo } from '@/repositories/remote/LedgerRemoteRepo';

/**
 * 老数据导入（数据认领）的服务层：**只做两件事** ——
 * 把本机全量拍成计划、把计划逐条发出去。
 *
 * 归一的纯逻辑在 `@/utils/importData`（可穷举单测），逐条下发在这里，
 * 分段理由与 M2 / M3 的服务层一致：**纯函数单独成文件才好被单测直接 require**。
 */

/** 穷尽性检查：`ImportDomain` 新增域时，编译器会在 `switch` 的 `default` 上报错 */
function assertNever(value: never): never {
  throw new Error(`未接入导入的域：${JSON.stringify(value)}`);
}

/**
 * 逐条上行的分发器。
 *
 * ⚠️ 全部分支都走**各域既有的 `create()`**（远端仓储的方法，内部完成
 *    前端模型 → 云端入参的映射）。这样做的关键收益是：
 *    导入与正常写入走**完全同一条服务端代码路径**，不可能出现
 *    「导入能写进去、正常记账写不进去」这种契约漂移。
 *
 * ⚠️ `travelItem` 必须带上 `parentId` 与 `fallbackOrder` 两个参数：
 *    出行明细在本地是内嵌在计划里的数组，云端却是独立集合
 *    （`travel_items`，带 `travelId` 外键）。少传 `parentId` 会被云端主从校验
 *    判为孤儿而整条失败；少传 `fallbackOrder` 会让**老明细的排序一起挤到 0**
 *    （M3 之前的老数据没有 `order` 字段，云端靠这个参数兜底）。
 */
export function createImportSender(): ImportCreateOne {
  const dietRemote = createDietRemoteRepo();
  const workoutRemote = createWorkoutRemoteRepo();
  const studyPlanRemote = createStudyPlanRemoteRepo();
  const studyCheckinRemote = createStudyCheckinRemoteRepo();
  const mealPlanRemote = createMealPlanRemoteRepo();
  const travelPlanRemote = createTravelPlanRemoteRepo();
  const travelItemRemote = createTravelItemRemoteRepo();
  const ledgerRemote = createLedgerRemoteRepo();

  return async function sendOne(item) {
    switch (item.domain) {
      // ---- 打卡三件套 ----
      case 'diet':
        return dietRemote.create(item.record);
      case 'workout':
        return workoutRemote.create(item.record);

      // ---- 学习：打卡依赖计划 ----
      case 'studyPlan':
        return studyPlanRemote.create(item.record);
      case 'studyCheckin':
        return studyCheckinRemote.create(item.record);

      // ---- 食谱 ----
      case 'mealPlan':
        return mealPlanRemote.create(item.record);

      // ---- 出行：计划 → 明细（明细要带父 id 与下标） ----
      case 'travelPlan':
        return travelPlanRemote.create(item.record);
      case 'travelItem':
        return travelItemRemote.create(item.parentId, item.record, item.fallbackOrder);

      // ---- 账本 ----
      case 'transaction':
        return ledgerRemote.create(item.record);

      default:
        return assertNever(item);
    }
  };
}

export interface DataImportDeps {
  /** 读本机全量（复用备份导出 —— 保证「能导入的」与「能备份的」是同一份数据） */
  exportAll(): BackupPayload;
  /** 逐条上行 */
  createOne: ImportCreateOne;
}

export class DataImportService {
  constructor(private readonly deps: DataImportDeps) {}

  /**
   * 拍一份导入计划（**只读本机**：不产生待同步标记、不发任何请求）。
   *
   * 先让用户看到「将上传 N 条、已跳过重复 M 条」再决定，是这个一次性操作
   * 唯一合理的交互 —— 它要往云端写几百上千条记录。
   */
  plan(): ImportPlan {
    return buildImportPlan(this.deps.exportAll());
  }

  /** 按计划限并发下发（单条失败不影响其余，见 `runImportPlan` 的契约） */
  async run(
    plan: ImportPlan,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ImportOutcome> {
    return runImportPlan(plan, this.deps.createOne, { onProgress });
  }
}
