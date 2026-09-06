<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useProfileStore } from '@/stores/profile';
import { useAuthStore } from '@/stores/auth';

const profileStore = useProfileStore();
const authStore = useAuthStore();

const profile = computed(() => profileStore.profile);
const avatarUrl = ref('');

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

// 家庭关系文本
const familyRoleText = computed(() => {
  const r = profile.value?.role;
  if (!r) return '';
  const roleMap: Record<string, string> = {
    father: '爸爸', mother: '妈妈', grandfather: '爷爷', grandmother: '奶奶',
    maternalGrandfather: '外公', maternalGrandmother: '外婆',
    son: '儿子', daughter: '女儿', other: '其他',
  };
  return roleMap[r] || '';
});

onShow(() => {
  profileStore.load();
});

// 微信头像选择回调
function onChooseAvatar(event: any): void {
  const url = event?.detail?.avatarUrl;
  if (url) {
    avatarUrl.value = url;
    saveAvatar(url);
  }
}

// 从相册选择头像
function onAlbumTap(): void {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album'],
    success: (imgRes) => {
      if (imgRes.tempFilePaths && imgRes.tempFilePaths[0]) {
        avatarUrl.value = imgRes.tempFilePaths[0];
        saveAvatar(imgRes.tempFilePaths[0]);
      }
    },
  });
}

// 保存头像到 profile
function saveAvatar(url: string): void {
  const current = profileStore.profile;
  if (current) {
    profileStore.save({ ...current, avatarUrl: url } as any);
  } else {
    profileStore.save({
      name: displayName.value,
      gender: 'other',
      birthDate: '',
      heightCm: 0,
      currentWeightKg: 0,
      targetWeightKg: 0,
      avatarUrl: url,
    } as any);
  }
  uni.showToast({ title: '头像已更新', icon: 'success' });
}

function goProfile(): void {
  uni.navigateTo({ url: '/pages/me/profile' });
}

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
    <!-- 顶部个人信息卡片 -->
    <view class="profile-card">
      <view class="profile-top">
        <!-- 头像：button 获取微信头像 -->
        <button class="avatar-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
          <image v-if="avatarUrl || profile?.avatarUrl" :src="avatarUrl || profile?.avatarUrl" class="profile-avatar-img" mode="aspectFill" />
          <view v-else class="profile-avatar">
            <text>{{ displayName.slice(0, 1) }}</text>
          </view>
        </button>
        <!-- 相册选择小图标 -->
        <view class="avatar-camera-icon" @tap.stop="onAlbumTap">
          <text>📷</text>
        </view>
        <!-- 右侧信息：点击进入编辑 -->
        <view class="profile-info" @tap="goProfile">
          <view class="name-row">
            <text class="profile-name">{{ displayName }}</text>
            <text class="role-tag" :class="roleClass">{{ roleLabel }}</text>
          </view>
          <view class="meta-row">
            <text class="meta-item">{{ genderText }}</text>
            <text v-if="familyRoleText" class="meta-divider">·</text>
            <text v-if="familyRoleText" class="meta-item">{{ familyRoleText }}</text>
            <text class="meta-divider">·</text>
            <text class="meta-item">{{ displayMobile }}</text>
          </view>
        </view>
        <text class="card-arrow" @tap="goProfile">›</text>
      </view>
      <view class="profile-stats" @tap="goProfile">
        <view class="stat-item">
          <text class="stat-value">{{ profile?.heightCm ?? '--' }}</text>
          <text class="stat-label">身高(cm)</text>
        </view>
        <view class="stat-divider" />
        <view class="stat-item">
          <text class="stat-value">{{ profile?.currentWeightKg ?? '--' }}</text>
          <text class="stat-label">体重(kg)</text>
        </view>
        <view class="stat-divider" />
        <view class="stat-item">
          <text class="stat-value">{{ profile?.targetWeightKg ?? '--' }}</text>
          <text class="stat-label">目标(kg)</text>
        </view>
        <view class="stat-divider" />
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

.avatar-btn {
  position: relative;
  width: 112rpx;
  height: 112rpx;
  padding: 0 !important;
  margin: 0;
  border: none;
  background: transparent;
  flex-shrink: 0;
  line-height: 1;

  &::after {
    border: none;
  }
}

.profile-avatar {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #f97316, #fb923c);
  display: flex;
  align-items: center;
  justify-content: center;

  text {
    font-size: 44rpx;
    color: #fff;
    font-weight: 700;
  }
}

.profile-avatar-img {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
}

.avatar-camera-icon {
  position: absolute;
  left: 88rpx;
  top: 88rpx;
  z-index: 10;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: #fff;
  border: 2rpx solid #f97316;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.1);

  text {
    font-size: 20rpx;
    line-height: 1;
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
  align-items: center;
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

.stat-divider {
  width: 2rpx;
  height: 48rpx;
  background: #f0ebe3;
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
