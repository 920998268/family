<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { useFamilyStore } from '@/stores/family';
import type { FamilyMember, MemberRole } from '@/types/models';
import { AVATAR_COLORS, MEMBER_ROLES } from '@/types/models';
import MemberAvatar from '@/components/MemberAvatar.vue';

const authStore = useAuthStore();
const familyStore = useFamilyStore();

// 家庭空间状态
const activeTab = ref<'create' | 'join'>('create');
const familyName = ref('');
const inviteCode = ref('');
const errorMsg = ref('');
const submitting = ref(false);
const loading = ref(true);
const familyInfo = ref<{ familyName: string; role: string; inviteCode: string } | null>(null);

// 家庭成员管理
const formVisible = ref(false);
const editingMember = ref<FamilyMember | null>(null);
const form = reactive({
  name: '',
  role: 'father' as MemberRole,
  avatarColor: AVATAR_COLORS[0],
  avatarUrl: '',
});

const roleNames = MEMBER_ROLES.map((item) => item.label);
const roleIndex = computed(() =>
  Math.max(MEMBER_ROLES.findIndex((item) => item.value === form.role), 0),
);

const roleLabel: Record<string, string> = {
  owner: '家庭管理员',
  member: '家庭成员',
};

onShow(() => {
  loadStatus();
  familyStore.load();
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
    setTimeout(() => {
      uni.switchTab({ url: '/pages/home/home' });
    }, 800);
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
    setTimeout(() => {
      uni.switchTab({ url: '/pages/home/home' });
    }, 800);
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

function goMemberDetail(memberId: string): void {
  uni.navigateTo({ url: `/pages/me/member-detail?memberId=${memberId}` });
}

// 家庭成员管理
function resetForm(): void {
  form.name = editingMember.value?.name ?? '';
  form.role = editingMember.value?.role ?? 'father';
  form.avatarColor = editingMember.value?.avatarColor ?? AVATAR_COLORS[0];
  form.avatarUrl = editingMember.value?.avatarUrl ?? '';
}

function onChooseAvatar(event: any): void {
  const avatarUrl = event?.detail?.avatarUrl;
  if (avatarUrl) {
    form.avatarUrl = avatarUrl;
  }
}

function openAdd(): void {
  editingMember.value = null;
  resetForm();
  formVisible.value = true;
}

function openEdit(member: FamilyMember): void {
  editingMember.value = member;
  resetForm();
  formVisible.value = true;
}

function closeForm(): void {
  formVisible.value = false;
  editingMember.value = null;
}

function onRoleChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  form.role = (MEMBER_ROLES[index]?.value ?? 'parent') as MemberRole;
}

function saveMember(): void {
  if (!form.name.trim()) {
    uni.showToast({ title: '请填写成员姓名', icon: 'none' });
    return;
  }
  const draft = {
    name: form.name.trim(),
    role: form.role,
    avatarColor: form.avatarColor,
    avatarUrl: form.avatarUrl,
  };
  if (editingMember.value) {
    familyStore.update(editingMember.value.id, draft);
  } else {
    familyStore.add(draft);
  }
  uni.showToast({ title: '已保存', icon: 'success' });
  closeForm();
}

function removeMember(member: FamilyMember): void {
  uni.showModal({
    title: '删除家庭成员',
    content: `确定删除「${member.name}」吗？`,
    success: (result) => {
      if (result.confirm) {
        familyStore.remove(member.id);
        uni.showToast({ title: '已删除', icon: 'success' });
      }
    },
  });
}
</script>

<template>
  <view class="setup-page">
    <view class="setup-header">
      <text class="setup-title">我的家庭</text>
      <text class="setup-subtitle">家庭空间、邀请码与家庭成员管理</text>
    </view>

    <view v-if="loading" class="loading-tip">
      <text>加载中...</text>
    </view>

    <!-- 无家庭：创建/加入 -->
    <template v-else-if="!familyInfo">
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
        <button class="submit-btn" :disabled="submitting" @tap="handleCreate">
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
        <button class="submit-btn" :disabled="submitting" @tap="handleJoin">
          {{ submitting ? '加入中...' : '加入家庭' }}
        </button>
      </view>
    </template>

    <!-- 已有家庭：信息 + 成员管理 -->
    <template v-else>
      <view class="form-card">
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

      <view class="members-section">
        <view class="section-header">
          <text class="section-title">家庭成员</text>
          <text class="section-count">共 {{ familyStore.members.length }} 位</text>
        </view>

        <button class="add-member-btn" @tap="openAdd">+ 添加成员</button>

        <view v-if="formVisible" class="form-card member-form">
          <view class="form-title">{{ editingMember ? '编辑成员' : '添加成员' }}</view>
          <view class="avatar-section">
            <view class="avatar-preview">
              <image v-if="form.avatarUrl" :src="form.avatarUrl" class="avatar-preview-img" mode="aspectFill" />
              <view v-else class="avatar-preview-dot" :style="{ background: form.avatarColor }">
                <text>{{ (form.name || '?').slice(0, 1) }}</text>
              </view>
            </view>
            <button class="avatar-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
              使用微信头像
            </button>
          </view>
          <view class="form-group">
            <text class="form-label">姓名</text>
            <input v-model="form.name" class="form-input" placeholder="例如：爸爸 / 小明" />
          </view>
          <view class="form-group">
            <text class="form-label">家庭关系</text>
            <picker :range="roleNames" :value="roleIndex" @change="onRoleChange">
              <view class="picker-value">
                <text>{{ roleNames[roleIndex] }}</text>
                <text class="picker-arrow">›</text>
              </view>
            </picker>
          </view>
          <view class="form-group" v-if="!form.avatarUrl">
            <text class="form-label">头像颜色</text>
            <view class="color-row">
              <view
                v-for="color in AVATAR_COLORS"
                :key="color"
                class="color-dot"
                :class="{ 'color-dot-active': form.avatarColor === color }"
                :style="{ background: color }"
                @tap="form.avatarColor = color"
              />
            </view>
          </view>
          <view class="form-actions">
            <button class="btn-ghost" @tap="closeForm">取消</button>
            <button class="btn-primary" @tap="saveMember">保存</button>
          </view>
        </view>

        <view class="member-list">
          <view v-for="member in familyStore.members" :key="member.id" class="member-card" @tap="goMemberDetail(member.id)">
            <MemberAvatar :name="member.name" :color="member.avatarColor" :avatarUrl="member.avatarUrl" />
            <view class="member-info">
              <text class="member-name">{{ member.name }}</text>
              <text class="member-role">{{ MEMBER_ROLES.find((r) => r.value === member.role)?.label }}</text>
            </view>
            <view class="member-actions">
              <button class="btn-sm btn-secondary" @tap.stop="openEdit(member)">编辑</button>
              <button class="btn-sm btn-danger" @tap.stop="removeMember(member)">删除</button>
            </view>
          </view>
          <view v-if="familyStore.members.length === 0" class="empty-tip">
            还没有家庭成员，点击上方按钮添加
          </view>
        </view>
      </view>
    </template>

    <text v-if="errorMsg" class="error-msg">{{ errorMsg }}</text>
  </view>
</template>

<style lang="scss" scoped>
.setup-page {
  min-height: 100vh;
  padding: 40rpx 32rpx 80rpx;
  background: #faf6f1;
}

.setup-header {
  margin-bottom: 32rpx;
}

.setup-title {
  display: block;
  font-size: 44rpx;
  font-weight: 700;
  color: #2d2a26;
  margin-bottom: 8rpx;
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
  margin-bottom: 32rpx;
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
  padding: 32rpx 28rpx;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.04);
  margin-bottom: 24rpx;
}

.form-group {
  margin-bottom: 20rpx;
}

.form-label {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #2d2a26;
  margin-bottom: 12rpx;
}

.form-input {
  width: 100%;
  height: 80rpx;
  border: 2rpx solid #e7e5e4;
  border-radius: 14rpx;
  padding: 0 20rpx;
  font-size: 28rpx;
  color: #2d2a26;
  background: #fafaf9;
}

.invite-input {
  text-align: center;
  font-size: 36rpx;
  letter-spacing: 10rpx;
  font-weight: 600;
}

.input-placeholder {
  color: #d6d3d1;
}

.form-hint {
  display: block;
  font-size: 22rpx;
  color: #a8a29e;
  margin-bottom: 24rpx;
  line-height: 1.6;
}

.submit-btn {
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

  &[disabled] {
    opacity: 0.6;
  }
}

.error-msg {
  display: block;
  text-align: center;
  font-size: 26rpx;
  color: #ef4444;
  margin-top: 24rpx;
}

/* 家庭信息 */
.family-info {
  .family-name-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24rpx;
    padding-bottom: 20rpx;
    border-bottom: 2rpx solid #f5f0e8;
  }

  .family-name {
    font-size: 34rpx;
    font-weight: 700;
    color: #2d2a26;
  }

  .family-role {
    font-size: 22rpx;
    color: #f97316;
    background: #fff7ed;
    padding: 6rpx 16rpx;
    border-radius: 16rpx;
  }
}

.invite-section {
  .invite-label {
    display: block;
    font-size: 24rpx;
    color: #78716c;
    margin-bottom: 8rpx;
  }

  .invite-code-row {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-bottom: 8rpx;
  }

  .invite-code {
    flex: 1;
    font-size: 40rpx;
    font-weight: 700;
    color: #2d2a26;
    letter-spacing: 6rpx;
  }

  .copy-btn {
    padding: 0 !important;
    margin: 0;
    width: 100rpx;
    height: 52rpx;
    line-height: 52rpx;
    font-size: 22rpx;
    color: #f97316;
    background: #fff7ed;
    border-radius: 26rpx;
    border: none;

    &::after {
      border: none;
    }
  }

  .invite-hint {
    display: block;
    font-size: 22rpx;
    color: #a8a29e;
    line-height: 1.6;
  }
}

/* 成员管理 */
.members-section {
  margin-top: 8rpx;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.section-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #2d2a26;
}

.section-count {
  font-size: 24rpx;
  color: #a8a29e;
}

.add-member-btn {
  width: 100%;
  height: 80rpx;
  padding: 0 !important;
  margin: 0 0 20rpx;
  border: 2rpx dashed #f97316;
  border-radius: 16rpx;
  background: #fff7ed;
  color: #f97316;
  font-size: 28rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;

  &::after {
    border: none;
  }
}

.member-form {
  .form-title {
    font-size: 28rpx;
    font-weight: 700;
    color: #2d2a26;
    margin-bottom: 20rpx;
  }
}

.avatar-section {
  display: flex;
  align-items: center;
  gap: 24rpx;
  margin-bottom: 24rpx;
  padding-bottom: 24rpx;
  border-bottom: 2rpx solid #f5f0e8;
}

.avatar-preview {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
}

.avatar-preview-img {
  width: 100%;
  height: 100%;
}

.avatar-preview-dot {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;

  text {
    font-size: 40rpx;
    color: #fff;
    font-weight: 700;
  }
}

.avatar-btn {
  flex: 1;
  height: 72rpx;
  padding: 0 !important;
  margin: 0;
  border: 2rpx solid #f97316;
  border-radius: 36rpx;
  background: #fff7ed;
  color: #f97316;
  font-size: 26rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;

  &::after {
    border: none;
  }
}

.picker-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 80rpx;
  border: 2rpx solid #e7e5e4;
  border-radius: 14rpx;
  padding: 0 20rpx;
  font-size: 28rpx;
  color: #2d2a26;
  background: #fafaf9;
}

.picker-arrow {
  color: #c9c2ba;
  font-size: 32rpx;
}

.color-row {
  display: flex;
  gap: 16rpx;
}

.color-dot {
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  border: 4rpx solid transparent;
}

.color-dot-active {
  border-color: #2d2a26;
}

.form-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}

.btn-ghost {
  flex: 1;
  height: 76rpx;
  padding: 0 !important;
  margin: 0;
  border: 2rpx solid #e7e5e4;
  border-radius: 38rpx;
  background: #fff;
  color: #78716c;
  font-size: 28rpx;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;

  &::after {
    border: none;
  }
}

.btn-primary {
  flex: 1;
  height: 76rpx;
  padding: 0 !important;
  margin: 0;
  border: none;
  border-radius: 38rpx;
  background: linear-gradient(135deg, #f97316, #fb923c);
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;

  &::after {
    border: none;
  }
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.member-card {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: #fff;
  border-radius: 18rpx;
  padding: 20rpx 24rpx;
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.04);
}

.member-info {
  flex: 1;
}

.member-name {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #2d2a26;
}

.member-role {
  font-size: 22rpx;
  color: #a8a29e;
}

.member-actions {
  display: flex;
  gap: 10rpx;
}

.btn-sm {
  padding: 0 !important;
  margin: 0;
  width: 90rpx;
  height: 52rpx;
  line-height: 52rpx;
  font-size: 22rpx;
  border-radius: 26rpx;
  border: none;

  &::after {
    border: none;
  }
}

.btn-secondary {
  background: #f5f0e8;
  color: #78716c;
}

.btn-danger {
  background: #fef2f2;
  color: #ef4444;
}

.empty-tip {
  text-align: center;
  padding: 40rpx 0;
  color: #a8a29e;
  font-size: 26rpx;
}
</style>
