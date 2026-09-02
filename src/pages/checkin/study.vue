<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useStudyStore } from '@/stores/study';
import { useFamilyStore } from '@/stores/family';
import type { StudyFrequency, StudyPlan } from '@/types/models';
import { STUDY_FREQUENCIES, STUDY_FREQUENCY_LABELS } from '@/types/models';
import type { StudyPlanDraft } from '@/services/StudyService';
import { formatDateKey, todayKey } from '@/utils/date';
import { errorMessage } from '@/utils/error';
import MemberSelect from '@/components/MemberSelect.vue';

const studyStore = useStudyStore();
const familyStore = useFamilyStore();

const date = ref(todayKey());
const formVisible = ref(false);
const editingPlan = ref<StudyPlan | null>(null);

const form = reactive({
  title: '',
  subject: '',
  frequency: 'daily' as StudyFrequency,
  targetTimes: 1,
  memberId: undefined as string | undefined,
});

const frequencyNames = STUDY_FREQUENCIES.map((item) => item.label);
const frequencyIndex = computed(() =>
  Math.max(
    STUDY_FREQUENCIES.findIndex((item) => item.value === form.frequency),
    0,
  ),
);

const doneCount = computed(() => studyStore.checkins.length);
const totalCount = computed(() => studyStore.plans.length);

onShow(() => {
  studyStore.loadPlans();
  studyStore.loadCheckins(date.value);
  familyStore.load();
});

function resetForm(): void {
  form.title = editingPlan.value?.title ?? '';
  form.subject = editingPlan.value?.subject ?? '';
  form.frequency = editingPlan.value?.frequency ?? 'daily';
  form.targetTimes = editingPlan.value?.targetTimes ?? 1;
  form.memberId = editingPlan.value?.memberId;
}

function openAdd(): void {
  editingPlan.value = null;
  resetForm();
  formVisible.value = true;
}

function openEdit(plan: StudyPlan): void {
  editingPlan.value = plan;
  resetForm();
  formVisible.value = true;
}

function closeForm(): void {
  formVisible.value = false;
  editingPlan.value = null;
}

function onFrequencyChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  form.frequency = (STUDY_FREQUENCIES[index]?.value ?? 'daily') as StudyFrequency;
}

function savePlan(): void {
  const draft: StudyPlanDraft = {
    title: form.title.trim(),
    subject: form.subject.trim(),
    frequency: form.frequency,
    targetTimes: Number(form.targetTimes) || 1,
    memberId: form.memberId,
  };
  if (!draft.title) {
    uni.showToast({ title: '请填写计划标题', icon: 'none' });
    return;
  }
  if (!draft.subject) {
    uni.showToast({ title: '请填写学习内容', icon: 'none' });
    return;
  }

  try {
    if (editingPlan.value) {
      studyStore.updatePlan(editingPlan.value.id, draft);
    } else {
      studyStore.addPlan(draft);
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

function removePlan(plan: StudyPlan): void {
  uni.showModal({
    title: '删除学习计划',
    content: `确定删除「${plan.title}」吗？其历史打卡记录也会一并删除。`,
    success: (result) => {
      if (!result.confirm) {
        return;
      }
      try {
        studyStore.removePlan(plan.id);
        uni.showToast({ title: '已删除', icon: 'success' });
      } catch (error) {
        uni.showModal({
          title: '删除失败',
          content: errorMessage(error),
          showCancel: false,
        });
      }
    },
  });
}

function doCheckin(plan: StudyPlan): void {
  if (studyStore.hasChecked(plan.id)) {
    const checkin = studyStore.checkins.find((item) => item.planId === plan.id);
    if (checkin) {
      studyStore.removeCheckin(date.value, checkin.id);
    }
    uni.showToast({ title: '已取消打卡', icon: 'none' });
    return;
  }

  try {
    studyStore.checkin(date.value, {
      planId: plan.id,
      note: '',
      memberId: plan.memberId,
    });
    uni.showToast({ title: '打卡成功', icon: 'success' });
  } catch (error) {
    uni.showModal({
      title: '打卡失败',
      content: errorMessage(error, '请检查填写内容'),
      showCancel: false,
    });
  }
}

function memberName(memberId: string | undefined): string {
  return familyStore.nameOf(memberId);
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">学习打卡</text>
      <text class="page-subtitle">{{ formatDateKey(date) }} · 今日完成 {{ doneCount }}/{{ totalCount }}</text>
    </view>

    <view class="section">
      <button class="btn btn-primary btn-block" @tap="openAdd">新建学习计划</button>
    </view>

    <view v-if="formVisible" class="section">
      <view class="form-card">
        <view class="section-title">{{ editingPlan ? '编辑学习计划' : '新建学习计划' }}</view>

        <view class="field field-first">
          <text class="field-label">计划标题</text>
          <input v-model="form.title" class="field-control" placeholder="例如：每天背单词" />
        </view>

        <view class="field">
          <text class="field-label">学习内容 / 学科</text>
          <input v-model="form.subject" class="field-control" placeholder="例如：英语" />
        </view>

        <view class="field">
          <text class="field-label">打卡频率</text>
          <picker :range="frequencyNames" :value="frequencyIndex" @change="onFrequencyChange">
            <view class="picker-value">
              <text>{{ frequencyNames[frequencyIndex] }}</text>
              <text class="picker-arrow">›</text>
            </view>
          </picker>
        </view>

        <view class="field">
          <text class="field-label">目标次数（次/周期）</text>
          <input v-model.number="form.targetTimes" class="field-control" type="number" placeholder="例如：5" />
        </view>

        <view class="field">
          <text class="field-label">归属成员（可选）</text>
          <MemberSelect v-model="form.memberId" />
        </view>

        <view class="form-actions">
          <button class="btn btn-ghost" @tap="closeForm">取消</button>
          <button class="btn btn-primary" @tap="savePlan">保存</button>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">学习计划</text>
        <text class="page-subtitle page-subtitle-tight">{{ studyStore.plans.length }} 个</text>
      </view>

      <view v-if="studyStore.plans.length" class="record-list">
        <view
          v-for="plan in studyStore.plans"
          :key="plan.id"
          class="record-card"
          :class="{ 'done-item': studyStore.hasChecked(plan.id) }"
        >
          <view class="study-head">
            <view class="study-info">
              <text class="record-title">{{ plan.title }}</text>
              <text class="record-meta">
                {{ plan.subject }} · {{ STUDY_FREQUENCY_LABELS[plan.frequency] }} {{ plan.targetTimes }} 次
              </text>
              <text v-if="memberName(plan.memberId)" class="record-meta">
                成员：{{ memberName(plan.memberId) }}
              </text>
            </view>
            <view
              class="study-check"
              :class="studyStore.hasChecked(plan.id) ? 'study-check-done' : ''"
              @tap="doCheckin(plan)"
            >
              <text>{{ studyStore.hasChecked(plan.id) ? '✓ 已打卡' : '打卡' }}</text>
            </view>
          </view>

          <view class="record-actions">
            <button class="btn btn-secondary" @tap="openEdit(plan)">编辑</button>
            <button class="btn btn-danger" @tap="removePlan(plan)">删除</button>
          </view>
        </view>
      </view>
      <view v-else class="empty">还没有学习计划，先新建一个吧</view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.study-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.study-info {
  flex: 1;
}

.study-check {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 132rpx;
  min-height: 60rpx;
  padding: 0 20rpx;
  border-radius: 999rpx;
  color: $uni-color-primary;
  background: $uni-color-primary-light;
  font-size: 26rpx;
  font-weight: 700;
}

.study-check-done {
  color: #ffffff;
  background: $uni-color-success;
}
</style>
