<script setup lang="ts">
import { computed, reactive } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useProfileStore } from '@/stores/profile';
import { useAuthStore } from '@/stores/auth';
import type { Gender, MemberRole } from '@/types/models';
import { GENDERS, MEMBER_ROLES } from '@/types/models';
import type { Profile } from '@/types/models';
import { errorMessage } from '@/utils/error';
import { openMeTab } from '@/utils/navigation';

const profileStore = useProfileStore();
const authStore = useAuthStore();

const genderNames = GENDERS.map((item) => item.label);
const roleNames = MEMBER_ROLES.map((item) => item.label);
const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = String(now.getMonth() + 1);
const currentDay = String(now.getDate());
const yearOptions = Array.from({ length: currentYear - 1900 + 1 }, (_, i) => String(1900 + i));
const monthOptions = Array.from({ length: 12 }, (_, i) => String(i + 1));
const dayOptions = Array.from({ length: 31 }, (_, i) => String(i + 1));

const form = reactive({
  name: '',
  gender: 'male' as Gender,
  role: 'other' as MemberRole,
  mobile: '',
  birthYear: String(currentYear),
  birthMonth: currentMonth,
  birthDay: currentDay,
  heightCm: 170,
  currentWeightKg: 60,
  targetWeightKg: 58,
  avatarUrl: '',
});

const genderIndex = computed(() =>
  Math.max(GENDERS.findIndex((item) => item.value === form.gender), 0),
);

const roleIndex = computed(() =>
  Math.max(MEMBER_ROLES.findIndex((item) => item.value === form.role), 0),
);

const yearIndex = computed(() => {
  const idx = yearOptions.indexOf(form.birthYear);
  return idx >= 0 ? idx : yearOptions.length - 1;
});

const monthIndex = computed(() => {
  const idx = monthOptions.indexOf(form.birthMonth);
  return idx >= 0 ? idx : Number(currentMonth) - 1;
});

const dayIndex = computed(() => {
  const idx = dayOptions.indexOf(form.birthDay);
  return idx >= 0 ? idx : Number(currentDay) - 1;
});

onShow(() => {
  profileStore.load();
  const profile = profileStore.profile;
  if (profile) {
    form.name = profile.name;
    form.gender = profile.gender;
    form.mobile = profile.mobile || authStore.mobile || '';
    form.avatarUrl = (profile as any).avatarUrl || '';
    // 解析出生年月日
    if (profile.birthDate) {
      const parts = profile.birthDate.split('-');
      form.birthYear = parts[0] || '';
      form.birthMonth = parts[1] ? String(Number(parts[1])) : '';
      form.birthDay = parts[2] ? String(Number(parts[2])) : '';
    }
    form.heightCm = profile.heightCm;
    form.currentWeightKg = profile.currentWeightKg;
    form.targetWeightKg = profile.targetWeightKg;
  } else {
    form.mobile = authStore.mobile || '';
  }
});

function onGenderChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  form.gender = (GENDERS[index]?.value ?? 'male') as Gender;
}

function onRoleChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  form.role = (MEMBER_ROLES[index]?.value ?? 'other') as MemberRole;
}

function onYearChange(event: { detail: { value: string | number } }): void {
  form.birthYear = yearOptions[Number(event.detail.value)] || '';
}

function onMonthChange(event: { detail: { value: string | number } }): void {
  form.birthMonth = monthOptions[Number(event.detail.value)] || '';
}

function onDayChange(event: { detail: { value: string | number } }): void {
  form.birthDay = dayOptions[Number(event.detail.value)] || '';
}

function onChooseAvatar(event: any): void {
  const url = event?.detail?.avatarUrl;
  if (url) {
    form.avatarUrl = url;
  }
}

function onAlbumTap(): void {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album'],
    success: (imgRes) => {
      if (imgRes.tempFilePaths && imgRes.tempFilePaths[0]) {
        form.avatarUrl = imgRes.tempFilePaths[0];
      }
    },
  });
}

function goBack(): void {
  uni.navigateBack();
}

function save(): void {
  const birthDate = form.birthYear && form.birthMonth && form.birthDay
    ? `${form.birthYear}-${form.birthMonth.padStart(2, '0')}-${form.birthDay.padStart(2, '0')}`
    : '';

  const profile: Profile = {
    name: form.name.trim(),
    gender: form.gender,
    birthDate,
    heightCm: Number(form.heightCm),
    currentWeightKg: Number(form.currentWeightKg),
    targetWeightKg: Number(form.targetWeightKg),
    mobile: form.mobile.trim() || undefined,
  };

  if (!profile.name) {
    uni.showToast({ title: '请填写姓名', icon: 'none' });
    return;
  }

  try {
    profileStore.save({ ...profile, avatarUrl: form.avatarUrl, role: form.role } as any);
    uni.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => {
      openMeTab();
    }, 400);
  } catch (err) {
    uni.showModal({
      title: '保存失败',
      content: errorMessage(err),
      showCancel: false,
    });
  }
}
</script>

<template>
  <view class="page-shell">
    <view class="form-card">
      <view class="section-title">个人信息档案</view>
      <text class="page-subtitle">完善个人基础信息与身体数据</text>

      <!-- 头像 -->
      <view class="avatar-section">
        <button class="avatar-circle-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
          <image v-if="form.avatarUrl" :src="form.avatarUrl" class="avatar-img" mode="aspectFill" />
          <view v-else class="avatar-placeholder">
            <text>{{ (form.name || '?').slice(0, 1) }}</text>
          </view>
        </button>
        <view class="avatar-actions">
          <text class="avatar-hint">点击头像使用微信头像</text>
          <text class="avatar-link" @tap="onAlbumTap">从相册选择</text>
        </view>
      </view>

      <view class="field field-first">
        <text class="field-label">姓名</text>
        <input v-model="form.name" class="field-control" placeholder="例如：张三" />
      </view>

      <view class="field">
        <text class="field-label">性别</text>
        <picker :range="genderNames" :value="genderIndex" @change="onGenderChange">
          <view class="picker-value">
            <text>{{ genderNames[genderIndex] }}</text>
            <text class="picker-arrow">›</text>
          </view>
        </picker>
      </view>

      <view class="field">
        <text class="field-label">家庭关系</text>
        <picker :range="roleNames" :value="roleIndex" @change="onRoleChange">
          <view class="picker-value">
            <text>{{ roleNames[roleIndex] }}</text>
            <text class="picker-arrow">›</text>
          </view>
        </picker>
      </view>

      <view class="field">
        <text class="field-label">手机号</text>
        <input
          v-model="form.mobile"
          class="field-control"
          type="number"
          maxlength="11"
          placeholder="请输入手机号（选填）"
          placeholder-class="field-placeholder"
        />
      </view>

      <!-- 出生日期：三列选择器同一行 -->
      <view class="field">
        <text class="field-label">出生日期</text>
        <view class="date-row">
          <picker :range="yearOptions" :value="yearIndex" @change="onYearChange">
            <view class="date-picker">
              <text>{{ form.birthYear || '年' }}</text>
              <text class="picker-arrow">›</text>
            </view>
          </picker>
          <picker :range="monthOptions" :value="monthIndex" @change="onMonthChange">
            <view class="date-picker">
              <text>{{ form.birthMonth || '月' }}</text>
              <text class="picker-arrow">›</text>
            </view>
          </picker>
          <picker :range="dayOptions" :value="dayIndex" @change="onDayChange">
            <view class="date-picker">
              <text>{{ form.birthDay || '日' }}</text>
              <text class="picker-arrow">›</text>
            </view>
          </picker>
        </view>
      </view>

      <view class="field">
        <text class="field-label">身高（cm）</text>
        <input v-model.number="form.heightCm" class="field-control" type="number" placeholder="例如：170" />
      </view>

      <view class="field">
        <text class="field-label">当前体重（kg）</text>
        <input v-model.number="form.currentWeightKg" class="field-control" type="digit" placeholder="例如：60" />
      </view>

      <view class="field">
        <text class="field-label">目标体重（kg）</text>
        <input v-model.number="form.targetWeightKg" class="field-control" type="digit" placeholder="例如：58" />
      </view>

      <view class="form-actions">
        <button class="btn btn-ghost" @tap="goBack">取消</button>
        <button class="btn btn-primary" @tap="save">保存</button>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page-shell {
  min-height: 100vh;
  padding: 32rpx;
  background: #faf6f1;
}

.form-card {
  background: #fff;
  border-radius: 24rpx;
  padding: 32rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
}

.section-title {
  display: block;
  font-size: 36rpx;
  font-weight: 700;
  color: #2d2a26;
  margin-bottom: 8rpx;
}

.page-subtitle {
  display: block;
  font-size: 24rpx;
  color: #a8a29e;
  margin-bottom: 32rpx;
}

.avatar-section {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding-bottom: 28rpx;
  margin-bottom: 8rpx;
  border-bottom: 2rpx solid #f5f0e8;
}

.avatar-circle-btn {
  width: 120rpx;
  height: 120rpx;
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

.avatar-placeholder {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #f97316, #fb923c);
  display: flex;
  align-items: center;
  justify-content: center;

  text {
    font-size: 48rpx;
    color: #fff;
    font-weight: 700;
  }
}

.avatar-img {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
}

.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.avatar-hint {
  font-size: 24rpx;
  color: #78716c;
}

.avatar-link {
  font-size: 26rpx;
  color: #f97316;
  font-weight: 600;
}

.field {
  padding: 24rpx 0;
  border-bottom: 2rpx solid #f5f0e8;

  &.field-first {
    padding-top: 24rpx;
  }
}

.field-label {
  display: block;
  font-size: 26rpx;
  color: #78716c;
  margin-bottom: 12rpx;
}

.field-control {
  width: 100%;
  font-size: 30rpx;
  color: #2d2a26;
}

.field-placeholder {
  color: #d6d3d1;
}

.picker-value {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.picker-arrow {
  color: #c9c2ba;
  font-size: 36rpx;
}

.date-row {
  display: flex;
  gap: 12rpx;
}

.date-picker {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #faf6f1;
  border-radius: 12rpx;
  padding: 18rpx 16rpx;
  font-size: 28rpx;
  color: #2d2a26;
  min-width: 0;
}

.form-actions {
  display: flex;
  gap: 20rpx;
  margin-top: 40rpx;
}

.btn {
  flex: 1;
  height: 88rpx;
  border-radius: 44rpx;
  font-size: 30rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 !important;
  margin: 0;

  &::after {
    border: none;
  }
}

.btn-primary {
  background: linear-gradient(135deg, #f97316, #fb923c);
  color: #fff;
  border: none;
}

.btn-ghost {
  background: #f5f0e8;
  color: #78716c;
  border: none;
}
</style>
