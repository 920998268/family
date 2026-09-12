<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { WorkoutCategory, WorkoutEntry } from '@/types/models';
import { WORKOUT_CATEGORIES } from '@/types/models';
import type { WorkoutDraft, WorkoutSetDraft } from '@/services/WorkoutService';
import { normalizeWorkoutCategory } from '@/utils/workout';
import { buildWorkoutDraft } from '@/utils/workoutForm';
import { WORKOUT_LIMITS } from '@/utils/limits';

const props = defineProps<{
  entry?: WorkoutEntry | null;
}>();

const emit = defineEmits<{
  save: [draft: WorkoutDraft];
  cancel: [];
}>();

const categoryNames = WORKOUT_CATEGORIES.map((item) => item.label);

const category = ref<WorkoutCategory>('strength');
const exerciseName = ref('');
const sets = ref<WorkoutSetDraft[]>([{ reps: 0, weightKg: 0 }]);
const durationMin = ref<number | undefined>(undefined);
const distanceKm = ref<number | undefined>(undefined);
const calories = ref<number | undefined>(undefined);

const isCardio = computed(() => category.value === 'cardio');

const categoryIndex = computed(() =>
  Math.max(
    WORKOUT_CATEGORIES.findIndex((item) => item.value === category.value),
    0,
  ),
);

function resetForm(): void {
  const entry = props.entry;
  // 新建默认「力量」；编辑时按老记录推断（没有 category 的老记录靠组明细推断）
  category.value = entry
    ? normalizeWorkoutCategory({ category: entry.category, sets: entry.sets })
    : 'strength';
  exerciseName.value = entry?.exerciseName ?? '';
  // 有氧记录没有组明细，但表单始终保留一组，方便用户切回力量时接着填
  sets.value =
    entry && entry.sets.length > 0
      ? entry.sets.map((set) => ({ reps: set.reps, weightKg: set.weightKg }))
      : [{ reps: 0, weightKg: 0 }];
  durationMin.value = entry?.durationMin;
  distanceKm.value = entry?.distanceKm;
  calories.value = entry?.calories;
}

watch(
  () => props.entry,
  () => resetForm(),
  { immediate: true },
);

function onCategoryChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  category.value = WORKOUT_CATEGORIES[index]?.value ?? 'strength';
}

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
  const result = buildWorkoutDraft({
    category: category.value,
    exerciseName: exerciseName.value,
    sets: sets.value,
    durationMin: durationMin.value,
    distanceKm: distanceKm.value,
    calories: calories.value,
  });

  if (!result.ok) {
    uni.showToast({ title: result.msg, icon: 'none' });
    return;
  }

  emit('save', result.draft);
}
</script>

<template>
  <view class="form-card">
    <view class="section-title">
      {{ entry ? '编辑训练记录' : '新增训练记录' }}
    </view>

    <view class="field field-first">
      <text class="field-label">类型</text>
      <picker
        :range="categoryNames"
        :value="categoryIndex"
        @change="onCategoryChange"
      >
        <view class="picker-value">
          <text>{{ categoryNames[categoryIndex] }}</text>
          <text class="picker-arrow">›</text>
        </view>
      </picker>
    </view>

    <view class="field">
      <text class="field-label">{{ isCardio ? '运动项目' : '训练动作' }}</text>
      <input
        v-model="exerciseName"
        class="field-control"
        :maxlength="WORKOUT_LIMITS.exerciseName"
        :placeholder="isCardio ? '例如：跑步' : '例如：杠铃卧推'"
      />
    </view>

    <view v-if="!isCardio" class="field">
      <view class="section-header">
        <text class="field-label field-label-inline">组明细</text>
        <button class="link-button" @tap="addSet">添加一组</button>
      </view>

      <view
        v-for="(set, index) in sets"
        :key="index"
        class="record-card set-card"
      >
        <view class="section-header">
          <text class="section-title">第 {{ index + 1 }} 组</text>
          <button class="btn btn-danger btn-sm" @tap="removeSet(index)">
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

    <view v-else>
      <view class="field">
        <text class="field-label">运动时长（分钟）</text>
        <input
          v-model.number="durationMin"
          class="field-control"
          type="number"
          placeholder="例如：30"
        />
      </view>

      <view class="field">
        <text class="field-label">距离（公里，可选）</text>
        <input
          v-model.number="distanceKm"
          class="field-control"
          type="number"
          placeholder="例如：5.2"
        />
      </view>
    </view>

    <view class="field">
      <text class="field-label">消耗热量（千卡，可选）</text>
      <input
        v-model.number="calories"
        class="field-control"
        type="number"
        placeholder="可不填"
      />
    </view>

    <view class="form-actions">
      <button class="btn btn-ghost" @tap="emit('cancel')">取消</button>
      <button class="btn btn-primary" @tap="submit">保存</button>
    </view>
  </view>
</template>
