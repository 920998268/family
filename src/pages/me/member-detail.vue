<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useFamilyStore } from '@/stores/family';
import { useAuthStore } from '@/stores/auth';
import { MEMBER_ROLE_LABELS } from '@/types/models';
import { generateMemberBindCode } from '@/unicloud';

const familyStore = useFamilyStore();
const authStore = useAuthStore();
const memberId = ref('');
const bindCode = ref('');
const generating = ref(false);

const member = computed(() =>
  familyStore.members.find((m) => m.id === memberId.value) || null,
);

const isOwner = computed(() => authStore.familyRole === 'owner');

onLoad((options) => {
  memberId.value = options?.memberId || '';
  familyStore.load();
});

function goBack(): void {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack();
  } else {
    // 兜底：页面栈异常时返回到「我的」页面
    uni.switchTab({ url: '/pages/me/me' });
  }
}

async function handleGenerateBindCode(): Promise<void> {
  if (!member.value || generating.value) return;
  generating.value = true;
  try {
    const result = await generateMemberBindCode(member.value.id, {
      name: member.value.name,
      role: member.value.role,
      avatarColor: member.value.avatarColor,
      avatarUrl: member.value.avatarUrl,
    });
    bindCode.value = result.bindCode;
    uni.showToast({ title: '绑定码已生成', icon: 'success' });
  } catch (err: any) {
    uni.showToast({ title: err?.message || '生成失败', icon: 'none' });
  } finally {
    generating.value = false;
  }
}

function copyBindCode(): void {
  if (!bindCode.value) return;
  uni.setClipboardData({
    data: bindCode.value,
    success: () => uni.showToast({ title: '已复制', icon: 'success' }),
  });
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
          <text class="info-label">账号绑定</text>
          <text class="info-value" :class="{ 'bound': member.userId, 'unbound': !member.userId }">
            {{ member.userId ? '已绑定登录账号' : '未绑定（虚拟成员）' }}
          </text>
        </view>
        <view class="info-row">
          <text class="info-label">手机号</text>
          <text class="info-value">{{ (member as any)?.mobile || '-' }}</text>
        </view>
        <view class="info-row">
          <text class="info-label">身高</text>
          <text class="info-value">{{ (member as any)?.heightCm ? (member as any).heightCm + ' cm' : '--' }}</text>
        </view>
        <view class="info-row">
          <text class="info-label">当前体重</text>
          <text class="info-value">{{ (member as any)?.currentWeightKg ? (member as any).currentWeightKg + ' kg' : '--' }}</text>
        </view>
        <view class="info-row">
          <text class="info-label">目标体重</text>
          <text class="info-value">{{ (member as any)?.targetWeightKg ? (member as any).targetWeightKg + ' kg' : '--' }}</text>
        </view>
        <view class="info-row">
          <text class="info-label">出生日期</text>
          <text class="info-value">{{ (member as any)?.birthDate || '--' }}</text>
        </view>
      </view>
      <text class="info-hint">个人信息档案功能开发中，后续支持每位成员独立维护身体数据</text>
    </view>

    <!-- 未绑定成员：生成绑定码（仅管理员可见） -->
    <view v-if="member && !member.userId && isOwner" class="section">
      <view class="section-title">账号绑定</view>
      <view class="bind-card">
        <text class="bind-desc">生成绑定码后，对方用自己的账号登录，在家庭设置页选择「绑定成员」输入此码即可完成关联。绑定码24小时内有效。</text>
        <view v-if="bindCode" class="bind-code-row">
          <text class="bind-code">{{ bindCode }}</text>
          <button class="copy-btn" @tap="copyBindCode">复制</button>
        </view>
        <button class="bind-btn" :disabled="generating" @tap="handleGenerateBindCode">
          {{ generating ? '生成中...' : bindCode ? '重新生成绑定码' : '生成绑定码' }}
        </button>
      </view>
    </view>

    <view v-if="member" class="section">
      <button class="edit-btn" @tap="goBack">返回</button>
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

  &.bound {
    color: #10b981;
  }

  &.unbound {
    color: #a8a29e;
  }
}

.info-hint {
  display: block;
  font-size: 22rpx;
  color: #a8a29e;
  margin-top: 12rpx;
  text-align: center;
}

.bind-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 28rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
}

.bind-desc {
  display: block;
  font-size: 24rpx;
  color: #78716c;
  line-height: 1.6;
  margin-bottom: 20rpx;
}

.bind-code-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #faf6f1;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  margin-bottom: 20rpx;
}

.bind-code {
  font-size: 40rpx;
  font-weight: 700;
  color: #f97316;
  letter-spacing: 8rpx;
}

.copy-btn {
  font-size: 24rpx;
  color: #f97316;
  background: #fff7ed;
  border: none;
  padding: 8rpx 24rpx;
  border-radius: 20rpx;
  margin: 0;

  &::after {
    border: none;
  }
}

.bind-btn {
  width: 100%;
  height: 80rpx;
  padding: 0 !important;
  margin: 0;
  border: 2rpx solid #f97316;
  border-radius: 40rpx;
  background: #fff;
  color: #f97316;
  font-size: 28rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;

  &::after {
    border: none;
  }

  &[disabled] {
    opacity: 0.5;
  }
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
