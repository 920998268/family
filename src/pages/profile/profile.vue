<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useProfileStore } from '@/stores/profile';
import { GENDERS, type Gender, type Profile } from '@/types/models';
import { errorMessage } from '@/utils/error';

const profileStore = useProfileStore();

const genderNames = GENDERS.map((item) => item.label);

const form = reactive<Profile>({
  gender: 'male',
  birthDate: '1990-01-01',
  heightCm: 170,
  currentWeightKg: 70,
  targetWeightKg: 65,
});

const genderIndex = computed(() => {
  const index = GENDERS.findIndex((item) => item.value === form.gender);
  return Math.max(index, 0);
});

function syncFromStore(): void {
  const profile = profileStore.profile;
  if (!profile) {
    return;
  }

  form.gender = profile.gender;
  form.birthDate = profile.birthDate;
  form.heightCm = profile.heightCm;
  form.currentWeightKg = profile.currentWeightKg;
  form.targetWeightKg = profile.targetWeightKg;
}

onShow(() => {
  profileStore.load();
  syncFromStore();
});

watch(
  () => profileStore.profile,
  () => syncFromStore(),
);

function onGenderChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  form.gender = (GENDERS[index]?.value ?? 'male') as Gender;
}

function onDateChange(event: { detail: { value: string } }): void {
  form.birthDate = event.detail.value;
}

function save(): void {
  const profile: Profile = {
    gender: form.gender,
    birthDate: form.birthDate,
    heightCm: Number(form.heightCm),
    currentWeightKg: Number(form.currentWeightKg),
    targetWeightKg: Number(form.targetWeightKg),
  };

  try {
    profileStore.save(profile);
    uni.showToast({ title: '已保存', icon: 'success' });
  } catch (error) {
    uni.showModal({
      title: '保存失败',
      content: errorMessage(error, '请检查填写内容'),
      showCancel: false,
    });
  }
}

function goBackup(): void {
  uni.navigateTo({ url: '/pages/backup/backup' });
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">健康档案</text>
      <text class="page-subtitle">基础信息仅保存在当前设备，后续可用于身体变化分析。</text>
    </view>

    <view class="section form-card">
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
        <text class="field-label">出生日期</text>
        <picker mode="date" :value="form.birthDate" @change="onDateChange">
          <view class="picker-value">
            <text>{{ form.birthDate }}</text>
            <text class="picker-arrow">›</text>
          </view>
        </picker>
      </view>

      <view class="field">
        <text class="field-label">身高（cm）</text>
        <input
          v-model.number="form.heightCm"
          class="field-control"
          type="number"
          placeholder="例如：175"
        />
      </view>

      <view class="field">
        <text class="field-label">当前体重（kg）</text>
        <input
          v-model.number="form.currentWeightKg"
          class="field-control"
          type="number"
          placeholder="例如：72"
        />
      </view>

      <view class="field">
        <text class="field-label">目标体重（kg）</text>
        <input
          v-model.number="form.targetWeightKg"
          class="field-control"
          type="number"
          placeholder="例如：65"
        />
      </view>
    </view>

    <view class="section">
      <button class="btn btn-primary btn-block" @tap="save">保存健康档案</button>
    </view>

    <view class="section">
      <button class="btn btn-ghost btn-block" @tap="goBackup">数据备份</button>
    </view>
  </view>
</template>

