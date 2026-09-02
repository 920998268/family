<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useTravelStore } from '@/stores/travel';
import { useFamilyStore } from '@/stores/family';
import type { TravelPlan, TravelStatus } from '@/types/models';
import { travelDateRange, travelStatusLabel } from '@/utils/format';
import { formatMoney } from '@/utils/format';
import { errorMessage } from '@/utils/error';

const travelStore = useTravelStore();
const familyStore = useFamilyStore();

const expandedId = ref<string | null>(null);

const activePlans = computed(() =>
  travelStore.plans.filter(
    (plan) => plan.status === 'planned' || plan.status === 'ongoing',
  ),
);
const historyPlans = computed(() =>
  travelStore.plans.filter(
    (plan) => plan.status === 'done' || plan.status === 'cancelled',
  ),
);

onShow(() => {
  travelStore.load();
  familyStore.load();
});

function goNew(): void {
  uni.navigateTo({ url: '/pages/plan/travel-form' });
}

function editPlan(plan: TravelPlan): void {
  uni.navigateTo({ url: `/pages/plan/travel-form?id=${plan.id}` });
}

function toggleExpand(plan: TravelPlan): void {
  expandedId.value = expandedId.value === plan.id ? null : plan.id;
}

function itemProgress(plan: TravelPlan): string {
  const total = plan.items.length;
  if (total === 0) {
    return '暂无行程明细';
  }
  const done = plan.items.filter((item) => item.done).length;
  return `${done}/${total} 项完成`;
}

function memberNames(plan: TravelPlan): string {
  const names = plan.members.map((id) => familyStore.nameOf(id)).filter(Boolean);
  return names.length ? names.join('、') : '全家';
}

function toggleItem(plan: TravelPlan, itemId: string): void {
  try {
    travelStore.toggleItem(plan.id, itemId);
  } catch (error) {
    uni.showToast({ title: errorMessage(error), icon: 'none' });
  }
}

function setStatus(plan: TravelPlan, status: TravelStatus): void {
  try {
    travelStore.setStatus(plan.id, status);
    uni.showToast({ title: '状态已更新', icon: 'success' });
  } catch (error) {
    uni.showToast({ title: errorMessage(error), icon: 'none' });
  }
}

function removePlan(plan: TravelPlan): void {
  uni.showModal({
    title: '删除出行计划',
    content: `确定删除「${plan.title}」吗？`,
    success: (result) => {
      if (!result.confirm) {
        return;
      }
      try {
        travelStore.remove(plan.id);
        uni.showToast({ title: '已删除', icon: 'success' });
      } catch (error) {
        uni.showToast({ title: errorMessage(error), icon: 'none' });
      }
    },
  });
}

function statusBadgeClass(status: TravelStatus): string {
  switch (status) {
    case 'ongoing':
      return 'badge-primary';
    case 'done':
      return 'badge-success';
    case 'cancelled':
      return 'badge-grey';
    default:
      return 'badge-warning';
  }
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">出行计划</text>
      <text class="page-subtitle">制定家庭出行安排，逐项执行并记录</text>
    </view>

    <view class="section">
      <button class="btn btn-primary btn-block" @tap="goNew">新建出行计划</button>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">进行中（{{ activePlans.length }}）</text>
      </view>
      <view v-if="activePlans.length" class="record-list">
        <view v-for="plan in activePlans" :key="plan.id" class="record-card travel-card">
          <view class="travel-head" @tap="toggleExpand(plan)">
            <view class="travel-info">
              <view class="travel-title-row">
                <text class="record-title">{{ plan.title }}</text>
                <text class="badge" :class="statusBadgeClass(plan.status)">{{ travelStatusLabel(plan) }}</text>
              </view>
              <text class="record-meta">{{ travelDateRange(plan) }} · {{ plan.destination || '目的地待定' }}</text>
              <text class="record-meta">成员：{{ memberNames(plan) }}</text>
              <text class="record-meta">预算：{{ formatMoney(plan.budget) }} · {{ itemProgress(plan) }}</text>
            </view>
            <text class="checkin-arrow">{{ expandedId === plan.id ? '⌃' : '⌄' }}</text>
          </view>

          <view v-if="expandedId === plan.id" class="travel-items">
            <view
              v-for="item in plan.items"
              :key="item.id"
              class="travel-item"
              :class="{ 'done-item': item.done }"
              @tap="toggleItem(plan, item.id)"
            >
              <view class="travel-item-check" :class="item.done ? 'travel-item-checked' : ''">
                <text>{{ item.done ? '✓' : '' }}</text>
              </view>
              <view class="travel-item-body">
                <text class="travel-item-activity">{{ item.activity }}</text>
                <text v-if="item.time" class="record-meta">时间：{{ item.time }}</text>
                <text v-if="item.note" class="record-meta">{{ item.note }}</text>
              </view>
            </view>
            <view v-if="plan.items.length === 0" class="empty-muted">还没有行程明细</view>

            <view class="record-actions">
              <button v-if="plan.status === 'planned'" class="btn btn-secondary" @tap="setStatus(plan, 'ongoing')">开始出行</button>
              <button v-if="plan.status !== 'done'" class="btn btn-primary" @tap="setStatus(plan, 'done')">完成计划</button>
              <button class="btn btn-ghost" @tap="editPlan(plan)">编辑</button>
              <button class="btn btn-danger" @tap="removePlan(plan)">删除</button>
            </view>
          </view>
        </view>
      </view>
      <view v-else class="empty">还没有进行中的出行计划</view>
    </view>

    <view v-if="historyPlans.length" class="section">
      <view class="section-header">
        <text class="section-title">历史计划（{{ historyPlans.length }}）</text>
      </view>
      <view class="record-list">
        <view v-for="plan in historyPlans" :key="plan.id" class="record-card travel-card" @tap="toggleExpand(plan)">
          <view class="travel-head">
            <view class="travel-info">
              <view class="travel-title-row">
                <text class="record-title">{{ plan.title }}</text>
                <text class="badge" :class="statusBadgeClass(plan.status)">{{ travelStatusLabel(plan) }}</text>
              </view>
              <text class="record-meta">{{ travelDateRange(plan) }} · {{ plan.destination || '目的地待定' }}</text>
            </view>
            <text class="checkin-arrow">›</text>
          </view>
          <view v-if="expandedId === plan.id" class="record-actions">
            <button class="btn btn-ghost" @tap="editPlan(plan)">编辑</button>
            <button class="btn btn-danger" @tap="removePlan(plan)">删除</button>
          </view>
        </view>
      </view>
    </view>

    <view class="fab-wrap">
      <view class="fab" @tap="goNew">
        <text>＋</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.travel-head {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.travel-info {
  flex: 1;
}

.travel-title-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.travel-title-row .record-title {
  flex: 1;
}

.checkin-arrow {
  color: #c9c2ba;
  font-size: 40rpx;
}

.travel-items {
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid $uni-border-color;
}

.travel-item {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  padding: 12rpx 0;
}

.travel-item-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  border: 2rpx solid #d6cec4;
  border-radius: 50%;
  color: #ffffff;
  font-size: 26rpx;
  flex-shrink: 0;
  margin-top: 4rpx;
}

.travel-item-checked {
  border-color: $uni-color-success;
  background: $uni-color-success;
}

.travel-item-body {
  flex: 1;
}

.travel-item-activity {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
}
</style>
