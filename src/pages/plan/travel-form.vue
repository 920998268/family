<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app';
import { reactive, ref } from 'vue';
import { useTravelStore } from '@/stores/travel';
import { useFamilyStore } from '@/stores/family';
import type { TravelStatus } from '@/types/models';
import { TRAVEL_STATUSES } from '@/types/models';
import type { TravelItemDraft, TravelPlanDraft } from '@/services/TravelService';
import { todayKey } from '@/utils/date';
import { errorMessage } from '@/utils/error';
import MemberMultiSelect from '@/components/MemberMultiSelect.vue';

const travelStore = useTravelStore();
const familyStore = useFamilyStore();

const editingId = ref<string | null>(null);
const statusNames = TRAVEL_STATUSES.map((item) => item.label);
const statusIndex = ref(0);

const form = reactive({
  title: '',
  destination: '',
  startDate: todayKey(),
  endDate: todayKey(),
  budget: 0,
  members: [] as string[],
  note: '',
});

const items = ref<TravelItemDraft[]>([{ time: '', activity: '', note: '', done: false }]);

onLoad((options) => {
  if (options?.id) {
    editingId.value = options.id;
  }
});

onShow(() => {
  travelStore.load();
  familyStore.load();
  if (editingId.value) {
    const plan = travelStore.plans.find((item) => item.id === editingId.value);
    if (plan) {
      form.title = plan.title;
      form.destination = plan.destination;
      form.startDate = plan.startDate;
      form.endDate = plan.endDate;
      form.budget = plan.budget;
      form.members = [...plan.members];
      form.note = plan.note;
      items.value = plan.items.map((item) => ({
        time: item.time,
        activity: item.activity,
        note: item.note,
        done: item.done,
      }));
      statusIndex.value = Math.max(
        TRAVEL_STATUSES.findIndex((item) => item.value === plan.status),
        0,
      );
    }
  }
});

function onStatusChange(event: { detail: { value: string | number } }): void {
  statusIndex.value = Number(event.detail.value);
}

function onStartDateChange(event: { detail: { value: string } }): void {
  form.startDate = event.detail.value;
}

function onEndDateChange(event: { detail: { value: string } }): void {
  form.endDate = event.detail.value;
}

function goBack(): void {
  uni.navigateBack();
}

function addItem(): void {
  items.value.push({ time: '', activity: '', note: '', done: false });
}

function removeItem(index: number): void {
  if (items.value.length === 1) {
    uni.showToast({ title: '至少保留一项', icon: 'none' });
    return;
  }
  items.value.splice(index, 1);
}

function save(): void {
  const normalizedItems = items.value.filter((item) => item.activity.trim());

  if (!form.title.trim()) {
    uni.showToast({ title: '请填写计划标题', icon: 'none' });
    return;
  }
  if (form.startDate > form.endDate) {
    uni.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
    return;
  }

  const draft: TravelPlanDraft = {
    title: form.title.trim(),
    destination: form.destination.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
    budget: Number(form.budget) || 0,
    members: form.members,
    status: TRAVEL_STATUSES[statusIndex.value]?.value as TravelStatus,
    note: form.note.trim(),
    items: normalizedItems.length ? normalizedItems : [],
  };

  try {
    if (editingId.value) {
      travelStore.update(editingId.value, draft);
    } else {
      travelStore.add(draft);
    }
    uni.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => {
      uni.navigateBack();
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
      <view class="section-title">{{ editingId ? '编辑出行计划' : '新建出行计划' }}</view>

      <view class="field field-first">
        <text class="field-label">计划标题</text>
        <input v-model="form.title" class="field-control" placeholder="例如：国庆全家出游" />
      </view>

      <view class="field">
        <text class="field-label">目的地</text>
        <input v-model="form.destination" class="field-control" placeholder="例如：云南大理" />
      </view>

      <view class="field">
        <text class="field-label">开始日期</text>
        <picker mode="date" :value="form.startDate" @change="onStartDateChange">
          <view class="picker-value">
            <text>{{ form.startDate }}</text>
            <text class="picker-arrow">›</text>
          </view>
        </picker>
      </view>

      <view class="field">
        <text class="field-label">结束日期</text>
        <picker mode="date" :value="form.endDate" @change="onEndDateChange">
          <view class="picker-value">
            <text>{{ form.endDate }}</text>
            <text class="picker-arrow">›</text>
          </view>
        </picker>
      </view>

      <view class="field">
        <text class="field-label">预算（元）</text>
        <input v-model.number="form.budget" class="field-control" type="digit" placeholder="例如：5000" />
      </view>

      <view class="field">
        <text class="field-label">参与成员</text>
        <MemberMultiSelect v-model="form.members" />
      </view>

      <view class="field">
        <text class="field-label">计划状态</text>
        <picker :range="statusNames" :value="statusIndex" @change="onStatusChange">
          <view class="picker-value">
            <text>{{ statusNames[statusIndex] }}</text>
            <text class="picker-arrow">›</text>
          </view>
        </picker>
      </view>

      <view class="field">
        <view class="section-header">
          <text class="field-label field-label-inline">行程明细</text>
          <button class="link-button" @tap="addItem">添加一项</button>
        </view>

        <view v-for="(item, index) in items" :key="index" class="record-card set-card">
          <view class="section-header">
            <text class="section-title">第 {{ index + 1 }} 项</text>
            <button class="btn btn-danger btn-sm" @tap="removeItem(index)">删除</button>
          </view>

          <view class="field">
            <text class="field-label">活动内容</text>
            <input v-model="item.activity" class="field-control" placeholder="例如：游览洱海" />
          </view>

          <view class="field">
            <text class="field-label">时间（可选）</text>
            <input v-model="item.time" class="field-control" placeholder="例如：上午 9:00" />
          </view>

          <view class="field">
            <text class="field-label">备注（可选）</text>
            <input v-model="item.note" class="field-control" placeholder="例如：带好相机" />
          </view>
        </view>
      </view>

      <view class="field">
        <text class="field-label">备注（可选）</text>
        <textarea v-model="form.note" class="field-control field-textarea" placeholder="关于本次出行的其他安排" />
      </view>

      <view class="form-actions">
        <button class="btn btn-ghost" @tap="goBack">取消</button>
        <button class="btn btn-primary" @tap="save">保存</button>
      </view>
    </view>
  </view>
</template>
