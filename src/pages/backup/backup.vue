<script setup lang="ts">
import { ref } from 'vue';
import { useBackupStore } from '@/stores/backup';
import type { BackupPayload } from '@/types/models';
import { errorMessage } from '@/utils/error';

const backupStore = useBackupStore();

const exportJson = ref('');
const importText = ref('');

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

    <view class="danger-zone">
      <text class="danger-zone-title">覆盖提醒</text>
      <text class="danger-zone-text">导入前会清除当前设备中的个人信息档案、家庭成员、运动饮食、学习、食谱、出行与收支记录，再写入备份内容。</text>
    </view>
  </view>
</template>
