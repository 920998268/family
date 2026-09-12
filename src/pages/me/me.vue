<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useProfileStore } from '@/stores/profile';
import { useAuthStore } from '@/stores/auth';
import { useFamilyStore } from '@/stores/family';
import { restoreFamilyDataFromCloud } from '@/services/CloudRestoreService';
import { ensureCloudAvatar } from '@/utils/upload';
import { errorMessage } from '@/utils/error';
import { openFamilySetup } from '@/utils/navigation';
import { createAvatarOnlyProfile } from '@/utils/profile';

const profileStore = useProfileStore();
const familyStore = useFamilyStore();
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
  try {
    profileStore.load();
  } catch (e) {
    console.error('[me] 加载个人信息失败:', e);
  }
  // 兜底：本地无档案但有家庭时，从云端恢复已保存数据（防抖，避免重复拉取）
  if (!profileStore.profile && authStore.isLoggedIn() && authStore.hasFamily) {
    restoreFamilyDataFromCloud(authStore.uid)
      .then((r) => {
        if (r.restoredProfile) profileStore.load();
        if (r.restoredMembers) familyStore.load();
      })
      .catch(() => {});
  }
});

// 微信头像选择回调
function onChooseAvatar(event: any): void {
  const url = event?.detail?.avatarUrl;
  if (url) {
    avatarUrl.value = url;
    void saveAvatar(url);
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
        void saveAvatar(imgRes.tempFilePaths[0]);
      }
    },
  });
}

// 保存头像到 profile（本地临时路径先上传云存储，确保跨设备可显示）
async function saveAvatar(url: string): Promise<void> {
  try {
    const cloudUrl = await ensureCloudAvatar(url);
    const current = profileStore.profile;
    if (current) {
      profileStore.save({ ...current, avatarUrl: cloudUrl } as any);
    } else {
      profileStore.save(createAvatarOnlyProfile(displayName.value, cloudUrl) as any);
    }
    avatarUrl.value = cloudUrl || url;
    uni.showToast({ title: '头像已更新', icon: 'success' });
  } catch (err) {
    console.error('[me] 头像保存失败:', err);
    // 保存失败时回退展示，避免留下无效的本地临时路径
    avatarUrl.value = profileStore.profile?.avatarUrl || '';
    uni.showModal({
      title: '头像保存失败',
      content: errorMessage(err, '请稍后重试'),
      showCancel: false,
    });
  }
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
          <avatar-image
            :src="avatarUrl || profile?.avatarUrl"
            :size="112"
            :bg="'#e7e5e4'"
            :name="displayName"
            placeholder="📷"
            :font-size="44"
          />
        </button>
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
          <text v-if="!avatarUrl && !profile?.avatarUrl" class="avatar-hint" @tap.stop="onAlbumTap">从相册选择</text>
        </view>
        <text class="card-arrow" @tap="goProfile">›</text>
      </view>
      <view class="profile-stats" @tap="goProfile">
        <view class="stat-item">
          <text class="stat-value">{{ profile?.heightCm || '--' }}</text>
          <text class="stat-label">身高(cm)</text>
        </view>
        <view class="stat-divider" />
        <view class="stat-item">
          <text class="stat-value">{{ profile?.currentWeightKg || '--' }}</text>
          <text class="stat-label">体重(kg)</text>
        </view>
        <view class="stat-divider" />
        <view class="stat-item">
          <text class="stat-value">{{ profile?.targetWeightKg || '--' }}</text>
          <text class="stat-label">目标(kg)</text>
        </view>
        <view class="stat-divider" />
        <view class="stat-item">
          <text class="stat-value">{{ profile?.birthDate ? profile.birthDate.slice(0, 7) : '--' }}</text>
          <text class="stat-label">出生年月</text>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="record-card me-card" @tap="openFamilySetup">
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

.profile-avatar-empty {
  background: #e7e5e4;

  .camera-icon {
    font-size: 44rpx;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.avatar-hint {
  font-size: 22rpx;
  color: #f97316;
  margin-top: 6rpx;
}

.profile-avatar-img {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
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
