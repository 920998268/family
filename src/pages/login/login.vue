<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const errorMsg = ref('');

async function handleLogin(): Promise<void> {
  errorMsg.value = '';
  try {
    await authStore.loginWithWeixin();
    const status = await authStore.fetchFamilyStatus();
    if (status.hasFamily) {
      uni.switchTab({ url: '/pages/home/home' });
    } else {
      uni.redirectTo({ url: '/pages/family-setup/family-setup' });
    }
  } catch (err: any) {
    errorMsg.value = err?.message || '登录失败，请重试';
  }
}
</script>

<template>
  <view class="login-page">
    <view class="login-hero">
      <view class="login-logo">
        <text class="logo-icon">家</text>
      </view>
      <text class="login-title">家庭打卡</text>
      <text class="login-subtitle">运动 · 饮食 · 学习 · 食谱 · 出行 · 记账</text>
      <text class="login-desc">和家人一起记录每一天的成长</text>
    </view>

    <view class="login-actions">
      <button
        class="wechat-btn"
        :disabled="authStore.loggingIn"
        @tap="handleLogin"
      >
        <text v-if="!authStore.loggingIn" class="wechat-icon">✓</text>
        <text class="wechat-text">
          {{ authStore.loggingIn ? '登录中...' : '微信一键登录' }}
        </text>
      </button>

      <text v-if="errorMsg" class="login-error">{{ errorMsg }}</text>

      <text class="login-agreement">
        登录即表示同意《用户协议》和《隐私政策》
      </text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 120rpx 60rpx 80rpx;
  background: linear-gradient(180deg, #fff7ed 0%, #faf6f1 60%);
}

.login-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 80rpx;
}

.login-logo {
  width: 160rpx;
  height: 160rpx;
  border-radius: 40rpx;
  background: linear-gradient(135deg, #f97316, #fb923c);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12rpx 32rpx rgba(249, 115, 22, 0.3);
  margin-bottom: 40rpx;
}

.logo-icon {
  font-size: 72rpx;
  color: #fff;
  font-weight: 700;
}

.login-title {
  font-size: 48rpx;
  font-weight: 700;
  color: #2d2a26;
  margin-bottom: 16rpx;
}

.login-subtitle {
  font-size: 26rpx;
  color: #78716c;
  margin-bottom: 24rpx;
}

.login-desc {
  font-size: 28rpx;
  color: #a8a29e;
}

.login-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
}

.wechat-btn {
  width: 100%;
  height: 96rpx;
  padding: 0 !important;
  margin: 0;
  border: none;
  border-radius: 48rpx;
  background: #07c160;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  line-height: 1;

  &::after {
    border: none;
  }

  &[disabled] {
    opacity: 0.6;
  }
}

.wechat-icon {
  font-size: 32rpx;
  color: #fff;
  font-weight: 700;
}

.wechat-text {
  font-size: 32rpx;
  color: #fff;
  font-weight: 600;
}

.login-error {
  font-size: 26rpx;
  color: #ef4444;
}

.login-agreement {
  font-size: 22rpx;
  color: #a8a29e;
  margin-top: 16rpx;
}
</style>
