<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { useFamilyStore } from '@/stores/family';
import type { FamilyMember, MemberRole, Gender } from '@/types/models';
import { AVATAR_COLORS, MEMBER_ROLES, GENDERS } from '@/types/models';
import MemberAvatar from '@/components/MemberAvatar.vue';
import { listCloudMembers, addCloudMember, updateCloudMember, removeCloudMember, updateFamilyName } from '@/unicloud';
import { restoreFamilyDataFromCloud } from '@/services/CloudRestoreService';
import { ensureCloudAvatar } from '@/utils/upload';

const authStore = useAuthStore();
const familyStore = useFamilyStore();

// 家庭空间状态
const activeTab = ref<'create' | 'join' | 'bind'>('create');
const familyName = ref('');
const inviteCode = ref('');
const bindCode = ref('');
const errorMsg = ref('');
const submitting = ref(false);
const loading = ref(true);
const familyInfo = ref<{ familyName: string; role: string; inviteCode: string } | null>(null);
const editingFamilyName = ref(false);
const familyNameInput = ref('');

// 家庭成员管理
const formVisible = ref(false);
const editingMember = ref<FamilyMember | null>(null);
const form = reactive({
  name: '',
  gender: '' as Gender,
  role: '' as MemberRole,
  avatarColor: AVATAR_COLORS[0],
  avatarUrl: '',
  mobile: '',
  heightCm: '',
  currentWeightKg: '',
  targetWeightKg: '',
  birthYear: '',
  birthMonth: '',
  birthDay: '',
});

const memberYearOptions = Array.from({ length: new Date().getFullYear() - 1900 + 1 }, (_, i) => String(1900 + i));
const memberMonthOptions = Array.from({ length: 12 }, (_, i) => String(i + 1));
const memberDayOptions = Array.from({ length: 31 }, (_, i) => String(i + 1));
const memberYearPickerIndex = computed(() => Math.max(memberYearOptions.indexOf(form.birthYear), memberYearOptions.length - 1));
const memberMonthPickerIndex = computed(() => Math.max(memberMonthOptions.indexOf(form.birthMonth), new Date().getMonth()));
const memberDayPickerIndex = computed(() => Math.max(memberDayOptions.indexOf(form.birthDay), new Date().getDate() - 1));

const roleNames = MEMBER_ROLES.map((item) => item.label);
const genderNames = GENDERS.map((item) => item.label);
const roleIndex = computed(() =>
  Math.max(MEMBER_ROLES.findIndex((item) => item.value === form.role), 0),
);
const genderIndex = computed(() =>
  Math.max(GENDERS.findIndex((item) => item.value === form.gender), 0),
);

const roleLabel: Record<string, string> = {
  owner: '家庭管理员',
  member: '家庭成员',
};

const isOwner = computed(() => authStore.familyRole === 'owner');

onShow(() => {
  loadStatus();
  familyStore.load();
  // 兜底：本地无成员但有家庭时，从云端恢复已保存的成员与个人档案（防抖）
  if (!familyStore.members.length && authStore.isLoggedIn && authStore.hasFamily) {
    restoreFamilyDataFromCloud(authStore.uid)
      .then((r) => {
        if (r.restoredMembers) familyStore.load();
      })
      .catch(() => {});
  }
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

async function handleBind(): Promise<void> {
  errorMsg.value = '';
  if (!bindCode.value.trim()) {
    errorMsg.value = '请输入绑定码';
    return;
  }
  submitting.value = true;
  try {
    const result = await authStore.bindToMember(bindCode.value.trim().toUpperCase());
    uni.showToast({ title: `已绑定为「${result.memberName}」`, icon: 'success' });
    setTimeout(() => {
      uni.switchTab({ url: '/pages/home/home' });
    }, 1000);
  } catch (err: any) {
    errorMsg.value = err?.message || '绑定失败，请检查绑定码';
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

function startEditFamilyName(): void {
  familyNameInput.value = familyInfo.value?.familyName || '';
  editingFamilyName.value = true;
}

async function saveFamilyName(): Promise<void> {
  const name = familyNameInput.value.trim();
  if (!name) {
    uni.showToast({ title: '家庭名称不能为空', icon: 'none' });
    return;
  }
  try {
    // 云端持久化（管理员），成功后同步本地状态
    const res = await updateFamilyName(name);
    if (familyInfo.value) {
      familyInfo.value.familyName = res.name;
    }
    authStore.familyName = res.name;
    editingFamilyName.value = false;
    uni.showToast({ title: '已保存', icon: 'success' });
  } catch (err: any) {
    uni.showToast({ title: err?.message || '保存失败', icon: 'none' });
  }
}

function goMemberDetail(memberId: string): void {
  uni.navigateTo({ url: `/pages/me/member-detail?memberId=${memberId}` });
}

// 家庭成员管理
function resetForm(): void {
  form.name = editingMember.value?.name ?? '';
  form.gender = (editingMember.value as any)?.gender ?? '';
  form.role = (editingMember.value?.role ?? '') as MemberRole;
  form.avatarColor = editingMember.value?.avatarColor ?? AVATAR_COLORS[0];
  form.avatarUrl = editingMember.value?.avatarUrl ?? '';
  form.mobile = editingMember.value?.mobile ?? '';
  form.heightCm = (editingMember.value as any)?.heightCm ?? '';
  form.currentWeightKg = (editingMember.value as any)?.currentWeightKg ?? '';
  form.targetWeightKg = (editingMember.value as any)?.targetWeightKg ?? '';
  // 解析出生日期
  const birthDate = (editingMember.value as any)?.birthDate || '';
  if (birthDate) {
    const parts = birthDate.split('-');
    form.birthYear = parts[0] || '';
    form.birthMonth = parts[1] ? String(Number(parts[1])) : '';
    form.birthDay = parts[2] ? String(Number(parts[2])) : '';
  } else {
    form.birthYear = '';
    form.birthMonth = '';
    form.birthDay = '';
  }
}

function onChooseAvatar(event: any): void {
  const avatarUrl = event?.detail?.avatarUrl;
  if (avatarUrl) {
    form.avatarUrl = avatarUrl;
  }
}

function onChooseAlbum(): void {
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

function onMemberYearBlur(): void {
  const y = Number(form.birthYear);
  if (!form.birthYear) return;
  if (y < 1900) form.birthYear = '1900';
  if (y > new Date().getFullYear()) form.birthYear = String(new Date().getFullYear());
}

function onMemberMonthBlur(): void {
  const m = Number(form.birthMonth);
  if (!form.birthMonth) return;
  if (m < 1) form.birthMonth = '1';
  if (m > 12) form.birthMonth = '12';
}

function onMemberDayBlur(): void {
  const d = Number(form.birthDay);
  if (!form.birthDay) return;
  if (d < 1) form.birthDay = '1';
  if (d > 31) form.birthDay = '31';
}

function onMemberYearPickerChange(event: { detail: { value: string | number } }): void {
  form.birthYear = memberYearOptions[Number(event.detail.value)] || '';
}

function onMemberMonthPickerChange(event: { detail: { value: string | number } }): void {
  form.birthMonth = memberMonthOptions[Number(event.detail.value)] || '';
}

function onMemberDayPickerChange(event: { detail: { value: string | number } }): void {
  form.birthDay = memberDayOptions[Number(event.detail.value)] || '';
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
  form.role = (MEMBER_ROLES[index]?.value ?? '') as MemberRole;
}

function onGenderChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  form.gender = (GENDERS[index]?.value ?? '') as Gender;
}

async function saveMember(): Promise<void> {
  if (!form.name.trim()) {
    uni.showToast({ title: '请填写成员姓名', icon: 'none' });
    return;
  }
  if (!form.gender) {
    uni.showToast({ title: '请选择性别', icon: 'none' });
    return;
  }
  if (!form.role) {
    uni.showToast({ title: '请选择家庭关系', icon: 'none' });
    return;
  }
  const birthDate = form.birthYear && form.birthMonth && form.birthDay
    ? `${form.birthYear}-${form.birthMonth.padStart(2, '0')}-${form.birthDay.padStart(2, '0')}`
    : undefined;
  // 头像为本地临时路径时先上传云存储，确保清缓存/跨设备后仍可显示
  const cloudAvatar = await ensureCloudAvatar(form.avatarUrl);
  const draft = {
    name: form.name.trim(),
    gender: form.gender,
    role: form.role,
    avatarColor: form.avatarColor,
    avatarUrl: cloudAvatar,
    mobile: form.mobile.trim() || undefined,
    heightCm: form.heightCm ? Number(form.heightCm) : undefined,
    currentWeightKg: form.currentWeightKg ? Number(form.currentWeightKg) : undefined,
    targetWeightKg: form.targetWeightKg ? Number(form.targetWeightKg) : undefined,
    birthDate,
  };
  let saved: FamilyMember;
  if (editingMember.value) {
    saved = familyStore.update(editingMember.value.id, draft);
  } else {
    saved = familyStore.add(draft);
  }
  uni.showToast({ title: '已保存', icon: 'success' });
  closeForm();
  // 云端同步（不阻塞 UI）
  syncMemberToCloud(saved);
}

// 保存成员后同步云端：云端有匹配成员则更新，否则新增并回填 cloudId
async function syncMemberToCloud(member: FamilyMember): Promise<void> {
  try {
    const cloudMembers = await listCloudMembers();
    const anyMember = member as any;
    const match = cloudMembers.find(
      (m: any) =>
        (anyMember.cloudId && m._id === anyMember.cloudId) ||
        (member.userId && m.userId === member.userId) ||
        (member.mobile && m.mobile === member.mobile),
    );
    const data = {
      name: member.name,
      role: member.role,
      gender: anyMember.gender,
      mobile: member.mobile,
      avatarColor: member.avatarColor,
      avatarUrl: member.avatarUrl,
      heightCm: anyMember.heightCm,
      currentWeightKg: anyMember.currentWeightKg,
      targetWeightKg: anyMember.targetWeightKg,
      birthDate: anyMember.birthDate,
      userId: member.userId,
    };
    if (match && match._id) {
      await updateCloudMember(match._id, data);
      if (!anyMember.cloudId) {
        familyStore.update(member.id, { cloudId: match._id } as any);
      }
    } else {
      const res = await addCloudMember(data);
      familyStore.update(member.id, { cloudId: res._id } as any);
    }
  } catch (e) {
    console.warn('[云端同步] 成员保存失败:', e);
    uni.showToast({ title: '云端同步失败，请检查网络', icon: 'none' });
  }
}

function removeMember(member: FamilyMember): void {
  uni.showModal({
    title: '删除家庭成员',
    content: `确定删除「${member.name}」吗？`,
    success: (result) => {
      if (result.confirm) {
        familyStore.remove(member.id);
        uni.showToast({ title: '已删除', icon: 'success' });
        removeMemberFromCloud(member);
      }
    },
  });
}

// 删除成员后同步云端
async function removeMemberFromCloud(member: FamilyMember): Promise<void> {
  try {
    const cloudMembers = await listCloudMembers();
    const anyMember = member as any;
    const match = cloudMembers.find(
      (m: any) =>
        (anyMember.cloudId && m._id === anyMember.cloudId) ||
        (member.userId && m.userId === member.userId),
    );
    if (match && match._id) {
      await removeCloudMember(match._id);
    }
  } catch (e) {
    console.warn('[云端同步] 成员删除失败:', e);
  }
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
        <view
          class="tab-item"
          :class="{ active: activeTab === 'bind' }"
          @tap="activeTab = 'bind'"
        >
          <text>绑定成员</text>
        </view>
      </view>

      <view v-if="activeTab === 'create'" class="form-card">
        <view class="form-group">
          <text class="form-label">家庭名称</text>
          <input
            class="form-input"
            v-model="familyName"
            placeholder="例如：我们的小家"
            placeholder-style="color:#d6d3d1;font-size:28rpx"
            maxlength="20"
          />
        </view>
        <text class="form-hint">创建后你将成为家庭管理员，可以生成邀请码邀请家人加入</text>
        <button class="submit-btn" :disabled="submitting" @tap="handleCreate">
          {{ submitting ? '创建中...' : '创建家庭' }}
        </button>
      </view>

      <view v-else-if="activeTab === 'join'" class="form-card">
        <view class="form-group">
          <text class="form-label">邀请码</text>
          <input
            class="form-input invite-input"
            v-model="inviteCode"
            placeholder="请输入6位邀请码"
            placeholder-style="color:#d6d3d1;font-size:28rpx"
            maxlength="6"
            @input="inviteCode = inviteCode.toUpperCase()"
          />
        </view>
        <text class="form-hint">向家庭管理员获取邀请码，加入后即可共享家庭数据</text>
        <button class="submit-btn" :disabled="submitting" @tap="handleJoin">
          {{ submitting ? '加入中...' : '加入家庭' }}
        </button>
      </view>

      <view v-else class="form-card">
        <view class="form-group">
          <text class="form-label">成员绑定码</text>
          <input
            class="form-input invite-input"
            v-model="bindCode"
            placeholder="请输入6位绑定码"
            placeholder-style="color:#d6d3d1;font-size:28rpx"
            maxlength="6"
            @input="bindCode = bindCode.toUpperCase()"
          />
        </view>
        <text class="form-hint">家庭管理员在成员详情页为你生成绑定码，输入后将关联到该成员档案</text>
        <button class="submit-btn" :disabled="submitting" @tap="handleBind">
          {{ submitting ? '绑定中...' : '绑定成员' }}
        </button>
      </view>
    </template>

    <!-- 已有家庭：信息 + 成员管理 -->
    <template v-else>
      <view class="form-card">
        <view class="family-info">
          <view class="family-name-row">
            <view v-if="!editingFamilyName" class="family-name-display">
              <text class="family-name">{{ familyInfo.familyName }}</text>
              <text v-if="isOwner" class="edit-icon" @tap="startEditFamilyName">✏️</text>
            </view>
            <view v-else class="family-name-edit">
              <input v-model="familyNameInput" class="family-name-input" placeholder="输入家庭名称" placeholder-style="color:#d6d3d1;font-size:28rpx" />
              <button class="save-name-btn" @tap="saveFamilyName">保存</button>
            </view>
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
            <button class="avatar-circle-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
              <avatar-image
                :src="form.avatarUrl"
                :size="112"
                :bg="form.avatarColor"
                :name="form.name || '?'"
                :font-size="44"
              />
            </button>
            <view class="avatar-actions">
              <text class="avatar-hint">点击头像使用微信头像</text>
              <text class="avatar-link" @tap="onChooseAlbum">从相册选择</text>
            </view>
          </view>
          <view class="form-group">
            <text class="form-label">姓名</text>
            <input v-model="form.name" class="form-input" placeholder="例如：爸爸 / 小明" placeholder-style="color:#d6d3d1;font-size:28rpx" />
          </view>
          <view class="form-group">
            <text class="form-label">性别</text>
            <picker :range="genderNames" :value="genderIndex" @change="onGenderChange">
              <view class="picker-value">
                <text :class="{ 'picker-placeholder': !form.gender }">{{ form.gender ? genderNames[genderIndex] : '请选择性别' }}</text>
                <text class="picker-arrow">›</text>
              </view>
            </picker>
          </view>
          <view class="form-group">
            <text class="form-label">家庭关系</text>
            <picker :range="roleNames" :value="roleIndex" @change="onRoleChange">
              <view class="picker-value">
                <text :class="{ 'picker-placeholder': !form.role }">{{ form.role ? roleNames[roleIndex] : '请选择家庭关系' }}</text>
                <text class="picker-arrow">›</text>
              </view>
            </picker>
          </view>
          <view class="form-group">
            <text class="form-label">手机号（选填）</text>
            <input
              v-model="form.mobile"
              class="form-input"
              type="number"
              maxlength="11"
              placeholder="填写后，对方用此手机号登录自动关联"
              placeholder-style="color:#d6d3d1;font-size:28rpx"
            />
          </view>
          <view class="form-group">
            <text class="form-label">出生日期（选填）</text>
            <view class="date-row">
              <view class="date-input-wrapper">
                <input v-model="form.birthYear" class="date-input" type="number" maxlength="4" placeholder="年" placeholder-style="color:#d6d3d1;font-size:28rpx" @blur="onMemberYearBlur" @tap.stop />
                <picker :range="memberYearOptions" :value="memberYearPickerIndex" @change="onMemberYearPickerChange">
                  <text class="date-picker-icon">📅</text>
                </picker>
              </view>
              <view class="date-input-wrapper">
                <input v-model="form.birthMonth" class="date-input" type="number" maxlength="2" placeholder="月" placeholder-style="color:#d6d3d1;font-size:28rpx" @blur="onMemberMonthBlur" @tap.stop />
                <picker :range="memberMonthOptions" :value="memberMonthPickerIndex" @change="onMemberMonthPickerChange">
                  <text class="date-picker-icon">📅</text>
                </picker>
              </view>
              <view class="date-input-wrapper">
                <input v-model="form.birthDay" class="date-input" type="number" maxlength="2" placeholder="日" placeholder-style="color:#d6d3d1;font-size:28rpx" @blur="onMemberDayBlur" @tap.stop />
                <picker :range="memberDayOptions" :value="memberDayPickerIndex" @change="onMemberDayPickerChange">
                  <text class="date-picker-icon">📅</text>
                </picker>
              </view>
            </view>
          </view>
          <view class="form-group">
            <text class="form-label">身高（cm，选填）</text>
            <input v-model="form.heightCm" class="form-input" type="number" placeholder="例如：170" placeholder-style="color:#d6d3d1;font-size:28rpx" />
          </view>
          <view class="form-group">
            <text class="form-label">当前体重（kg，选填）</text>
            <input v-model="form.currentWeightKg" class="form-input" type="digit" placeholder="例如：60" placeholder-style="color:#d6d3d1;font-size:28rpx" />
          </view>
          <view class="form-group">
            <text class="form-label">目标体重（kg，选填）</text>
            <input v-model="form.targetWeightKg" class="form-input" type="digit" placeholder="例如：58" placeholder-style="color:#d6d3d1;font-size:28rpx" />
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
              <view class="member-name-row">
                <text class="member-name">{{ member.name }}</text>
                <text v-if="member.userId" class="bound-tag">已绑定</text>
                <text v-else class="unbound-tag">未绑定</text>
              </view>
              <text class="member-role">{{ MEMBER_ROLES.find((r) => r.value === member.role)?.label }}</text>
            </view>
            <view class="member-actions">
              <button class="btn-sm btn-secondary" @tap.stop="openEdit(member)">编辑</button>
              <button v-if="isOwner" class="btn-sm btn-danger" @tap.stop="removeMember(member)">删除</button>
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
  font-size: 28rpx;
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

  .family-name-display {
    display: flex;
    align-items: center;
    gap: 12rpx;
  }

  .edit-icon {
    font-size: 28rpx;
  }

  .family-name-edit {
    display: flex;
    align-items: center;
    gap: 12rpx;
    flex: 1;
    margin-right: 16rpx;
  }

  .family-name-input {
    flex: 1;
    height: 64rpx;
    background: #faf6f1;
    border-radius: 10rpx;
    padding: 0 16rpx;
    font-size: 30rpx;
    color: #2d2a26;
  }

  .save-name-btn {
    height: 64rpx;
    padding: 0 24rpx !important;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 10rpx;
    background: #f97316;
    color: #fff;
    font-size: 26rpx;
    font-weight: 600;
    line-height: 1;

    &::after {
      border: none;
    }
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
  border: 2rpx solid #f97316;
  border-radius: 16rpx;
  background: #fff;
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

.avatar-circle-btn {
  width: 112rpx;
  height: 112rpx;
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

.avatar-circle-placeholder {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;

  text {
    font-size: 44rpx;
    color: #fff;
    font-weight: 700;
  }
}

.avatar-circle-img {
  width: 112rpx;
  height: 112rpx;
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

.picker-placeholder {
  color: #d6d3d1;
  font-size: 28rpx;
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

.member-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.bound-tag {
  font-size: 18rpx;
  color: #10b981;
  background: #ecfdf5;
  padding: 2rpx 12rpx;
  border-radius: 8rpx;
}

.unbound-tag {
  font-size: 18rpx;
  color: #a8a29e;
  background: #f5f0e8;
  padding: 2rpx 12rpx;
  border-radius: 8rpx;
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
