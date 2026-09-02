<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { useDietStore } from '@/stores/diet';
import type { DietEntry } from '@/types/models';
import type { DietDraft } from '@/services/DietService';
import { formatDateKey, isValidDateKey, todayKey } from '@/utils/date';
import { mealLabel, nutritionText } from '@/utils/format';
import { errorMessage } from '@/utils/error';
import DietForm from '@/components/DietForm.vue';

const dietStore = useDietStore();

const date = ref(todayKey());
const formVisible = ref(false);
const editingEntry = ref<DietEntry | null>(null);

onLoad((options) => {
  const queryDate = options?.date;
  date.value = typeof queryDate === 'string' && isValidDateKey(queryDate)
    ? queryDate
    : todayKey();
});

onShow(() => {
  dietStore.load(date.value);
});

function startAdd(): void {
  editingEntry.value = null;
  formVisible.value = true;
}

function startEdit(entry: DietEntry): void {
  editingEntry.value = entry;
  formVisible.value = true;
}

function closeForm(): void {
  formVisible.value = false;
  editingEntry.value = null;
}

function save(draft: DietDraft): void {
  try {
    if (editingEntry.value) {
      dietStore.update(date.value, editingEntry.value.id, draft);
    } else {
      dietStore.add(date.value, draft);
    }
    uni.showToast({ title: '已保存', icon: 'success' });
    closeForm();
  } catch (error) {
    uni.showModal({
      title: '保存失败',
      content: errorMessage(error, '请检查填写内容'),
      showCancel: false,
    });
  }
}

function remove(entry: DietEntry): void {
  uni.showModal({
    title: '删除饮食记录',
    content: `确定删除「${entry.foodName}」吗？`,
    success: (result) => {
      if (!result.confirm) {
        return;
      }

      try {
        dietStore.remove(date.value, entry.id);
        uni.showToast({ title: '已删除', icon: 'success' });
      } catch (error) {
        uni.showModal({
          title: '删除失败',
          content: errorMessage(error),
          showCancel: false,
        });
      }
    },
  });
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">饮食记录</text>
      <text class="page-subtitle">{{ formatDateKey(date) }}</text>
    </view>

    <view class="section">
      <button class="btn btn-primary btn-block" @tap="startAdd">新增饮食记录</button>
    </view>

    <view v-if="formVisible" class="section">
      <DietForm
        :date="date"
        :entry="editingEntry"
        @save="save"
        @cancel="closeForm"
      />
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">当天记录</text>
        <text class="page-subtitle page-subtitle-tight">{{ dietStore.entries.length }} 条</text>
      </view>

      <view v-if="dietStore.entries.length" class="record-list">
        <view
          v-for="entry in dietStore.entries"
          :key="entry.id"
          class="record-card"
        >
          <text class="record-title">{{ mealLabel(entry) }} · {{ entry.foodName }}</text>
          <text class="record-meta">数量：{{ entry.quantity }}</text>
          <text v-if="nutritionText(entry)" class="record-meta">{{ nutritionText(entry) }}</text>

          <view class="record-actions">
            <button class="btn btn-secondary" @tap="startEdit(entry)">编辑</button>
            <button class="btn btn-danger" @tap="remove(entry)">删除</button>
          </view>
        </view>
      </view>
      <view v-else class="empty">还没有饮食记录</view>
    </view>
  </view>
</template>

