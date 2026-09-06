<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const activeTab = ref<'create' | 'join'>('create');
const familyName = ref('');
const inviteCode = ref('');
const errorMsg = ref('');
const submitting = ref(false);
const loading = ref(true);
const familyInfo = ref<{ familyName: string; role: string; inviteCode: string } | null>(null);

const roleLabel: Record<string, string> = {
  owner: '家庭管理员',
  member: '家庭成员',
};

onShow(() => {
  loadStatus();
});

async function loadStatus(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';
  try {
    const status = await authStore.fetchFamilyStatus();
    if (status.hasFamily) {
      familyInfo.value = {
        familyName: status.familyName || '我的家庭',
        role: status.role || 'member',
        inviteCode: status.inviteCode || '',
      };
    } else {
      familyInfo.value = null;
    }
  } catch (err: any) {
    errorMsg.value = err?.message || '获取家庭状态失败';
  } finally {
    loading.value = false;
  }
}

async function handleCreate(): Promise<void> {
  errorMsg.value = '';
  if (!familyName.value.trim()) {
    errorMsg.value = '请输入家庭名称';
    return;
  }
  submitting.value = true;
  try {
    await authStore.createNewFamily(familyName.value.trim());
    uni.showToast({ title: '创建成功', icon: 'success' });
    await loadStatus();
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
    uni.showToast({ title: '加入成功', icon: 'success' });
    await loadStatus();
  } catch (err: any) {
    errorMsg.value = err?.message || '加入家庭失败，请检查邀请码';
  } finally {
    submitting.value = false;
  }
}

function copyInviteCode(): void {
  if (!familyInfo.value?.inviteCode) return;
  uni.setClipboardData({
    data: familyInfo.value.inviteCode,
    success: () => uni.showToast({ title: '邀请码已复制', icon: 'success' }),
  });
}
</script>

<template>
  <view class="setup-page">
    <view class="setup-header">
      <text class="setup-title">我的家庭</text>
      <text class="setup-subtitle">创建家庭空间，和家人共享打卡、食谱与账本</text>
    </view>

    <view v-if="loading" class="loading-tip">
      <text>加载中...</text>
    </view>

    <!-- 已有家庭：展示家庭信息 -->
    <view v-else-if="familyInfo" class="form-card">
      <view class="family-info">
        <view class="family-name-row">
          <text class="family-name">{{ familyInfo.familyName }}</text>
          <text class="family-role">{{ roleLabel[familyInfo.role] || '家庭成员' }}</text>
        </view>

        <view class="invite-section">
          <text class="invite-label">家庭邀请码</text>
          <view class="invite-code-row">
            <text class="invite-code">{{ familyInfo.inviteCode || '暂无' }}</text>
            <button class="copy-btn" @tap="copyInviteCode" v-if="familyInfo.inviteCode">复制</button>
          </view>
          <text class="invite-hint">把邀请码发给家人，家人在「加入家庭」中输入即可加入</text>
        </view>
      </view>
    </view>

    <!-- 无家庭：创建/加入 -->
    <template v-else>
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
    </template>

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

.loading-tip {
  text-align: center;
  padding: 80rpx 0;
  color: #a8a29e;
  font-size: 28rpx;
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
  padding: 0 !important;
  margin: 0;
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

.error-msg {
  display: block;
  text-align: center;
  font-size: 26rpx;
  color: #ef4444;
  margin-top: 32rpx;
}

/* 已有家庭信息展示 */
.family-info {
  .family-name-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 32rpx;
    padding-bottom: 24rpx;
    border-bottom: 2rpx solid #f5f0e8;
  }

  .family-name {
    font-size: 36rpx;
    font-weight: 700;
    color: #2d2a26;
  }

  .family-role {
    font-size: 24rpx;
    color: #f97316;
    background: #fff7ed;
    padding: 8rpx 20rpx;
    border-radius: 20rpx;
  }
}

.invite-section {
  .invite-label {
    display: block;
    font-size: 26rpx;
    color: #78716c;
    margin-bottom: 12rpx;
  }

  .invite-code-row {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-bottom: 12rpx;
  }

  .invite-code {
    flex: 1;
    font-size: 44rpx;
    font-weight: 700;
    color: #2d2a26;
    letter-spacing: 8rpx;
  }

  .copy-btn {
    padding: 0 !important;
    margin: 0;
    width: 120rpx;
    height: 60rpx;
    line-height: 60rpx;
    font-size: 24rpx;
    color: #f97316;
    background: #fff7ed;
    border-radius: 30rpx;
    border: none;

    &::after {
      border: none;
    }
  }

  .invite-hint {
    display: block;
    font-size: 24rpx;
    color: #a8a29e;
    line-height: 1.6;
  }
}
</style>
