<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAppStore } from '@/stores/app';
import { useProfileStore } from '@/stores/profile';
import { useFamilyStore } from '@/stores/family';
import { useDietStore } from '@/stores/diet';
import { useWorkoutStore } from '@/stores/workout';
import { useStudyStore } from '@/stores/study';
import { useMealStore } from '@/stores/meal';
import { useTravelStore } from '@/stores/travel';
import { createLedgerService } from '@/services';
import { formatDateKey } from '@/utils/date';
import { formatMoney } from '@/utils/format';
import MemberAvatar from '@/components/MemberAvatar.vue';

const appStore = useAppStore();
const profileStore = useProfileStore();
const familyStore = useFamilyStore();
const dietStore = useDietStore();
const workoutStore = useWorkoutStore();
const studyStore = useStudyStore();
const mealStore = useMealStore();
const travelStore = useTravelStore();

const today = computed(() => appStore.currentDate);

const dietCount = computed(() => dietStore.entries.length);
const workoutCount = computed(() => workoutStore.entries.length);
const studyDone = computed(() => studyStore.checkins.length);
const mealTotal = computed(() => mealStore.plans.length);
const mealDone = computed(() => mealStore.plans.filter((plan) => plan.done).length);
const travelOngoing = computed(() =>
  travelStore.plans.filter((plan) => plan.status === 'planned' || plan.status === 'ongoing').length,
);

const month = computed(() => today.value.slice(0, 7));
const monthSummary = computed(() => {
  const entries = createLedgerService().listByMonth(month.value);
  return createLedgerService().summary(entries);
});

const hasProfile = computed(() => profileStore.hasProfile());

onShow(() => {
  appStore.refreshToday();
  profileStore.load();
  familyStore.load();
  dietStore.load(today.value);
  workoutStore.load(today.value);
  studyStore.loadPlans();
  studyStore.loadCheckins(today.value);
  mealStore.load(today.value);
  travelStore.load();
});

function goTab(url: string): void {
  uni.switchTab({ url });
}

function goPage(url: string): void {
  uni.navigateTo({ url });
}

function goProfile(): void {
  goPage('/pages/me/profile');
}
</script>

<template>
  <view class="page-shell">
    <view class="hero-card">
      <text class="hero-title">家庭打卡</text>
      <text class="hero-subtitle">{{ formatDateKey(today) }}</text>

      <view class="hero-stats">
        <view class="hero-stat">
          <text class="hero-stat-value">{{ dietCount + workoutCount + studyDone }}</text>
          <text class="hero-stat-label">今日已打卡</text>
        </view>
        <view class="hero-stat">
          <text class="hero-stat-value">{{ mealDone }}/{{ mealTotal }}</text>
          <text class="hero-stat-label">食谱执行</text>
        </view>
        <view class="hero-stat">
          <text class="hero-stat-value">{{ travelOngoing }}</text>
          <text class="hero-stat-label">进行中计划</text>
        </view>
      </view>

      <view v-if="familyStore.members.length" class="hero-members">
        <view
          v-for="member in familyStore.members"
          :key="member.id"
          class="hero-member"
          @tap="goPage('/pages/me/family')"
        >
          <MemberAvatar :name="member.name" :color="member.avatarColor" size="sm" />
          <text class="hero-member-name">{{ member.name }}</text>
        </view>
      </view>
    </view>

    <view v-if="!hasProfile" class="profile-banner">
      <text class="profile-banner-title">先完善个人信息档案</text>
      <text class="profile-banner-text">填写姓名、出生年月、身高体重与目标体重，便于全家记录健康变化。</text>
      <view class="profile-banner-actions">
        <button class="btn btn-primary" @tap="goProfile">去完善</button>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">六大模块</text>
      </view>
      <view class="module-grid">
        <view class="module-card" @tap="goPage('/pages/checkin/workout')">
          <view class="module-icon" style="background: #fee2e2">
            <text>🏃</text>
          </view>
          <text class="module-title">运动打卡</text>
          <text class="module-desc">今日 {{ workoutCount }} 条训练</text>
        </view>
        <view class="module-card" @tap="goPage('/pages/checkin/diet')">
          <view class="module-icon" style="background: #dcfce7">
            <text>🥗</text>
          </view>
          <text class="module-title">饮食打卡</text>
          <text class="module-desc">今日 {{ dietCount }} 条饮食</text>
        </view>
        <view class="module-card" @tap="goPage('/pages/checkin/study')">
          <view class="module-icon" style="background: #dbeafe">
            <text>📚</text>
          </view>
          <text class="module-title">学习打卡</text>
          <text class="module-desc">今日完成 {{ studyDone }} 项</text>
        </view>
        <view class="module-card" @tap="goPage('/pages/plan/meal')">
          <view class="module-icon" style="background: #fff7ed">
            <text>🍳</text>
          </view>
          <text class="module-title">家庭食谱</text>
          <text class="module-desc">今日执行 {{ mealDone }}/{{ mealTotal }}</text>
        </view>
        <view class="module-card" @tap="goPage('/pages/plan/travel')">
          <view class="module-icon" style="background: #f3e8ff">
            <text>✈️</text>
          </view>
          <text class="module-title">出行计划</text>
          <text class="module-desc">{{ travelOngoing }} 个进行中</text>
        </view>
        <view class="module-card" @tap="goTab('/pages/ledger/ledger')">
          <view class="module-icon" style="background: #fef3c7">
            <text>💰</text>
          </view>
          <text class="module-title">家庭收支</text>
          <text class="module-desc">本月结余 {{ formatMoney(monthSummary.balance) }}</text>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">今日打卡</text>
        <text class="page-subtitle page-subtitle-tight">{{ dietCount + workoutCount + studyDone }} 项完成</text>
      </view>
      <view class="summary-grid">
        <view class="summary-item" @tap="goPage('/pages/checkin/diet')">
          <text class="summary-label">🥗 饮食</text>
          <text class="summary-value">{{ dietCount }} 条</text>
        </view>
        <view class="summary-item" @tap="goPage('/pages/checkin/workout')">
          <text class="summary-label">🏃 运动</text>
          <text class="summary-value">{{ workoutCount }} 条</text>
        </view>
        <view class="summary-item" @tap="goPage('/pages/checkin/study')">
          <text class="summary-label">📚 学习</text>
          <text class="summary-value">{{ studyDone }} 项</text>
        </view>
        <view class="summary-item" @tap="goPage('/pages/plan/meal')">
          <text class="summary-label">🍳 食谱</text>
          <text class="summary-value">{{ mealDone }}/{{ mealTotal }}</text>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">本月收支</text>
        <text class="page-subtitle page-subtitle-tight">{{ month }}</text>
      </view>
      <view class="summary-grid">
        <view class="summary-item">
          <text class="summary-label">收入</text>
          <text class="summary-value txn-income">{{ formatMoney(monthSummary.income) }}</text>
        </view>
        <view class="summary-item">
          <text class="summary-label">支出</text>
          <text class="summary-value txn-expense">{{ formatMoney(monthSummary.expense) }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.hero-members {
  display: flex;
  gap: 24rpx;
  margin-top: 28rpx;
}

.hero-member {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.hero-member-name {
  font-size: 24rpx;
  font-weight: 600;
  color: #ffffff;
}
</style>
