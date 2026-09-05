<script setup lang="ts">
import { computed, reactive } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useProfileStore } from '@/stores/profile';
import type { Gender } from '@/types/models';
import { GENDERS } from '@/types/models';
import type { Profile } from '@/types/models';
import { todayKey } from '@/utils/date';
import { errorMessage } from '@/utils/error';
import { openMeTab } from '@/utils/navigation';

const profileStore = useProfileStore();

const genderNames = GENDERS.map((item) => item.label);

const form = reactive({
  name: '',
  gender: 'male' as Gender,
  birthDate: todayKey(),
  heightCm: 170,
  currentWeightKg: 60,
  targetWeightKg: 58,
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
  } catch (error) {
    uni.showModal({
      title: '保存失败',
      content: errorMessage(error, '请检查填写内容'),
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
