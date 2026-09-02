<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useProfileStore } from '@/stores/profile';
import { useFamilyStore } from '@/stores/family';
import { MEMBER_ROLE_LABELS } from '@/types/models';
import MemberAvatar from '@/components/MemberAvatar.vue';

const profileStore = useProfileStore();
const familyStore = useFamilyStore();

const profile = computed(() => profileStore.profile);

onShow(() => {
  profileStore.load();
  familyStore.load();
});

function goPage(url: string): void {
  uni.navigateTo({ url });
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">我的</text>
      <text class="page-subtitle">个人信息档案与家庭成员管理</text>
    </view>

    <view class="section">
      <view class="record-card" @tap="goPage('/pages/me/profile')">
        <view class="me-head">
          <view class="avatar-dot" style="background: #f97316">
            <text>{{ (profile?.name || '我').slice(0, 1) }}</text>
          </view>
          <view class="me-head-info">
            <text class="record-title">{{ profile?.name || '未填写姓名' }}</text>
            <text class="record-meta">
              {{
                profile
                  ? `${profile.gender === 'male' ? '男' : profile.gender === 'female' ? '女' : '其他'} · ${profile.heightCm}cm · ${profile.currentWeightKg}kg`
                  : '点击完善个人信息档案'
              }}
            </text>
          </view>
          <text class="checkin-arrow">›</text>
        </view>
      </view>

      <view class="record-card me-card" @tap="goPage('/pages/me/family')">
        <view class="me-head">
          <view>
            <text class="record-title">家庭成员</text>
            <text class="record-meta">共 {{ familyStore.members.length }} 位成员</text>
          </view>
          <view class="me-avatars">
            <MemberAvatar
              v-for="member in familyStore.members.slice(0, 4)"
              :key="member.id"
              :name="member.name"
              :color="member.avatarColor"
              size="sm"
            />
          </view>
          <text class="checkin-arrow">›</text>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-title">身体档案</view>
      <view class="summary-grid">
        <view class="summary-item">
          <text class="summary-label">身高</text>
          <text class="summary-value">{{ profile?.heightCm ?? '--' }} cm</text>
        </view>
        <view class="summary-item">
          <text class="summary-label">当前体重</text>
          <text class="summary-value">{{ profile?.currentWeightKg ?? '--' }} kg</text>
        </view>
        <view class="summary-item">
          <text class="summary-label">目标体重</text>
          <text class="summary-value">{{ profile?.targetWeightKg ?? '--' }} kg</text>
        </view>
        <view class="summary-item">
          <text class="summary-label">出生年月</text>
          <text class="summary-value">{{ profile?.birthDate?.slice(0, 7) ?? '--' }}</text>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-title">家庭成员</view>
      <view class="record-list">
        <view
          v-for="member in familyStore.members"
          :key="member.id"
          class="record-card me-member"
          @tap="goPage('/pages/me/family')"
        >
          <MemberAvatar :name="member.name" :color="member.avatarColor" />
          <text class="member-row-name">{{ member.name }}</text>
          <text class="member-row-role">{{ MEMBER_ROLE_LABELS[member.role] }}</text>
        </view>
        <view v-if="familyStore.members.length === 0" class="empty" @tap="goPage('/pages/me/family')">
          还没有家庭成员，点击添加
        </view>
      </view>
    </view>

    <view class="section">
      <view class="record-card me-card" @tap="goPage('/pages/backup/backup')">
        <view class="me-head">
          <view>
            <text class="record-title">数据备份</text>
            <text class="record-meta">导出与导入本地 JSON 备份</text>
          </view>
          <text class="checkin-arrow">›</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.me-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.me-head-info {
  flex: 1;
}

.me-card {
  margin-top: 20rpx;
}

.me-avatars {
  display: flex;
  gap: 8rpx;
}

.me-member {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.checkin-arrow {
  color: #c9c2ba;
  font-size: 40rpx;
}
</style>
