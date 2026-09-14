import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { BackupPayload } from '@/types/models';
import type { CloudImportRecord, ImportOutcome, ImportPlan } from '@/utils/importData';
import { createBackupService, createDataImportService } from '@/services';
import { isCheckinCloudReady } from '@/services/checkinRuntime';

/**
 * 数据备份 / 恢复 store，M4 第 7 步扩展出「上传本机数据到云端」（数据认领）。
 *
 * 两者的关系要说清楚，否则很容易点错：
 * - **导入备份 JSON**：纯本机操作，会**覆盖**本机全部记录（原有语义）；
 * - **上传到云端**：只读本机、往云端补写，**不动本机任何数据**，
 *   且幂等（云端按 `clientId` 去重），可以重复点。
 */
export const useBackupStore = defineStore('backup', () => {
  const lastExport = ref<BackupPayload | null>(null);

  /** 待确认的导入计划（先给用户看条数，再动手） */
  const importPlan = ref<ImportPlan | null>(null);
  const importing = ref(false);
  const importProgress = ref({ done: 0, total: 0 });
  /**
   * 上一次上传的结果。**刻意从本机留档里读出来**（而不是只放在内存）：
   * 一次导入要跑几十秒，用户很可能中途杀掉小程序 —— 回来时结果还在，
   * 才不至于「传没传成功只能靠翻云端列表猜」。
   */
  const lastCloudImport = ref<CloudImportRecord | null>(null);

  function exportData(): BackupPayload {
    const payload = createBackupService().export();
    lastExport.value = payload;
    return payload;
  }

  function importData(payload: BackupPayload): void {
    createBackupService().import(payload);
  }

  /** 云同步前置条件：已登录 **且** 已加入家庭（未满足时按钮应直接提示） */
  function cloudReady(): boolean {
    return isCheckinCloudReady();
  }

  /** 读本机留档（页面 `onShow` 调用） */
  function loadCloudImportRecord(): CloudImportRecord | null {
    lastCloudImport.value = createBackupService().readImportRecord();
    return lastCloudImport.value;
  }

  /**
   * 拍一份导入计划供用户确认。
   *
   * **只读本机**：不产生待同步标记、不发任何请求 —— 用户在这个阶段点取消，
   * 本机与云端都必须原样不动。
   */
  function previewCloudImport(): ImportPlan {
    const plan = createDataImportService().plan();
    importPlan.value = plan;
    return plan;
  }

  /**
   * 执行上传。
   *
   * ⚠️ 不在 Service 层做前置判断，而是**在入口处一次性拦掉**：
   *    未登录 / 未加入家庭时逐条请求会全部失败，几千条记录会白跑一轮、
   *    还把失败清单刷成几千条，用户根本没法看懂。
   */
  async function runCloudImport(): Promise<ImportOutcome> {
    if (!cloudReady()) {
      throw new Error('请先登录并加入家庭，再上传本机数据');
    }

    const plan = importPlan.value ?? previewCloudImport();
    importing.value = true;
    importProgress.value = { done: 0, total: plan.total };
    try {
      const service = createDataImportService();
      const outcome = await service.run(plan, (done, total) => {
        importProgress.value = { done, total };
      });

      const record: CloudImportRecord = {
        finishedAt: new Date().toISOString(),
        attempted: outcome.attempted,
        created: outcome.created,
        duplicated: outcome.duplicated,
        failed: outcome.failed,
        skippedDuplicates: plan.skippedDuplicates,
      };
      createBackupService().saveImportRecord(record);
      lastCloudImport.value = record;

      return outcome;
    } finally {
      importing.value = false;
    }
  }

  return {
    lastExport,
    importPlan,
    importing,
    importProgress,
    lastCloudImport,
    exportData,
    importData,
    cloudReady,
    loadCloudImportRecord,
    previewCloudImport,
    runCloudImport,
  };
});
