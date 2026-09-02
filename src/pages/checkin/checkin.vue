<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAppStore } from '@/stores/app';
import { useDietStore } from '@/stores/diet';
import { useWorkoutStore } from '@/stores/workout';
import { useStudyStore } from '@/stores/study';
import { formatDateKey } from '@/utils/date';

const appStore = useAppStore();
const dietStore = useDietStore();
const workoutStore = useWorkoutStore();
const studyStore = useStudyStore();

const today = computed(() => appStore.currentDate);
const dietCount = computed(() => dietStore.entries.length);
const workoutCount = computed(() => workoutStore.entries.length);
const studyDone = computed(() => studyStore.checkins.length);
const studyTotal = computed(() => studyStore.plans.length);
const totalDone = computed(() => dietCount.value + workoutCount.value + studyDone.value);

onShow(() => {
  appStore.refreshToday();
  dietStore.load(today.value);
  workoutStore.load(today.value);
  studyStore.loadPlans();
  studyStore.loadCheckins(today.value);
});

function goPage(url: string): void {
  uni.navigateTo({ url });
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">打卡中心</text>
      <text class="page-subtitle">{{ formatDateKey(today) }} · 今日已完成 {{ totalDone }} 项</text>
    </view>

    <view class="section">
      <view class="checkin-card" @tap="goPage('/pages/checkin/workout')">
        <view class="checkin-icon" style="background: #fee2e2">
          <text>🏃</text>
        </view>
        <view class="checkin-body">
          <text class="module-title">运动健身打卡</text>
          <text class="module-desc">记录训练动作、组数、次数与重量</text>
          <view class="progress-track checkin-progress">
            <view
              class="progress-fill"
              :style="{ width: `${Math.min(100, workoutCount > 0 ? 100 : 0)}%` }"
            />
          </view>
          <text class="module-desc">今日已记录 {{ workoutCount }} 条训练</text>
        </view>
        <text class="checkin-arrow">›</text>
      </view>

      <view class="checkin-card" @tap="goPage('/pages/checkin/diet')">
        <view class="checkin-icon" style="background: #dcfce7">
          <text>🥗</text>
        </view>
        <view class="checkin-body">
          <text class="module-title">饮食打卡</text>
          <text class="module-desc">按餐次记录食物、份量与营养</text>
          <view class="progress-track checkin-progress">
            <view
              class="progress-fill"
              :style="{ width: `${Math.min(100, dietCount > 0 ? 100 : 0)}%` }"
            />
          </view>
          <text class="module-desc">今日已记录 {{ dietCount }} 条饮食</text>
        </view>
        <text class="checkin-arrow">›</text>
      </view>

      <view class="checkin-card" @tap="goPage('/pages/checkin/study')">
        <view class="checkin-icon" style="background: #dbeafe">
          <text>📚</text>
        </view>
        <view class="checkin-body">
          <text class="module-title">学习计划打卡</text>
          <text class="module-desc">制定学习计划并按日打卡坚持</text>
          <view class="progress-track checkin-progress">
            <view
              class="progress-fill"
              :style="{ width: `${studyTotal ? Math.round((studyDone / studyTotal) * 100) : 0}%` }"
            />
          </view>
          <text class="module-desc">今日完成 {{ studyDone }}/{{ studyTotal }} 项计划</text>
        </view>
        <text class="checkin-arrow">›</text>
      </view>
    </view>

    <view class="section">
      <button class="btn btn-primary btn-block" @tap="goPage('/pages/checkin/diet')">
        记录一笔饮食
      </button>
      <view class="quick-actions">
        <button class="btn btn-secondary" @tap="goPage('/pages/checkin/workout')">记录运动</button>
        <button class="btn btn-secondary" @tap="goPage('/pages/checkin/study')">去学习打卡</button>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.checkin-card {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 20rpx;
  padding: 28rpx 24rpx;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 24rpx rgba(120, 80, 40, 0.06);
}

.checkin-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 96rpx;
  height: 96rpx;
  border-radius: 24rpx;
  font-size: 48rpx;
  flex-shrink: 0;
}

.checkin-body {
  flex: 1;
}

.checkin-progress {
  margin-top: 14rpx;
}

.checkin-arrow {
  color: #c9c2ba;
  font-size: 40rpx;
}
</style>
