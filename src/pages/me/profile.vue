<script setup lang="ts">
import { computed, reactive } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useProfileStore } from '@/stores/profile';
import { useAuthStore } from '@/stores/auth';
import type { Gender } from '@/types/models';
import { GENDERS } from '@/types/models';
import type { Profile } from '@/types/models';
import { todayKey } from '@/utils/date';
import { errorMessage } from '@/utils/error';
import { openMeTab } from '@/utils/navigation';

const profileStore = useProfileStore();
const authStore = useAuthStore();

const genderNames = GENDERS.map((item) => item.label);

const form = reactive({
  name: '',
  gender: 'male' as Gender,
  birthDate: todayKey(),
  heightCm: 170,
  currentWeightKg: 60,
  targetWeightKg: 58,
  mobile: '',
});

const genderIndex = computed(() =>
  Math.max(GENDERS.findIndex((item) => item.value === form.gender), 0),
);

onShow(() => {
  profileStore.load();
  const profile = profileStore.profile;
  if (profile) {
    form.name = profile.name;
    form.gender = profile.gender;
    form.birthDate = profile.birthDate;
    form.heightCm = profile.heightCm;
    form.currentWeightKg = profile.currentWeightKg;
    form.targetWeightKg = profile.targetWeightKg;
    form.mobile = profile.mobile || authStore.mobile || '';
  } else {
    form.mobile = authStore.mobile || '';
  }
});

function onGenderChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  form.gender = (GENDERS[index]?.value ?? 'male') as Gender;
}

function onBirthDateChange(event: { detail: { value: string } }): void {
  form.birthDate = event.detail.value;
}

function goBack(): void {
  uni.navigateBack();
}

function save(): void {
  const profile: Profile = {
    name: form.name.trim(),
    gender: form.gender,
    birthDate: form.birthDate,
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
    profileStore.save(profile);
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
      <text class="page-subtitle">用于记录全家成员的健康基础信息</text>

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

      <view class="field">
        <text class="field-label">出生年月</text>
        <picker mode="date" :value="form.birthDate" @change="onBirthDateChange">
          <view class="picker-value">
            <text>{{ form.birthDate }}</text>
            <text class="picker-arrow">›</text>
          </view>
        </picker>
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

.field {
  padding: 24rpx 0;
  border-bottom: 2rpx solid #f5f0e8;

  &.field-first {
    padding-top: 0;
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
