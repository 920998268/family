<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useFamilyStore } from '@/stores/family';
import { MEMBER_ROLE_LABELS } from '@/types/models';

const familyStore = useFamilyStore();
const memberId = ref('');

const member = computed(() =>
  familyStore.members.find((m) => m.id === memberId.value) || null,
);

onLoad((options) => {
  memberId.value = options?.memberId || '';
  familyStore.load();
});

function goEdit(): void {
  uni.navigateBack();
}
</script>

<template>
  <view class="detail-page">
    <view v-if="member" class="member-header">
      <view class="avatar-large">
        <image
          v-if="member.avatarUrl"
          :src="member.avatarUrl"
          class="avatar-img"
          mode="aspectFill"
        />
        <view v-else class="avatar-placeholder" :style="{ background: member.avatarColor }">
          <text>{{ member.name.slice(0, 1) }}</text>
        </view>
      </view>
      <text class="member-name">{{ member.name }}</text>
      <text class="member-role">{{ MEMBER_ROLE_LABELS[member.role] || '其他' }}</text>
    </view>

    <view v-else class="empty">
      <text>成员不存在</text>
    </view>

    <view v-if="member" class="section">
      <view class="section-title">个人信息档案</view>
      <view class="info-card">
        <view class="info-row">
          <text class="info-label">姓名</text>
          <text class="info-value">{{ member.name }}</text>
        </view>
        <view class="info-row">
          <text class="info-label">家庭关系</text>
          <text class="info-value">{{ MEMBER_ROLE_LABELS[member.role] || '其他' }}</text>
        </view>
        <view class="info-row">
          <text class="info-label">身高</text>
          <text class="info-value">--</text>
        </view>
        <view class="info-row">
          <text class="info-label">体重</text>
          <text class="info-value">--</text>
        </view>
        <view class="info-row">
          <text class="info-label">出生年月</text>
          <text class="info-value">--</text>
        </view>
      </view>
      <text class="info-hint">个人信息档案功能开发中，后续支持每位成员独立维护身体数据</text>
    </view>

    <view v-if="member" class="section">
      <button class="edit-btn" @tap="goEdit">返回</button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.detail-page {
  min-height: 100vh;
  padding: 40rpx 32rpx 80rpx;
  background: #faf6f1;
}

.member-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48rpx 0;
  margin-bottom: 32rpx;
}

.avatar-large {
  width: 160rpx;
  height: 160rpx;
  border-radius: 50%;
  overflow: hidden;
  margin-bottom: 20rpx;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.1);
}

.avatar-img {
  width: 100%;
  height: 100%;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;

  text {
    font-size: 64rpx;
    color: #fff;
    font-weight: 700;
  }
}

.member-name {
  font-size: 36rpx;
  font-weight: 700;
  color: #2d2a26;
  margin-bottom: 8rpx;
}

.member-role {
  font-size: 26rpx;
  color: #f97316;
  background: #fff7ed;
  padding: 6rpx 20rpx;
  border-radius: 16rpx;
}

.section {
  margin-bottom: 32rpx;
}

.section-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #2d2a26;
  margin-bottom: 16rpx;
}

.info-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 8rpx 28rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 2rpx solid #f5f0e8;

  &:last-child {
    border-bottom: none;
  }
}

.info-label {
  font-size: 28rpx;
  color: #78716c;
}

.info-value {
  font-size: 28rpx;
  color: #2d2a26;
  font-weight: 500;
}

.info-hint {
  display: block;
  font-size: 22rpx;
  color: #a8a29e;
  margin-top: 12rpx;
  text-align: center;
}

.edit-btn {
  width: 100%;
  height: 88rpx;
  padding: 0 !important;
  margin: 0;
  border: none;
  border-radius: 44rpx;
  background: linear-gradient(135deg, #f97316, #fb923c);
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;

  &::after {
    border: none;
  }
}

.empty {
  text-align: center;
  padding: 120rpx 0;
  color: #a8a29e;
  font-size: 28rpx;
}
</style>
