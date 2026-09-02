<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAppStore } from '@/stores/app';
import { useMealStore } from '@/stores/meal';
import { useTravelStore } from '@/stores/travel';

const appStore = useAppStore();
const mealStore = useMealStore();
const travelStore = useTravelStore();

const today = computed(() => appStore.currentDate);
const mealTotal = computed(() => mealStore.plans.length);
const mealDone = computed(() => mealStore.plans.filter((plan) => plan.done).length);
const mealPercent = computed(() =>
  mealTotal.value ? Math.round((mealDone.value / mealTotal.value) * 100) : 0,
);
const travelPlanned = computed(() =>
  travelStore.plans.filter(
    (plan) => plan.status === 'planned' || plan.status === 'ongoing',
  ),
);
const travelDoneCount = computed(() =>
  travelStore.plans.filter((plan) => plan.status === 'done').length,
);

onShow(() => {
  appStore.refreshToday();
  mealStore.load(today.value);
  travelStore.load();
});

function goPage(url: string): void {
  uni.navigateTo({ url });
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">计划中心</text>
      <text class="page-subtitle">制定家庭的每日食谱与出行安排，并跟踪执行</text>
    </view>

    <view class="section">
      <view class="plan-card plan-card-meal" @tap="goPage('/pages/plan/meal')">
        <view class="plan-head">
          <view class="plan-title-wrap">
            <text class="plan-title">家庭每日食谱</text>
            <text class="plan-desc">今日执行 {{ mealDone }}/{{ mealTotal }}</text>
          </view>
          <view class="plan-emoji">🍳</view>
        </view>
        <view class="progress-track plan-progress">
          <view class="progress-fill" :style="{ width: `${mealPercent}%` }" />
        </view>
        <view class="plan-foot">
          <text>完成率 {{ mealPercent }}%</text>
          <text class="plan-link">制定今日食谱 ›</text>
        </view>
      </view>

      <view class="plan-card plan-card-travel" @tap="goPage('/pages/plan/travel')">
        <view class="plan-head">
          <view class="plan-title-wrap">
            <text class="plan-title">家庭出行计划</text>
            <text class="plan-desc">{{ travelPlanned.length }} 个进行中 · {{ travelDoneCount }} 个已完成</text>
          </view>
          <view class="plan-emoji">✈️</view>
        </view>
        <view v-if="travelPlanned.length" class="plan-list">
          <view v-for="plan in travelPlanned.slice(0, 3)" :key="plan.id" class="plan-item">
            <text class="plan-item-title">{{ plan.title }}</text>
            <text class="plan-item-meta">{{ plan.destination || '未填写目的地' }}</text>
          </view>
        </view>
        <view v-else class="plan-empty">暂无出行计划</view>
        <view class="plan-foot">
          <text>共 {{ travelStore.plans.length }} 个计划</text>
          <text class="plan-link">管理出行计划 ›</text>
        </view>
      </view>
    </view>

    <view class="section">
      <button class="btn btn-primary btn-block" @tap="goPage('/pages/plan/meal')">
        制定今日食谱
      </button>
      <view class="quick-actions">
        <button class="btn btn-secondary" @tap="goPage('/pages/plan/travel')">查看出行计划</button>
        <button class="btn btn-secondary" @tap="goPage('/pages/plan/travel-form')">新建出行计划</button>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.plan-card {
  margin-bottom: 24rpx;
  padding: 30rpx 28rpx;
  border-radius: 28rpx;
  color: #ffffff;
}

.plan-card-meal {
  background: linear-gradient(135deg, #fb923c 0%, #f97316 70%);
  box-shadow: 0 16rpx 32rpx rgba(249, 115, 22, 0.28);
}

.plan-card-travel {
  background: linear-gradient(135deg, #38bdf8 0%, #0ea5e9 70%);
  box-shadow: 0 16rpx 32rpx rgba(14, 165, 233, 0.24);
}

.plan-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.plan-title-wrap {
  flex: 1;
}

.plan-title {
  display: block;
  font-size: 34rpx;
  font-weight: 800;
}

.plan-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  opacity: 0.92;
}

.plan-emoji {
  font-size: 56rpx;
}

.plan-progress {
  margin-top: 24rpx;
  background: rgba(255, 255, 255, 0.3);
}

.plan-progress .progress-fill {
  background: #ffffff;
}

.plan-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20rpx;
  font-size: 24rpx;
  opacity: 0.95;
}

.plan-link {
  font-weight: 700;
}

.plan-list {
  margin-top: 20rpx;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.16);
}

.plan-item {
  display: flex;
  justify-content: space-between;
  padding: 10rpx 0;
}

.plan-item-title {
  font-size: 26rpx;
  font-weight: 600;
}

.plan-item-meta {
  font-size: 24rpx;
  opacity: 0.9;
}

.plan-empty {
  margin-top: 20rpx;
  font-size: 24rpx;
  opacity: 0.9;
}
</style>
