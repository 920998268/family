<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAppStore } from '@/stores/app';
import { useDietStore } from '@/stores/diet';
import { useWorkoutStore } from '@/stores/workout';
import { useProfileStore } from '@/stores/profile';
import { formatDateKey } from '@/utils/date';
import { mealLabel, nutritionText, workoutText } from '@/utils/format';

const appStore = useAppStore();
const profileStore = useProfileStore();
const dietStore = useDietStore();
const workoutStore = useWorkoutStore();

const date = computed(() => appStore.currentDate);
const pageTitle = computed(() => formatDateKey(date.value));

onShow(() => {
  appStore.refreshToday();
  profileStore.load();
  dietStore.load(date.value);
  workoutStore.load(date.value);
});

function goDiet(): void {
  uni.navigateTo({ url: `/pages/diet/diet?date=${date.value}` });
}

function goWorkout(): void {
  uni.navigateTo({ url: `/pages/workout/workout?date=${date.value}` });
}

function goProfile(): void {
  uni.switchTab({ url: '/pages/profile/profile' });
}

function goBackup(): void {
  uni.navigateTo({ url: '/pages/backup/backup' });
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">今日记录</text>
      <text class="page-subtitle">{{ pageTitle }}</text>
    </view>

    <view v-if="!profileStore.hasProfile()" class="profile-banner">
      <text class="profile-banner-title">先完善健康档案</text>
      <text class="profile-banner-text">记录身高、体重和目标，方便后续查看变化。</text>
      <view class="profile-banner-actions">
        <button class="btn btn-primary" @tap="goProfile">填写健康档案</button>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">饮食记录</text>
        <button class="link-button" @tap="goDiet">记一笔</button>
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
      <view v-else class="empty">今天还没有饮食记录</view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">训练记录</text>
        <button class="link-button" @tap="goWorkout">记一笔</button>
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
      <view v-else class="empty">今天还没有训练记录</view>
    </view>

    <view class="quick-actions">
      <button class="btn btn-primary" @tap="goDiet">记录饮食</button>
      <button class="btn btn-secondary" @tap="goWorkout">记录训练</button>
    </view>

    <view class="section">
      <button class="btn btn-ghost btn-block" @tap="goBackup">数据备份</button>
    </view>
  </view>
</template>

