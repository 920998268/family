<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useBackupStore } from '@/stores/backup';
import type { BackupPayload } from '@/types/models';
import { errorMessage } from '@/utils/error';
import type { ImportDomain } from '@/utils/importData';

const backupStore = useBackupStore();

const exportJson = ref('');
const importText = ref('');

/** 各域的中文名（导入报数用；顺序即依赖顺序，见 `IMPORT_DOMAINS`） */
const DOMAIN_LABELS: Record<ImportDomain, string> = {
  diet: '饮食',
  workout: '运动',
  studyPlan: '学习计划',
  studyCheckin: '学习打卡',
  mealPlan: '食谱',
  travelPlan: '出行计划',
  travelItem: '行程明细',
  transaction: '收支',
};

/** 计划里的各域条数（只列非零项，避免一屏全是「0 条」） */
const planLines = computed(() => {
  const plan = backupStore.importPlan;
  if (!plan) {
    return [];
  }
  return (Object.keys(DOMAIN_LABELS) as ImportDomain[])
    .filter((domain) => plan.counts[domain] > 0)
    .map((domain) => `${DOMAIN_LABELS[domain]} ${plan.counts[domain]} 条`);
});

/** 上一次上传的时间，展示成本地可读串（解析失败就原样显示） */
const lastImportTime = computed(() => {
  const finishedAt = backupStore.lastCloudImport?.finishedAt;
  if (!finishedAt) {
    return '';
  }
  const parsed = new Date(finishedAt);
  return Number.isNaN(parsed.getTime()) ? finishedAt : parsed.toLocaleString();
});

onShow(() => {
  backupStore.loadCloudImportRecord();
});

function exportData(): void {
  const payload = backupStore.exportData();
  exportJson.value = JSON.stringify(payload, null, 2);

  uni.setClipboardData({
    data: exportJson.value,
    success: () => {
      uni.showToast({ title: '已复制到剪贴板', icon: 'success' });
    },
  });
}

function importData(): void {
  let payload: BackupPayload;
  try {
    payload = JSON.parse(importText.value) as BackupPayload;
  } catch {
    uni.showModal({
      title: '导入失败',
      content: 'JSON 格式不正确，请检查后重试。',
      showCancel: false,
    });
    return;
  }

  uni.showModal({
    title: '确认导入',
    content: '导入会覆盖当前设备上的全部记录，确定继续吗？',
    confirmText: '覆盖并导入',
    success: (result) => {
      if (!result.confirm) {
        return;
      }

      try {
        backupStore.importData(payload);
        importText.value = '';
        uni.showToast({ title: '导入成功', icon: 'success' });
      } catch (error) {
        uni.showModal({
          title: '导入失败',
          content: errorMessage(error, '请检查备份内容'),
          showCancel: false,
        });
      }
    },
  });
}

function pasteFromClipboard(): void {
  uni.getClipboardData({
    success: (result) => {
      importText.value = result.data;
      uni.showToast({ title: '已粘贴', icon: 'none' });
    },
  });
}

/**
 * 第一步：只读本机、拍一份计划给用户看。
 *
 * ⚠️ 前置检查放在**这里**（而不是等到逐条下发时）：
 *    未登录 / 未加入家庭时请求会全部失败，几千条记录白跑一轮，
 *    失败清单长得没法看 —— 用户根本判断不出发生了什么。
 */
function checkCloudImport(): void {
  if (!backupStore.cloudReady()) {
    uni.showModal({
      title: '暂时不能上传',
      content: '请先登录并加入家庭，再上传本机数据。',
      showCancel: false,
    });
    return;
  }

  const plan = backupStore.previewCloudImport();
  if (plan.total === 0) {
    uni.showModal({
      title: '没有可上传的数据',
      content: '本机还没有饮食、运动、学习、食谱、出行或收支记录。',
      showCancel: false,
    });
    return;
  }

  const detail = planLines.value.map((line) => `· ${line}`).join('\n');
  const skipped =
    plan.skippedDuplicates > 0 ? `\n（另有 ${plan.skippedDuplicates} 条重复记录已自动跳过）` : '';
  uni.showModal({
    title: `将上传 ${plan.total} 条`,
    content: `${detail}${skipped}\n\n不会修改本机数据；云端已有的记录会被跳过，重复点也安全。`,
    showCancel: false,
  });
}

/**
 * 第二步：真正下发。
 *
 * 全程**不排待同步标记**（导入是直连写）：否则一次导入会凭空造出几千条标记，
 * `flush()` 要空跑很久 —— 虽然幂等，纯属浪费。
 * 这一步也**不改本机任何数据**，所以失败重跑是安全的。
 */
async function uploadToCloud(): Promise<void> {
  if (backupStore.importing) {
    return;
  }
  if (!backupStore.importPlan) {
    checkCloudImport();
    return;
  }

  try {
    const outcome = await backupStore.runCloudImport();
    const lines = [
      `新增 ${outcome.created} 条`,
      `云端已有 ${outcome.duplicated} 条`,
      `失败 ${outcome.failed} 条`,
    ];
    if (outcome.failures.length > 0) {
      lines.push('');
      lines.push('失败明细（最多显示 3 条）：');
      for (const failure of outcome.failures.slice(0, 3)) {
        lines.push(`· ${DOMAIN_LABELS[failure.domain]}：${failure.message}`);
      }
    }

    uni.showModal({
      title: outcome.failed > 0 ? '上传完成（有失败）' : '上传完成',
      content: lines.join('\n'),
      showCancel: false,
    });
  } catch (error) {
    uni.showModal({
      title: '上传失败',
      content: errorMessage(error, '请稍后重试'),
      showCancel: false,
    });
  }
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">数据备份</text>
      <text class="page-subtitle">家庭打卡使用本地存储，请定期导出 JSON 文件并妥善保存。</text>
    </view>

    <view class="section">
      <button class="btn btn-primary btn-block" @tap="exportData">导出全部 JSON</button>
      <text class="page-subtitle page-subtitle-spaced">
        导出的数据会复制到剪贴板，你也可以在下方文本框中查看。
      </text>
    </view>

    <view class="section form-card">
      <view class="field">
        <text class="field-label">导出内容</text>
        <textarea
          v-model="exportJson"
          class="field-control field-textarea"
          placeholder="点击导出后显示 JSON"
        />
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">导入备份</text>
        <button class="link-button" @tap="pasteFromClipboard">从剪贴板粘贴</button>
      </view>

      <view class="form-card">
        <view class="field">
          <text class="field-label">备份 JSON</text>
          <textarea
            v-model="importText"
            class="field-control field-textarea"
            placeholder="粘贴之前导出的 JSON"
          />
        </view>

        <button class="btn btn-secondary btn-block" @tap="importData">验证并导入</button>
      </view>
    </view>

    <view class="section">
      <text class="section-title">上传到云端（一次性）</text>
      <text class="page-subtitle">
        把本机上已经积累的记录补传到家庭云端，让其他成员也能看到。只读取本机、不修改本机数据，重复点也安全。
      </text>

      <view class="form-card">
        <button class="btn btn-secondary btn-block" @tap="checkCloudImport">
          检查可上传的数据
        </button>

        <view v-if="backupStore.importPlan" class="import-preview">
          <text class="import-preview-total">
            共 {{ backupStore.importPlan.total }} 条待上传
          </text>
          <text v-for="line in planLines" :key="line" class="import-preview-line">· {{ line }}</text>
          <text v-if="planLines.length === 0" class="import-preview-line">本机暂无记录</text>
          <text v-if="backupStore.importPlan.skippedDuplicates > 0" class="import-preview-line">
            · 已跳过重复 {{ backupStore.importPlan.skippedDuplicates }} 条
          </text>
        </view>

        <button
          class="btn btn-primary btn-block"
          :disabled="backupStore.importing || !backupStore.importPlan"
          @tap="uploadToCloud"
        >
          {{ backupStore.importing ? '上传中…' : '开始上传' }}
        </button>

        <text v-if="backupStore.importing" class="import-progress">
          已完成 {{ backupStore.importProgress.done }} / {{ backupStore.importProgress.total }}
        </text>
      </view>

      <view v-if="backupStore.lastCloudImport" class="import-record">
        <text class="import-record-title">上次上传：{{ lastImportTime }}</text>
        <text class="import-record-text">
          新增 {{ backupStore.lastCloudImport.created }} 条 · 云端已有
          {{ backupStore.lastCloudImport.duplicated }} 条 · 失败
          {{ backupStore.lastCloudImport.failed }} 条
        </text>
        <text v-if="backupStore.lastCloudImport.failed > 0" class="import-record-text">
          有失败项，再点一次「开始上传」即可重试（已成功的会被跳过）。
        </text>
      </view>
    </view>

    <view class="danger-zone">
      <text class="danger-zone-title">覆盖提醒</text>
      <text class="danger-zone-text">导入前会清除当前设备中的个人信息档案、家庭成员、运动饮食、学习、食谱、出行与收支记录，再写入备份内容。</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.import-preview {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  margin: 16rpx 0 20rpx;
}

.import-preview-total {
  color: $uni-text-color;
  font-size: 28rpx;
  font-weight: 600;
}

.import-preview-line,
.import-progress {
  color: $uni-text-color-grey;
  font-size: 24rpx;
}

.import-progress {
  display: block;
  margin-top: 12rpx;
  text-align: center;
}

.import-record {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  margin-top: 20rpx;
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background-color: $uni-bg-color-grey;
}

.import-record-title {
  color: $uni-text-color;
  font-size: 26rpx;
  font-weight: 600;
}

.import-record-text {
  color: $uni-text-color-grey;
  font-size: 24rpx;
}
</style>
