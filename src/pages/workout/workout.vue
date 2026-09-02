<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { useWorkoutStore } from '@/stores/workout';
import type { WorkoutEntry } from '@/types/models';
import type { WorkoutDraft } from '@/services/WorkoutService';
import { formatDateKey, isValidDateKey, todayKey } from '@/utils/date';
import { workoutText } from '@/utils/format';
import { errorMessage } from '@/utils/error';
import WorkoutForm from '@/components/WorkoutForm.vue';

const workoutStore = useWorkoutStore();

const date = ref(todayKey());
const formVisible = ref(false);
const editingEntry = ref<WorkoutEntry | null>(null);

onLoad((options) => {
  const queryDate = options?.date;
  date.value = typeof queryDate === 'string' && isValidDateKey(queryDate)
    ? queryDate
    : todayKey();
});

onShow(() => {
  workoutStore.load(date.value);
});

function startAdd(): void {
  editingEntry.value = null;
  formVisible.value = true;
}

function startEdit(entry: WorkoutEntry): void {
  editingEntry.value = entry;
  formVisible.value = true;
}

function closeForm(): void {
  formVisible.value = false;
  editingEntry.value = null;
}

function save(draft: WorkoutDraft): void {
  try {
    if (editingEntry.value) {
      workoutStore.update(date.value, editingEntry.value.id, draft);
    } else {
      workoutStore.add(date.value, draft);
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

function remove(entry: WorkoutEntry): void {
  uni.showModal({
    title: '删除训练记录',
    content: `确定删除「${entry.exerciseName}」吗？`,
    success: (result) => {
      if (!result.confirm) {
        return;
      }

      try {
        workoutStore.remove(date.value, entry.id);
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
      <text class="page-title">训练记录</text>
      <text class="page-subtitle">{{ formatDateKey(date) }}</text>
    </view>

    <view class="section">
      <button class="btn btn-primary btn-block" @tap="startAdd">新增训练记录</button>
    </view>

    <view v-if="formVisible" class="section">
      <WorkoutForm
        :entry="editingEntry"
        @save="save"
        @cancel="closeForm"
      />
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">当天记录</text>
        <text class="page-subtitle" style="margin-top: 0">{{ workoutStore.entries.length }} 条</text>
      </view>

      <view v-if="workoutStore.entries.length" class="record-list">
        <view
          v-for="entry in workoutStore.entries"
          :key="entry.id"
          class="record-card"
        >
          <text class="record-title">{{ entry.exerciseName }}</text>
          <text class="record-meta">{{ workoutText(entry) }}</text>

          <view class="record-actions">
            <button class="btn btn-secondary" @tap="startEdit(entry)">编辑</button>
            <button class="btn btn-danger" @tap="remove(entry)">删除</button>
          </view>
        </view>
      </view>
      <view v-else class="empty">还没有训练记录</view>
    </view>
  </view>
</template>

