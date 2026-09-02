<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useFamilyStore } from '@/stores/family';
import type { FamilyMember, MemberRole } from '@/types/models';
import { AVATAR_COLORS, MEMBER_ROLES } from '@/types/models';
import type { FamilyMemberDraft } from '@/services/FamilyService';
import { errorMessage } from '@/utils/error';
import MemberAvatar from '@/components/MemberAvatar.vue';

const familyStore = useFamilyStore();

const formVisible = ref(false);
const editingMember = ref<FamilyMember | null>(null);

const form = reactive({
  name: '',
  role: 'parent' as MemberRole,
  avatarColor: AVATAR_COLORS[0],
});

const roleNames = MEMBER_ROLES.map((item) => item.label);
const roleIndex = computed(() =>
  Math.max(MEMBER_ROLES.findIndex((item) => item.value === form.role), 0),
);

onShow(() => {
  familyStore.load();
});

function resetForm(): void {
  form.name = editingMember.value?.name ?? '';
  form.role = editingMember.value?.role ?? 'parent';
  form.avatarColor = editingMember.value?.avatarColor ?? AVATAR_COLORS[0];
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

function save(): void {
  const draft: FamilyMemberDraft = {
    name: form.name.trim(),
    role: form.role,
    avatarColor: form.avatarColor,
  };
  if (!draft.name) {
    uni.showToast({ title: '请填写成员姓名', icon: 'none' });
    return;
  }

  try {
    if (editingMember.value) {
      familyStore.update(editingMember.value.id, draft);
    } else {
      familyStore.add(draft);
    }
    uni.showToast({ title: '已保存', icon: 'success' });
    closeForm();
  } catch (error) {
    uni.showModal({
      title: '保存失败',
      content: errorMessage(error, '请检查填写内容'),
      showCancel: false,
    });
  }
}

function remove(member: FamilyMember): void {
  uni.showModal({
    title: '删除家庭成员',
    content: `确定删除「${member.name}」吗？`,
    success: (result) => {
      if (!result.confirm) {
        return;
      }
      try {
        familyStore.remove(member.id);
        uni.showToast({ title: '已删除', icon: 'success' });
      } catch (error) {
        uni.showToast({ title: errorMessage(error), icon: 'none' });
      }
    },
  });
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">家庭成员</text>
      <text class="page-subtitle">维护全家成员，打卡与记账时可关联到具体成员</text>
    </view>

    <view class="section">
      <button class="btn btn-primary btn-block" @tap="openAdd">添加家庭成员</button>
    </view>

    <view v-if="formVisible" class="section">
      <view class="form-card">
        <view class="section-title">{{ editingMember ? '编辑家庭成员' : '添加家庭成员' }}</view>

        <view class="field field-first">
          <text class="field-label">姓名</text>
          <input v-model="form.name" class="field-control" placeholder="例如：爸爸 / 小明" />
        </view>

        <view class="field">
          <text class="field-label">角色</text>
          <picker :range="roleNames" :value="roleIndex" @change="onRoleChange">
            <view class="picker-value">
              <text>{{ roleNames[roleIndex] }}</text>
              <text class="picker-arrow">›</text>
            </view>
          </picker>
        </view>

        <view class="field">
          <text class="field-label">头像颜色</text>
          <view class="color-row">
            <view
              v-for="color in AVATAR_COLORS"
              :key="color"
              class="color-dot"
              :class="form.avatarColor === color ? 'color-dot-active' : ''"
              :style="{ background: color }"
              @tap="form.avatarColor = color"
            />
          </view>
        </view>

        <view class="form-actions">
          <button class="btn btn-ghost" @tap="closeForm">取消</button>
          <button class="btn btn-primary" @tap="save">保存</button>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="record-list">
        <view v-for="member in familyStore.members" :key="member.id" class="record-card member-card">
          <MemberAvatar :name="member.name" :color="member.avatarColor" />
          <view class="member-info">
            <text class="record-title">{{ member.name }}</text>
            <text class="record-meta">
              {{ MEMBER_ROLES.find((item) => item.value === member.role)?.label }}
            </text>
          </view>
          <view class="record-actions member-actions">
            <button class="btn btn-secondary btn-sm" @tap="openEdit(member)">编辑</button>
            <button class="btn btn-danger btn-sm" @tap="remove(member)">删除</button>
          </view>
        </view>
        <view v-if="familyStore.members.length === 0" class="empty">
          还没有家庭成员，点击上方按钮添加
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.member-card {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.member-info {
  flex: 1;
}

.member-actions {
  margin-top: 0;
}

.color-row {
  display: flex;
  gap: 18rpx;
}

.color-dot {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 4rpx solid transparent;
}

.color-dot-active {
  border-color: $uni-text-color;
}
</style>
