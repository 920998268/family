<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useProfileStore } from '@/stores/profile';

const authStore = useAuthStore();
const profileStore = useProfileStore();
const activeTab = ref<'weixin' | 'password'>('weixin');
const authMode = ref<'login' | 'register'>('login');
const errorMsg = ref('');

// 手机号密码登录表单
const form = ref({
  mobile: '',
  password: '',
  confirmPassword: '',
});

async function handleWeixinLogin(): Promise<void> {
  errorMsg.value = '';
  try {
    await authStore.loginWithWeixin();
    await afterLogin();
  } catch (err: any) {
    errorMsg.value = err?.message || '微信登录失败，请重试';
  }
}

async function handlePasswordLogin(): Promise<void> {
  errorMsg.value = '';
  const mobile = form.value.mobile.trim();
  if (!mobile) {
    errorMsg.value = '请输入手机号';
    return;
  }
  if (!/^1[3-9]\d{9}$/.test(mobile)) {
    errorMsg.value = '请输入正确的11位手机号';
    return;
  }
  if (!form.value.password) {
    errorMsg.value = '请输入密码';
    return;
  }
  if (form.value.password.length < 6) {
    errorMsg.value = '密码长度至少6位';
    return;
  }
  try {
    if (authMode.value === 'login') {
      await authStore.loginWithPassword(mobile, form.value.password);
    } else {
      if (form.value.password !== form.value.confirmPassword) {
        errorMsg.value = '两次输入的密码不一致';
        return;
      }
      await authStore.registerAccount(mobile, form.value.password);
    }
    await afterLogin();
  } catch (err: any) {
    errorMsg.value = err?.message || (authMode.value === 'login' ? '登录失败' : '注册失败');
  }
}

async function afterLogin(): Promise<void> {
  // 登录后如果 uid 变化，清空上一个账号的 Profile 数据
  const lastUid = uni.getStorageSync('last_logged_in_uid') || '';
  if (lastUid && lastUid !== authStore.uid) {
    profileStore.save = profileStore.save; // 保持引用
    // 清空 Profile
    try {
      uni.removeStorageSync('family-checkin.profile.v1');
    } catch (e) {
      // ignore
    }
    profileStore.load();
  }
  uni.setStorageSync('last_logged_in_uid', authStore.uid);

  // 登录后先尝试通过手机号自动绑定到预设成员
  try {
    const bindResult = await authStore.autoBindByMobile();
    if (bindResult.bound && bindResult.memberName) {
      uni.showToast({ title: `已关联为「${bindResult.memberName}」`, icon: 'none' });
    }
  } catch (e) {
    // 自动绑定失败不影响登录流程
  }
  const status = await authStore.fetchFamilyStatus();
  if (status.hasFamily) {
    uni.switchTab({ url: '/pages/home/home' });
  } else {
    // 用 reLaunch 清空页面栈，避免用户返回到登录页
    uni.reLaunch({ url: '/pages/family-setup/family-setup' });
  }
}

function switchMode(mode: 'login' | 'register'): void {
  authMode.value = mode;
  errorMsg.value = '';
  form.value.confirmPassword = '';
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
      <!-- 登录方式 Tab -->
      <view class="login-tabs">
        <view
          class="login-tab"
          :class="{ active: activeTab === 'weixin' }"
          @tap="activeTab = 'weixin'"
        >
          <text>微信登录</text>
        </view>
        <view
          class="login-tab"
          :class="{ active: activeTab === 'password' }"
          @tap="activeTab = 'password'"
        >
          <text>手机号登录</text>
        </view>
      </view>

      <!-- 微信一键登录 -->
      <view v-if="activeTab === 'weixin'" class="weixin-section">
        <button
          class="wechat-btn"
          :disabled="authStore.loggingIn"
          @tap="handleWeixinLogin"
        >
          <text v-if="!authStore.loggingIn" class="wechat-icon">✓</text>
          <text class="wechat-text">
            {{ authStore.loggingIn ? '登录中...' : '微信一键登录' }}
          </text>
        </button>
      </view>

      <!-- 手机号 + 密码登录 -->
      <view v-else class="password-section">
        <view class="mode-switch">
          <text
            class="mode-text"
            :class="{ active: authMode === 'login' }"
            @tap="switchMode('login')"
          >登录</text>
          <text class="mode-divider">|</text>
          <text
            class="mode-text"
            :class="{ active: authMode === 'register' }"
            @tap="switchMode('register')"
          >注册</text>
        </view>

        <view class="form-group">
          <input
            v-model="form.mobile"
            class="form-input"
            type="number"
            maxlength="11"
            placeholder="请输入手机号"
            placeholder-class="input-placeholder"
          />
        </view>
        <view class="form-group">
          <input
            v-model="form.password"
            class="form-input"
            type="password"
            placeholder="密码（至少6位）"
            placeholder-class="input-placeholder"
          />
        </view>
        <view v-if="authMode === 'register'" class="form-group">
          <input
            v-model="form.confirmPassword"
            class="form-input"
            type="password"
            placeholder="确认密码"
            placeholder-class="input-placeholder"
          />
        </view>

        <button
          class="submit-btn"
          :disabled="authStore.loggingIn"
          @tap="handlePasswordLogin"
        >
          {{ authStore.loggingIn ? '处理中...' : (authMode === 'login' ? '登 录' : '注 册') }}
        </button>
      </view>

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
  margin-top: 60rpx;
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
  gap: 20rpx;
}

.login-tabs {
  display: flex;
  width: 100%;
  background: #f5f0e8;
  border-radius: 16rpx;
  padding: 8rpx;
  margin-bottom: 8rpx;
}

.login-tab {
  flex: 1;
  text-align: center;
  padding: 18rpx 0;
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

.weixin-section {
  width: 100%;
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

.password-section {
  width: 100%;
}

.mode-switch {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 24rpx;
}

.mode-text {
  font-size: 28rpx;
  color: #a8a29e;

  &.active {
    color: #f97316;
    font-weight: 600;
  }
}

.mode-divider {
  color: #e7e5e4;
  font-size: 24rpx;
}

.form-group {
  margin-bottom: 20rpx;
}

.form-input {
  width: 100%;
  height: 88rpx;
  border: 2rpx solid #e7e5e4;
  border-radius: 16rpx;
  padding: 0 28rpx;
  font-size: 30rpx;
  color: #2d2a26;
  background: #fff;
  box-sizing: border-box;
}

.input-placeholder {
  color: #d6d3d1;
}

.submit-btn {
  width: 100%;
  height: 92rpx;
  padding: 0 !important;
  margin: 8rpx 0 0;
  border: none;
  border-radius: 46rpx;
  background: linear-gradient(135deg, #f97316, #fb923c);
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;

  &::after {
    border: none;
  }

  &[disabled] {
    opacity: 0.6;
  }
}

.login-error {
  font-size: 26rpx;
  color: #ef4444;
  text-align: center;
}

.login-agreement {
  font-size: 22rpx;
  color: #a8a29e;
  margin-top: 8rpx;
  text-align: center;
}
</style>
