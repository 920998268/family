<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useFamilyStore } from '@/stores/family';
import { useAuthStore } from '@/stores/auth';
import { useProfileStore } from '@/stores/profile';
import { restoreFamilyDataFromCloud } from '@/services/CloudRestoreService';
import { MEMBER_ROLE_LABELS } from '@/types/models';
import { matchCloudMember } from '@/utils/member';
import { generateMemberBindCode, listCloudMembers, addCloudMember, updateCloudMember } from '@/unicloud';

const familyStore = useFamilyStore();
const authStore = useAuthStore();
const profileStore = useProfileStore();
const memberId = ref('');
const bindCode = ref('');
const generating = ref(false);
const presetMobile = ref('');

const member = computed(() =>
  familyStore.members.find((m) => m.id === memberId.value) || null,
);

const isOwner = computed(() => authStore.familyRole === 'owner');

// 可选择的手机号列表：当前登录手机号 + 家庭下未绑定的手机号
const selectableMobiles = computed(() => {
  const options: { mobile: string; label: string }[] = [];
  if (authStore.mobile) {
    options.push({ mobile: authStore.mobile, label: `${authStore.mobile}（当前登录）` });
  }
  familyStore.members.forEach((m) => {
    if (m.mobile && !m.userId && m.id !== memberId.value) {
      if (!options.find((o) => o.mobile === m.mobile)) {
        options.push({ mobile: m.mobile, label: m.mobile });
      }
    }
  });
  return options;
});

onLoad((options) => {
  memberId.value = options?.memberId || '';
  // familyStore.load() 为同步读取本地缓存，无需延时等待
  familyStore.load();
  const m = familyStore.members.find((item) => item.id === memberId.value);
  presetMobile.value = m?.mobile || '';
});

// 下拉选择手机号
function showMobilePicker(): void {
  if (selectableMobiles.value.length === 0) {
    uni.showToast({ title: '暂无可选手机号', icon: 'none' });
    return;
  }
  uni.showActionSheet({
    itemList: selectableMobiles.value.map((o) => o.label),
    success: (res) => {
      const selected = selectableMobiles.value[res.tapIndex];
      if (selected) {
        presetMobile.value = selected.mobile;
      }
    },
  });
}

// 点击选择绑定按钮，绑定当前手机号
async function handleBindMobile(): Promise<void> {
  if (!presetMobile.value) {
    uni.showToast({ title: '请先选择或输入手机号', icon: 'none' });
    return;
  }
  if (!/^\d{4,12}$/.test(presetMobile.value)) {
    uni.showToast({ title: '手机号需为4-12位数字', icon: 'none' });
    return;
  }
  await savePresetMobile();
}

// 手机号输入校验
function onPresetMobileBlur(): void {
  if (!presetMobile.value) return;
  const m = presetMobile.value.trim();
  if (!/^\d{4,12}$/.test(m)) {
    uni.showToast({ title: '手机号需为4-12位数字', icon: 'none' });
    presetMobile.value = '';
  }
}

// 保存预设手机号：本地 + 云端同步（换设备/清缓存后仍需生效）
async function savePresetMobile(): Promise<void> {
  const m = member.value;
  if (!m) return;
  const mobile = presetMobile.value.trim() || undefined;

  let cloudId: string | undefined = (m as any).cloudId;
  try {
    const cloudMembers = await listCloudMembers();
    const cm = matchCloudMember(cloudMembers, m);
    if (cm && cm._id) cloudId = cm._id;
  } catch (e) {
    console.warn('[云端同步] 查询成员失败:', e);
  }

  familyStore.update(m.id, { mobile, ...(cloudId ? { cloudId } : {}) } as any);

  try {
    if (cloudId) {
      await updateCloudMember(cloudId, { name: m.name, mobile });
    } else {
      const res = await addCloudMember({
        name: m.name,
        role: m.role,
        gender: (m as any).gender,
        avatarColor: m.avatarColor,
        avatarUrl: m.avatarUrl,
        mobile,
      });
      familyStore.update(m.id, { cloudId: res._id } as any);
    }
    uni.showToast({ title: '预设手机号已保存', icon: 'success' });
  } catch (e) {
    console.warn('[云端同步] 预设手机号保存失败:', e);
    uni.showToast({ title: '云端同步失败，请检查网络', icon: 'none' });
  }
}

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

// 绑定到当前登录账号：校验预设手机号与当前登录手机号，一致或未预设才允许
async function bindToMyAccount(): Promise<void> {
  const m = member.value;
  if (!m || m.userId) return;
  const loginMobile = authStore.mobile;
  if (m.mobile && loginMobile && m.mobile !== loginMobile) {
    uni.showToast({ title: `预设手机号(${m.mobile})与当前登录手机号(${loginMobile})不一致，无法绑定`, icon: 'none' });
    return;
  }
  const targetMobile = m.mobile || loginMobile || '';
  uni.showModal({
    title: '确认绑定',
    content: `将「${m.name}」绑定到当前登录账号${loginMobile ? `（${loginMobile}）` : ''}？绑定后此账号即为该成员登录身份。`,
    success: async (r) => {
      if (!r.confirm) return;
      try {
        const cloudMembers = await listCloudMembers();
        const anyM = m as any;
        const cm = matchCloudMember(cloudMembers, m);
        const payload = { userId: authStore.uid, mobile: targetMobile || undefined, name: m.name };
        if (cm && cm._id) {
          await updateCloudMember(cm._id, payload);
          familyStore.update(m.id, { userId: authStore.uid, cloudId: cm._id, mobile: targetMobile || undefined } as any);
        } else {
          const res = await addCloudMember({
            role: m.role,
            gender: anyM.gender,
            avatarColor: m.avatarColor,
            avatarUrl: m.avatarUrl,
            ...payload,
          });
          familyStore.update(m.id, { userId: authStore.uid, cloudId: res._id, mobile: targetMobile || undefined } as any);
        }
        uni.showToast({ title: '绑定成功', icon: 'success' });
        // 绑定后云端已自动合并重复成员，强制刷新本地成员与个人档案
        restoreFamilyDataFromCloud(authStore.uid, true)
          .then((r) => {
            if (r.restoredMembers) familyStore.load();
            if (r.restoredProfile) profileStore.load();
          })
          .catch(() => {});
      } catch (err: any) {
        uni.showToast({ title: err?.message || '绑定失败', icon: 'none' });
      }
    },
  });
}
</script>

<template>
  <view class="detail-page">
    <view v-if="member" class="member-header">
      <view class="avatar-large">
        <avatar-image
          :src="member.avatarUrl"
          :size="160"
          :bg="member.avatarColor"
          :name="member.name"
          :font-size="60"
        />
      </view>
      <text class="member-name">
        {{ member.name }}
        <text v-if="!member.userId" class="unbound-tag">未绑定</text>
      </text>
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
          <text class="info-value">{{ member.name }}<text v-if="!member.userId" class="virtual-tag">（虚拟成员）</text></text>
        </view>
        <view class="info-row">
          <text class="info-label">家庭关系</text>
          <text class="info-value">{{ MEMBER_ROLE_LABELS[member.role] || '其他' }}</text>
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

    <!-- 未绑定成员：账号绑定（所有家庭成员均可操作，生成绑定码仅管理员） -->
    <view v-if="member && !member.userId" class="section">
      <view class="section-title">账号绑定</view>
      <view class="bind-card">
        <text class="bind-desc">可预设手机号（对方用此手机号登录自动关联），也可直接绑定到当前登录账号。</text>

        <!-- 手机号预设：输入框可自由输入，选择按钮从家庭成员手机号中挑一个 -->
        <view class="preset-mobile-row">
          <input
            v-model="presetMobile"
            class="preset-mobile-input"
            type="number"
            maxlength="12"
            placeholder="输入或选择手机号"
            placeholder-class="preset-placeholder"
            @blur="onPresetMobileBlur"
          />
          <button class="preset-mobile-btn" @tap="showMobilePicker">选择</button>
        </view>
        <button class="bind-to-account-btn" @tap="handleBindMobile">保存预设手机号</button>

        <!-- 绑定到当前登录账号：校验预设手机号与登录手机号是否一致 -->
        <button class="bind-to-account-btn" @tap="bindToMyAccount">绑定到当前登录账号</button>

        <!-- 生成绑定码（仅管理员） -->
        <template v-if="isOwner">
          <view v-if="bindCode" class="bind-code-row">
            <text class="bind-code">{{ bindCode }}</text>
            <button class="copy-btn" @tap="copyBindCode">复制</button>
          </view>
          <button class="bind-btn" :disabled="generating" @tap="handleGenerateBindCode">
            {{ generating ? '生成中...' : bindCode ? '重新生成绑定码' : '生成绑定码' }}
          </button>
        </template>
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
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.unbound-tag {
  font-size: 22rpx;
  font-weight: 500;
  color: #a8a29e;
  background: #f5f5f4;
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
}

.member-role {
  font-size: 26rpx;
  color: #f97316;
  background: #fff7ed;
  padding: 6rpx 20rpx;
  border-radius: 16rpx;
}

.virtual-tag {
  font-size: 24rpx;
  color: #a8a29e;
  font-weight: 400;
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

.preset-mobile-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.preset-mobile-input {
  flex: 1;
  height: 72rpx;
  background: #faf6f1;
  border-radius: 12rpx;
  padding: 0 20rpx;
  font-size: 28rpx;
  color: #2d2a26;
}

.preset-placeholder {
  color: #d6d3d1;
}

.preset-mobile-btn {
  height: 72rpx;
  padding: 0 28rpx !important;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 12rpx;
  background: #f97316;
  color: #fff;
  font-size: 26rpx;
  font-weight: 600;
  line-height: 1;

  &::after {
    border: none;
  }
}

.bind-to-account-btn {
  width: 100%;
  height: 80rpx;
  padding: 0 !important;
  margin: 0 0 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2rpx solid #f97316;
  border-radius: 12rpx;
  background: #fff;
  color: #f97316;
  font-size: 28rpx;
  font-weight: 600;

  &::after {
    border: none;
  }
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
