<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useProfileStore } from '@/stores/profile';
import { useAuthStore } from '@/stores/auth';
import { useFamilyStore } from '@/stores/family';
import type { Gender, MemberRole } from '@/types/models';
import { GENDERS, MEMBER_ROLES, AVATAR_COLORS } from '@/types/models';
import type { Profile } from '@/types/models';
import { errorMessage } from '@/utils/error';
import { openMeTab } from '@/utils/navigation';
import { listCloudMembers, addCloudMember, updateCloudMember } from '@/unicloud';
import { ensureCloudAvatar } from '@/utils/upload';

const profileStore = useProfileStore();
const authStore = useAuthStore();
const familyStore = useFamilyStore();

const genderNames = GENDERS.map((item) => item.label);
const roleNames = MEMBER_ROLES.map((item) => item.label);
const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = String(now.getMonth() + 1);
const currentDay = String(now.getDate());
const yearPickerOptions = Array.from({ length: currentYear - 1900 + 1 }, (_, i) => String(1900 + i));
const monthPickerOptions = Array.from({ length: 12 }, (_, i) => String(i + 1));
const dayPickerOptions = Array.from({ length: 31 }, (_, i) => String(i + 1));

const avatarFailed = ref(false);
const form = reactive({
  name: '',
  gender: '' as Gender,
  role: '' as MemberRole,
  mobile: '',
  birthYear: '',
  birthMonth: '',
  birthDay: '',
  heightCm: '',
  currentWeightKg: '',
  targetWeightKg: '',
  avatarUrl: '',
});

const genderIndex = computed(() =>
  Math.max(GENDERS.findIndex((item) => item.value === form.gender), 0),
);

const roleIndex = computed(() =>
  Math.max(MEMBER_ROLES.findIndex((item) => item.value === form.role), 0),
);

const yearPickerIndex = computed(() =>
  Math.max(yearPickerOptions.indexOf(form.birthYear), yearPickerOptions.length - 1),
);
const monthPickerIndex = computed(() =>
  Math.max(monthPickerOptions.indexOf(form.birthMonth), Number(currentMonth) - 1),
);
const dayPickerIndex = computed(() =>
  Math.max(dayPickerOptions.indexOf(form.birthDay), Number(currentDay) - 1),
);

onShow(() => {
  avatarFailed.value = false;
  profileStore.load();
  const profile = profileStore.profile;
  if (profile) {
    form.name = profile.name;
    form.gender = profile.gender;
    form.role = (profile as any).role || '';
    form.mobile = profile.mobile || authStore.mobile || '';
    form.avatarUrl = (profile as any).avatarUrl || '';
    // 解析出生年月日
    if (profile.birthDate) {
      const parts = profile.birthDate.split('-');
      form.birthYear = parts[0] || '';
      form.birthMonth = parts[1] ? String(Number(parts[1])) : '';
      form.birthDay = parts[2] ? String(Number(parts[2])) : '';
    }
    form.heightCm = profile.heightCm ? String(profile.heightCm) : '';
    form.currentWeightKg = profile.currentWeightKg ? String(profile.currentWeightKg) : '';
    form.targetWeightKg = profile.targetWeightKg ? String(profile.targetWeightKg) : '';
  } else {
    form.mobile = authStore.mobile || '';
  }
});

function onGenderChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  form.gender = (GENDERS[index]?.value ?? '') as Gender;
}

function onRoleChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  form.role = (MEMBER_ROLES[index]?.value ?? '') as MemberRole;
}

function onYearBlur(): void {
  const y = Number(form.birthYear);
  if (!form.birthYear) return;
  if (y < 1900) form.birthYear = '1900';
  if (y > currentYear) form.birthYear = String(currentYear);
}

function onMonthBlur(): void {
  const m = Number(form.birthMonth);
  if (!form.birthMonth) return;
  if (m < 1) form.birthMonth = '1';
  if (m > 12) form.birthMonth = '12';
}

function onDayBlur(): void {
  const d = Number(form.birthDay);
  if (!form.birthDay) return;
  if (d < 1) form.birthDay = '1';
  if (d > 31) form.birthDay = '31';
}

function onMobileBlur(): void {
  if (!form.mobile) return;
  const m = form.mobile.trim();
  if (!/^\d{4,12}$/.test(m)) {
    uni.showToast({ title: '手机号需为4-12位数字', icon: 'none' });
    form.mobile = '';
  }
}

function onYearPickerChange(event: { detail: { value: string | number } }): void {
  form.birthYear = yearPickerOptions[Number(event.detail.value)] || '';
}

function onMonthPickerChange(event: { detail: { value: string | number } }): void {
  form.birthMonth = monthPickerOptions[Number(event.detail.value)] || '';
}

function onDayPickerChange(event: { detail: { value: string | number } }): void {
  form.birthDay = dayPickerOptions[Number(event.detail.value)] || '';
}

function onChooseAvatar(event: any): void {
  const url = event?.detail?.avatarUrl;
  if (url) {
    form.avatarUrl = url;
    avatarFailed.value = false;
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
        avatarFailed.value = false;
      }
    },
  });
}

function goBack(): void {
  uni.navigateBack();
}

async function save(): Promise<void> {
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
  if (!profile.gender) {
    uni.showToast({ title: '请选择性别', icon: 'none' });
    return;
  }
  if (!form.role) {
    uni.showToast({ title: '请选择家庭关系', icon: 'none' });
    return;
  }

  try {
    // 头像为本地临时路径时先上传云存储，确保清缓存/跨设备后仍可显示
    const cloudAvatar = await ensureCloudAvatar(form.avatarUrl);
    profileStore.save({ ...profile, avatarUrl: cloudAvatar, role: form.role } as any);

    // 保存个人档案后，如果已登录且有家庭，但家庭成员中没有当前用户记录，自动创建
    if (authStore.isLoggedIn && authStore.hasFamily) {
      // 本地成员同步：无当前用户记录时自动创建
      familyStore.load();
      const existingMember = familyStore.members.find(
        (m) => m.userId === authStore.uid || (m.mobile && m.mobile === authStore.mobile),
      );
      if (!existingMember) {
        familyStore.add({
          name: profile.name,
          role: form.role,
          gender: form.gender,
          avatarColor: AVATAR_COLORS[0],
          mobile: profile.mobile || authStore.mobile || undefined,
          avatarUrl: form.avatarUrl || undefined,
          heightCm: profile.heightCm || undefined,
          currentWeightKg: profile.currentWeightKg || undefined,
          targetWeightKg: profile.targetWeightKg || undefined,
          birthDate: profile.birthDate || undefined,
          userId: authStore.uid || undefined,
        } as any);
      }
      // 云端同步：已有匹配成员则更新，否则创建（关联当前登录账号）
      syncProfileToCloud(profile, form);
    }

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

// 保存个人档案后同步云端：云端有匹配成员则更新，否则创建并关联当前登录账号
async function syncProfileToCloud(profile: Profile, form: any): Promise<void> {
  try {
    const members = await listCloudMembers();
    const uid = authStore.uid;
    const existing = members.find(
      (m: any) => m.userId === uid || (m.mobile && m.mobile === authStore.mobile),
    );
    const data = {
      name: profile.name,
      gender: profile.gender,
      role: form.role,
      mobile: profile.mobile || authStore.mobile || undefined,
      avatarColor: AVATAR_COLORS[0],
      avatarUrl: form.avatarUrl || undefined,
      heightCm: profile.heightCm || undefined,
      currentWeightKg: profile.currentWeightKg || undefined,
      targetWeightKg: profile.targetWeightKg || undefined,
      birthDate: profile.birthDate || undefined,
      userId: uid || undefined,
    };
    if (existing && existing._id) {
      await updateCloudMember(existing._id, data);
    } else {
      await addCloudMember(data);
    }
  } catch (e) {
    console.warn('[云端同步] 个人档案保存失败:', e);
    uni.showToast({ title: '云端同步失败，请检查网络后重试', icon: 'none' });
  }
}
</script>

<template>
  <view class="page-shell">
    <view class="form-card">

      <!-- 头像 -->
      <view class="avatar-section">
        <button class="avatar-circle-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
          <image
            v-if="form.avatarUrl && !avatarFailed"
            :src="form.avatarUrl"
            class="avatar-img"
            mode="aspectFill"
            @error="avatarFailed = true"
          />
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
        <input v-model="form.name" class="field-control" placeholder="例如：张三" placeholder-class="field-placeholder" />
      </view>

      <view class="field">
        <text class="field-label">性别</text>
        <picker :range="genderNames" :value="genderIndex" @change="onGenderChange">
          <view class="picker-value">
            <text :class="{ 'picker-placeholder': !form.gender }">{{ form.gender ? genderNames[genderIndex] : '请选择性别' }}</text>
            <text class="picker-arrow">›</text>
          </view>
        </picker>
      </view>

      <view class="field">
        <text class="field-label">家庭关系</text>
        <picker :range="roleNames" :value="roleIndex" @change="onRoleChange">
          <view class="picker-value">
            <text :class="{ 'picker-placeholder': !form.role }">{{ form.role ? roleNames[roleIndex] : '请选择家庭关系' }}</text>
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
          maxlength="12"
          placeholder="请输入手机号（选填）"
          placeholder-class="field-placeholder"
          @blur="onMobileBlur"
        />
      </view>

      <!-- 出生日期：可手动输入 + 选择器 -->
      <view class="field">
        <text class="field-label">出生日期</text>
        <view class="date-row">
          <view class="date-input-wrapper">
            <input
              v-model="form.birthYear"
              class="date-input"
              type="number"
              maxlength="4"
              placeholder="年"
              placeholder-class="date-placeholder"
              @blur="onYearBlur"
              @tap.stop
            />
            <picker :range="yearPickerOptions" :value="yearPickerIndex" @change="onYearPickerChange">
              <text class="date-picker-icon">📅</text>
            </picker>
          </view>
          <view class="date-input-wrapper">
            <input
              v-model="form.birthMonth"
              class="date-input"
              type="number"
              maxlength="2"
              placeholder="月"
              placeholder-class="date-placeholder"
              @blur="onMonthBlur"
              @tap.stop
            />
            <picker :range="monthPickerOptions" :value="monthPickerIndex" @change="onMonthPickerChange">
              <text class="date-picker-icon">📅</text>
            </picker>
          </view>
          <view class="date-input-wrapper">
            <input
              v-model="form.birthDay"
              class="date-input"
              type="number"
              maxlength="2"
              placeholder="日"
              placeholder-class="date-placeholder"
              @blur="onDayBlur"
              @tap.stop
            />
            <picker :range="dayPickerOptions" :value="dayPickerIndex" @change="onDayPickerChange">
              <text class="date-picker-icon">📅</text>
            </picker>
          </view>
        </view>
      </view>

      <view class="field">
        <text class="field-label">身高（cm）</text>
        <input v-model.number="form.heightCm" class="field-control" type="number" placeholder="例如：170" placeholder-class="field-placeholder" />
      </view>

      <view class="field">
        <text class="field-label">当前体重（kg）</text>
        <input v-model.number="form.currentWeightKg" class="field-control" type="digit" placeholder="例如：60" placeholder-class="field-placeholder" />
      </view>

      <view class="field">
        <text class="field-label">目标体重（kg）</text>
        <input v-model.number="form.targetWeightKg" class="field-control" type="digit" placeholder="例如：58" placeholder-class="field-placeholder" />
      </view>

      <text class="page-subtitle page-subtitle-bottom">完善个人基础信息与身体数据</text>
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

.page-subtitle-bottom {
  margin-bottom: 16rpx;
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
  font-size: 30rpx;
}

.picker-value {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 30rpx;
  color: #2d2a26;
}

.picker-arrow {
  color: #c9c2ba;
  font-size: 36rpx;
}

.picker-placeholder {
  color: #d6d3d1;
  font-size: 30rpx;
}

.date-row {
  display: flex;
  gap: 12rpx;
}

.date-input-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  background: #faf6f1;
  border-radius: 12rpx;
  padding: 0 12rpx;
  height: 72rpx;
}

.date-input {
  flex: 1;
  height: 72rpx;
  font-size: 28rpx;
  color: #2d2a26;
  text-align: center;
  min-width: 0;
}

.date-picker-icon {
  font-size: 28rpx;
  padding: 0 8rpx;
  flex-shrink: 0;
}

.date-placeholder {
  color: #d6d3d1;
  font-size: 28rpx;
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
