<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { useWorkoutStore } from '@/stores/workout';
import { useFamilyStore } from '@/stores/family';
import type { WorkoutEntry } from '@/types/models';
import type { WorkoutDraft } from '@/services/WorkoutService';
import { formatDateKey, isValidDateKey, todayKey } from '@/utils/date';
import { workoutText } from '@/utils/format';
import { errorMessage } from '@/utils/error';
import WorkoutForm from '@/components/WorkoutForm.vue';
import MemberSelect from '@/components/MemberSelect.vue';

const workoutStore = useWorkoutStore();
const familyStore = useFamilyStore();

const date = ref(todayKey());
const memberId = ref<string | undefined>(undefined);
const formVisible = ref(false);
const editingEntry = ref<WorkoutEntry | null>(null);

onLoad((options) => {
  const queryDate = options?.date;
  date.value =
    typeof queryDate === 'string' && isValidDateKey(queryDate)
      ? queryDate
      : todayKey();
});

onShow(() => {
  workoutStore.load(date.value);
  familyStore.load();
});

function onDateChange(event: { detail: { value: string } }): void {
  date.value = event.detail.value;
  workoutStore.load(date.value);
}

function startAdd(): void {
  editingEntry.value = null;
  formVisible.value = true;
}

function startEdit(entry: WorkoutEntry): void {
  editingEntry.value = entry;
  memberId.value = entry.memberId;
  formVisible.value = true;
}

function closeForm(): void {
  formVisible.value = false;
  editingEntry.value = null;
}

function save(draft: WorkoutDraft): void {
  try {
    if (editingEntry.value) {
      workoutStore.update(date.value, editingEntry.value.id, {
        ...draft,
        memberId: memberId.value,
      });
    } else {
      workoutStore.add(date.value, { ...draft, memberId: memberId.value });
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
      <text class="page-title">运动打卡</text>
      <picker mode="date" :value="date" @change="onDateChange">
        <view class="picker-value picker-value-plain page-subtitle page-subtitle-spaced">
          <text>{{ formatDateKey(date) }}</text>
          <text class="picker-arrow">›</text>
        </view>
      </picker>
    </view>

    <view class="section">
      <text class="field-label">打卡成员</text>
      <MemberSelect v-model="memberId" />
    </view>

    <view class="section">
      <button class="btn btn-primary btn-block" @tap="startAdd">新增训练记录</button>
    </view>

    <view v-if="formVisible" class="section">
      <WorkoutForm :entry="editingEntry" @save="save" @cancel="closeForm" />
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">当天记录</text>
        <text class="page-subtitle page-subtitle-tight">{{ workoutStore.entries.length }} 条</text>
      </view>

      <view v-if="workoutStore.entries.length" class="record-list">
        <view v-for="entry in workoutStore.entries" :key="entry.id" class="record-card">
          <text class="record-title">{{ entry.exerciseName }}</text>
          <text v-if="familyStore.nameOf(entry.memberId)" class="record-meta">
            成员：{{ familyStore.nameOf(entry.memberId) }}
          </text>
          <text class="record-meta">{{ workoutText(entry) }}</text>

          <view class="record-actions">
            <button class="btn btn-secondary" @tap="startEdit(entry)">编辑</button>
            <button class="btn btn-danger" @tap="remove(entry)">删除</button>
          </view>
        </view>
      </view>
      <view v-else class="empty">这一天还没有训练记录</view>
    </view>
  </view>
</template>
