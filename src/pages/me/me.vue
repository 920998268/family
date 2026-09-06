<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useProfileStore } from '@/stores/profile';
import { useAuthStore } from '@/stores/auth';

const profileStore = useProfileStore();
const authStore = useAuthStore();

const profile = computed(() => profileStore.profile);

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

    <view class="section">
      <view class="record-card" @tap="goPage('/pages/me/profile')">
        <view class="me-head">
          <view class="avatar-dot" style="background: #f97316">
            <text>{{ (profile?.name || '我').slice(0, 1) }}</text>
          </view>
          <view class="me-head-info">
            <text class="record-title">{{ profile?.name || '未填写姓名' }}</text>
            <text class="record-meta">
              {{
                profile
                  ? `${profile.gender === 'male' ? '男' : profile.gender === 'female' ? '女' : '其他'} · ${profile.heightCm}cm · ${profile.currentWeightKg}kg`
                  : '点击完善个人信息档案'
              }}
            </text>
          </view>
          <text class="checkin-arrow">›</text>
        </view>
      </view>

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
      <view class="section-title">身体档案</view>
      <view class="summary-grid">
        <view class="summary-item">
          <text class="summary-label">身高</text>
          <text class="summary-value">{{ profile?.heightCm ?? '--' }} cm</text>
        </view>
        <view class="summary-item">
          <text class="summary-label">当前体重</text>
          <text class="summary-value">{{ profile?.currentWeightKg ?? '--' }} kg</text>
        </view>
        <view class="summary-item">
          <text class="summary-label">目标体重</text>
          <text class="summary-value">{{ profile?.targetWeightKg ?? '--' }} kg</text>
        </view>
        <view class="summary-item">
          <text class="summary-label">出生年月</text>
          <text class="summary-value">{{ profile?.birthDate?.slice(0, 7) ?? '--' }}</text>
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
