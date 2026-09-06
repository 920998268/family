<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useProfileStore } from '@/stores/profile';
import { useAuthStore } from '@/stores/auth';

const profileStore = useProfileStore();
const authStore = useAuthStore();

const profile = computed(() => profileStore.profile);

// 手机号：优先从登录账号获取，其次从个人信息档案获取
const displayMobile = computed(() => {
  const m = authStore.mobile || profile.value?.mobile || '';
  if (!m) return '-';
  if (m.length === 11) {
    return m.slice(0, 3) + '****' + m.slice(7);
  }
  return m;
});

const displayName = computed(() => profile.value?.name || authStore.nickname || '未填写姓名');

const genderText = computed(() => {
  const g = profile.value?.gender;
  if (g === 'male') return '男';
  if (g === 'female') return '女';
  return '未设置';
});

const roleLabel = computed(() => (authStore.isOwner ? '家庭管理员' : '家庭成员'));
const roleClass = computed(() => (authStore.isOwner ? 'role-owner' : 'role-member'));

onShow(() => {
  profileStore.load();
});

function goPage(url: string): void {
  uni.navigateTo({ url });
}

async function handleLogout(): Promise<void> {
  uni.showModal({
    title: '退出登录',
    content: '确定要退出当前账号吗？',
    success: async (result) => {
      if (result.confirm) {
        await authStore.logout();
        uni.reLaunch({ url: '/pages/login/login' });
      }
    },
  });
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">我的</text>
      <text class="page-subtitle">个人信息与家庭管理</text>
    </view>

    <!-- 顶部个人信息卡片 -->
    <view class="profile-card" @tap="goPage('/pages/me/profile')">
      <view class="profile-top">
        <view class="profile-avatar">
          <text>{{ displayName.slice(0, 1) }}</text>
        </view>
        <view class="profile-info">
          <view class="name-row">
            <text class="profile-name">{{ displayName }}</text>
            <text class="role-tag" :class="roleClass">{{ roleLabel }}</text>
          </view>
          <view class="meta-row">
            <text class="meta-item">{{ genderText }}</text>
            <text class="meta-divider">·</text>
            <text class="meta-item">{{ displayMobile }}</text>
          </view>
        </view>
        <text class="card-arrow">›</text>
      </view>
      <view class="profile-stats">
        <view class="stat-item">
          <text class="stat-value">{{ profile?.heightCm ?? '--' }}</text>
          <text class="stat-label">身高(cm)</text>
        </view>
        <view class="stat-item">
          <text class="stat-value">{{ profile?.currentWeightKg ?? '--' }}</text>
          <text class="stat-label">体重(kg)</text>
        </view>
        <view class="stat-item">
          <text class="stat-value">{{ profile?.targetWeightKg ?? '--' }}</text>
          <text class="stat-label">目标(kg)</text>
        </view>
        <view class="stat-item">
          <text class="stat-value">{{ profile?.birthDate?.slice(0, 7) ?? '--' }}</text>
          <text class="stat-label">出生年月</text>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="record-card me-card" @tap="goPage('/pages/family-setup/family-setup')">
        <view class="me-head">
          <view class="avatar-dot" style="background: #f97316">
            <text>家</text>
          </view>
          <view class="me-head-info">
            <text class="record-title">我的家庭</text>
            <text class="record-meta">家庭空间、邀请码与成员管理</text>
          </view>
          <text class="checkin-arrow">›</text>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="record-card me-card" @tap="goPage('/pages/backup/backup')">
        <view class="me-head">
          <view>
            <text class="record-title">数据备份</text>
            <text class="record-meta">导出与导入本地 JSON 备份</text>
          </view>
          <text class="checkin-arrow">›</text>
        </view>
      </view>
    </view>

    <view class="section">
      <button class="logout-btn" @tap="handleLogout">退出登录</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.profile-card {
  background: linear-gradient(135deg, #fff7ed 0%, #fff 100%);
  border-radius: 24rpx;
  padding: 32rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 4rpx 16rpx rgba(249, 115, 22, 0.08);
}

.profile-top {
  display: flex;
  align-items: center;
  gap: 24rpx;
  margin-bottom: 28rpx;
}

.profile-avatar {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #f97316, #fb923c);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  text {
    font-size: 44rpx;
    color: #fff;
    font-weight: 700;
  }
}

.profile-info {
  flex: 1;
  min-width: 0;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 8rpx;
}

.profile-name {
  font-size: 34rpx;
  font-weight: 700;
  color: #2d2a26;
}

.role-tag {
  font-size: 20rpx;
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
  font-weight: 600;

  &.role-owner {
    color: #f97316;
    background: #fff7ed;
  }

  &.role-member {
    color: #0ea5e9;
    background: #f0f9ff;
  }
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.meta-item {
  font-size: 24rpx;
  color: #78716c;
}

.meta-divider {
  font-size: 24rpx;
  color: #d6d3d1;
}

.card-arrow {
  color: #c9c2ba;
  font-size: 40rpx;
  flex-shrink: 0;
}

.profile-stats {
  display: flex;
  justify-content: space-between;
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx 16rpx;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}

.stat-value {
  font-size: 30rpx;
  font-weight: 700;
  color: #2d2a26;
}

.stat-label {
  font-size: 20rpx;
  color: #a8a29e;
}

.me-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.me-head-info {
  flex: 1;
}

.me-card {
  margin-top: 20rpx;
}

.checkin-arrow {
  color: #c9c2ba;
  font-size: 40rpx;
}

.logout-btn {
  width: 100%;
  height: 88rpx;
  padding: 0 !important;
  margin: 0;
  border: none;
  border-radius: 44rpx;
  background: #fff;
  color: #ef4444;
  font-size: 30rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.04);

  &::after {
    border: none;
  }
}
</style>
