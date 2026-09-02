<script setup lang="ts">
import { ref, watch } from 'vue';
import type { WorkoutEntry } from '@/types/models';
import type { WorkoutDraft, WorkoutSetDraft } from '@/services/WorkoutService';

const props = defineProps<{
  entry?: WorkoutEntry | null;
}>();

const emit = defineEmits<{
  save: [draft: WorkoutDraft];
  cancel: [];
}>();

const exerciseName = ref('');
const sets = ref<WorkoutSetDraft[]>([{ reps: 0, weightKg: 0 }]);

function resetForm(): void {
  const entry = props.entry;
  exerciseName.value = entry?.exerciseName ?? '';
  sets.value = entry
    ? entry.sets.map((set) => ({ reps: set.reps, weightKg: set.weightKg }))
    : [{ reps: 0, weightKg: 0 }];
}

watch(
  () => props.entry,
  () => resetForm(),
  { immediate: true },
);

function addSet(): void {
  sets.value.push({ reps: 0, weightKg: 0 });
}

function removeSet(index: number): void {
  if (sets.value.length === 1) {
    uni.showToast({ title: '至少保留一组', icon: 'none' });
    return;
  }
  sets.value.splice(index, 1);
}

function submit(): void {
  if (!exerciseName.value.trim()) {
    uni.showToast({ title: '请填写动作名称', icon: 'none' });
    return;
  }

  const normalized = sets.value.map((set) => ({
    reps: Number(set.reps),
    weightKg: Number(set.weightKg),
  }));

  if (normalized.some((set) => set.reps <= 0 || set.weightKg < 0)) {
    uni.showToast({ title: '请填写有效的组数和重量', icon: 'none' });
    return;
  }

  emit('save', {
    exerciseName: exerciseName.value.trim(),
    sets: normalized,
  });
}
</script>

<template>
  <view class="form-card">
    <view class="section-title">
      {{ entry ? '编辑训练记录' : '新增训练记录' }}
    </view>

    <view class="field" style="margin-top: 24rpx">
      <text class="field-label">训练动作</text>
      <input
        v-model="exerciseName"
        class="field-control"
        placeholder="例如：杠铃卧推"
      />
    </view>

    <view class="field">
      <view class="section-header">
        <text class="field-label" style="margin-bottom: 0">组明细</text>
        <button class="link-button" @tap="addSet">添加一组</button>
      </view>

      <view
        v-for="(set, index) in sets"
        :key="index"
        class="record-card"
        style="margin-bottom: 16rpx; box-shadow: none"
      >
        <view class="section-header">
          <text class="section-title">第 {{ index + 1 }} 组</text>
          <button class="btn btn-danger" style="min-height: 56rpx; padding: 0 18rpx" @tap="removeSet(index)">
            删除
          </button>
        </view>

        <view class="field">
          <text class="field-label">次数</text>
          <input
            v-model.number="set.reps"
            class="field-control"
            type="number"
            placeholder="例如：8"
          />
        </view>

        <view class="field">
          <text class="field-label">重量（kg）</text>
          <input
            v-model.number="set.weightKg"
            class="field-control"
            type="number"
            placeholder="例如：60"
          />
        </view>
      </view>
    </view>

    <view class="form-actions">
      <button class="btn btn-ghost" @tap="emit('cancel')">取消</button>
      <button class="btn btn-primary" @tap="submit">保存</button>
    </view>
  </view>
</template>
