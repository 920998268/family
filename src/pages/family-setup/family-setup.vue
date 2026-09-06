<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const activeTab = ref<'create' | 'join'>('create');
const familyName = ref('');
const inviteCode = ref('');
const errorMsg = ref('');
const submitting = ref(false);

async function handleCreate(): Promise<void> {
  errorMsg.value = '';
  if (!familyName.value.trim()) {
    errorMsg.value = '请输入家庭名称';
    return;
  }
  submitting.value = true;
  try {
    await authStore.createNewFamily(familyName.value.trim());
    uni.switchTab({ url: '/pages/home/home' });
  } catch (err: any) {
    errorMsg.value = err?.message || '创建家庭失败，请重试';
  } finally {
    submitting.value = false;
  }
}

async function handleJoin(): Promise<void> {
  errorMsg.value = '';
  if (!inviteCode.value.trim()) {
    errorMsg.value = '请输入邀请码';
    return;
  }
  submitting.value = true;
  try {
    await authStore.joinExistingFamily(inviteCode.value.trim().toUpperCase());
    uni.switchTab({ url: '/pages/home/home' });
  } catch (err: any) {
    errorMsg.value = err?.message || '加入家庭失败，请检查邀请码';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <view class="setup-page">
    <view class="setup-header">
      <text class="setup-title">加入家庭</text>
      <text class="setup-subtitle">创建一个新家庭，或通过邀请码加入已有家庭</text>
    </view>

    <view class="tab-bar">
      <view
        class="tab-item"
        :class="{ active: activeTab === 'create' }"
        @tap="activeTab = 'create'"
      >
        <text>创建家庭</text>
      </view>
      <view
        class="tab-item"
        :class="{ active: activeTab === 'join' }"
        @tap="activeTab = 'join'"
      >
        <text>加入家庭</text>
      </view>
    </view>

    <!-- 创建家庭 -->
    <view v-if="activeTab === 'create'" class="form-card">
      <view class="form-group">
        <text class="form-label">家庭名称</text>
        <input
          class="form-input"
          v-model="familyName"
          placeholder="例如：我们的小家"
          placeholder-class="input-placeholder"
          maxlength="20"
        />
      </view>
      <text class="form-hint">创建后你将成为家庭管理员，可以生成邀请码邀请家人加入</text>
      <button
        class="submit-btn"
        :disabled="submitting"
        @tap="handleCreate"
      >
        {{ submitting ? '创建中...' : '创建家庭' }}
      </button>
    </view>

    <!-- 加入家庭 -->
    <view v-else class="form-card">
      <view class="form-group">
        <text class="form-label">邀请码</text>
        <input
          class="form-input invite-input"
          v-model="inviteCode"
          placeholder="请输入6位邀请码"
          placeholder-class="input-placeholder"
          maxlength="6"
          @input="inviteCode = inviteCode.toUpperCase()"
        />
      </view>
      <text class="form-hint">向家庭管理员获取邀请码，加入后即可共享家庭数据</text>
      <button
        class="submit-btn"
        :disabled="submitting"
        @tap="handleJoin"
      >
        {{ submitting ? '加入中...' : '加入家庭' }}
      </button>
    </view>

    <text v-if="errorMsg" class="error-msg">{{ errorMsg }}</text>
  </view>
</template>

<style lang="scss" scoped>
.setup-page {
  min-height: 100vh;
  padding: 80rpx 48rpx;
  background: #faf6f1;
}

.setup-header {
  margin-bottom: 48rpx;
}

.setup-title {
  display: block;
  font-size: 44rpx;
  font-weight: 700;
  color: #2d2a26;
  margin-bottom: 12rpx;
}

.setup-subtitle {
  font-size: 26rpx;
  color: #78716c;
}

.tab-bar {
  display: flex;
  background: #f5f0e8;
  border-radius: 16rpx;
  padding: 8rpx;
  margin-bottom: 40rpx;
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 20rpx 0;
  border-radius: 12rpx;
  font-size: 28rpx;
  color: #78716c;
  transition: all 0.2s;

  &.active {
    background: #fff;
    color: #f97316;
    font-weight: 600;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
  }
}

.form-card {
  background: #fff;
  border-radius: 24rpx;
  padding: 40rpx 32rpx;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.04);
}

.form-group {
  margin-bottom: 24rpx;
}

.form-label {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #2d2a26;
  margin-bottom: 16rpx;
}

.form-input {
  width: 100%;
  height: 88rpx;
  border: 2rpx solid #e7e5e4;
  border-radius: 16rpx;
  padding: 0 24rpx;
  font-size: 30rpx;
  color: #2d2a26;
  background: #fafaf9;
}

.invite-input {
  text-align: center;
  font-size: 40rpx;
  letter-spacing: 12rpx;
  font-weight: 600;
}

.input-placeholder {
  color: #d6d3d1;
}

.form-hint {
  display: block;
  font-size: 24rpx;
  color: #a8a29e;
  margin-bottom: 32rpx;
  line-height: 1.6;
}

.submit-btn {
  width: 100%;
  height: 92rpx;
  line-height: 92rpx;
  padding: 0;
  margin: 0;
  border-radius: 46rpx;
  background: linear-gradient(135deg, #f97316, #fb923c);
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
  text-align: center;

  &[disabled] {
    opacity: 0.6;
  }
}

.error-msg {
  display: block;
  text-align: center;
  font-size: 26rpx;
  color: #ef4444;
  margin-top: 32rpx;
}
</style>
