<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAppStore } from '@/stores/app';
import { useDietStore } from '@/stores/diet';
import { useWorkoutStore } from '@/stores/workout';
import { MEAL_LABELS, type DietEntry, type WorkoutEntry } from '@/types/models';
import { formatDateKey, parseDateKey, toDateKey } from '@/utils/date';

const appStore = useAppStore();
const dietStore = useDietStore();
const workoutStore = useWorkoutStore();

const date = ref(appStore.selectedDate);
const dateLabel = computed(() => formatDateKey(date.value));

onShow(() => {
  date.value = appStore.selectedDate;
  loadDate();
});

function loadDate(): void {
  appStore.selectDate(date.value);
  dietStore.load(date.value);
  workoutStore.load(date.value);
}

function onDateChange(event: { detail: { value: string } }): void {
  date.value = event.detail.value;
  loadDate();
}

function shiftDate(days: number): void {
  const current = parseDateKey(date.value);
  if (!current) {
    return;
  }
  current.setDate(current.getDate() + days);
  date.value = toDateKey(current);
  loadDate();
}

function mealLabel(entry: DietEntry): string {
  return MEAL_LABELS[entry.mealType];
}

function nutritionText(entry: DietEntry): string {
  const parts: string[] = [];
  if (entry.calories !== undefined) parts.push(`热量 ${entry.calories} 千卡`);
  if (entry.protein !== undefined) parts.push(`蛋白质 ${entry.protein}g`);
  if (entry.carbs !== undefined) parts.push(`碳水 ${entry.carbs}g`);
  if (entry.fat !== undefined) parts.push(`脂肪 ${entry.fat}g`);
  return parts.join(' · ');
}

function workoutText(entry: WorkoutEntry): string {
  return entry.sets
    .map((set) => `${set.weightKg}kg × ${set.reps}`)
    .join(' / ');
}

function goDiet(): void {
  uni.navigateTo({ url: `/pages/diet/diet?date=${date.value}` });
}

function goWorkout(): void {
  uni.navigateTo({ url: `/pages/workout/workout?date=${date.value}` });
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">历史记录</text>
      <text class="page-subtitle">按日期查看过去的饮食和训练。</text>
    </view>

    <view class="section form-card">
      <view class="section-header">
        <button class="link-button" @tap="shiftDate(-1)">‹ 前一天</button>
        <picker mode="date" :value="date" @change="onDateChange">
          <view class="picker-value" style="border: 0; padding: 0">
            <text>{{ dateLabel }}</text>
            <text class="picker-arrow">›</text>
          </view>
        </picker>
        <button class="link-button" @tap="shiftDate(1)">后一天 ›</button>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">饮食记录</text>
        <button class="link-button" @tap="goDiet">编辑</button>
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
        </view>
      </view>
      <view v-else class="empty">这一天没有饮食记录</view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">训练记录</text>
        <button class="link-button" @tap="goWorkout">编辑</button>
      </view>

      <view v-if="workoutStore.entries.length" class="record-list">
        <view
          v-for="entry in workoutStore.entries"
          :key="entry.id"
          class="record-card"
        >
          <text class="record-title">{{ entry.exerciseName }}</text>
          <text class="record-meta">{{ workoutText(entry) }}</text>
        </view>
      </view>
      <view v-else class="empty">这一天没有训练记录</view>
    </view>
  </view>
</template>

