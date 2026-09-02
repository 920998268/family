<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useMealStore } from '@/stores/meal';
import type { MealPlan, MealType } from '@/types/models';
import { MEAL_TYPES } from '@/types/models';
import type { MealPlanDraft } from '@/services/MealService';
import { formatDateKey, isValidDateKey, todayKey } from '@/utils/date';
import { errorMessage } from '@/utils/error';

const mealStore = useMealStore();

const date = ref(todayKey());
const formVisible = ref(false);
const editingPlan = ref<MealPlan | null>(null);

const form = reactive({
  slot: 'breakfast' as MealType,
  dishName: '',
  ingredients: '',
  cook: '',
  note: '',
});

const slotNames = MEAL_TYPES.map((item) => item.label);
const slotIndex = computed(() =>
  Math.max(MEAL_TYPES.findIndex((item) => item.value === form.slot), 0),
);

const doneCount = computed(() => mealStore.plans.filter((plan) => plan.done).length);
const totalCount = computed(() => mealStore.plans.length);

const grouped = computed(() => {
  const map = new Map<MealType, MealPlan[]>();
  for (const plan of mealStore.plans) {
    const group = map.get(plan.slot) ?? [];
    group.push(plan);
    map.set(plan.slot, group);
  }
  return MEAL_TYPES.map((slot) => ({
    slot,
    plans: map.get(slot.value) ?? [],
  }));
});

onShow(() => {
  const current = todayKey();
  if (!isValidDateKey(date.value)) {
    date.value = current;
  }
  mealStore.load(date.value);
});

function onDateChange(event: { detail: { value: string } }): void {
  date.value = event.detail.value;
  mealStore.load(date.value);
}

function resetForm(): void {
  form.slot = editingPlan.value?.slot ?? 'breakfast';
  form.dishName = editingPlan.value?.dishName ?? '';
  form.ingredients = editingPlan.value?.ingredients ?? '';
  form.cook = editingPlan.value?.cook ?? '';
  form.note = editingPlan.value?.note ?? '';
}

function openAdd(slot?: MealType): void {
  editingPlan.value = null;
  resetForm();
  if (slot) {
    form.slot = slot;
  }
  formVisible.value = true;
}

function openEdit(plan: MealPlan): void {
  editingPlan.value = plan;
  resetForm();
  formVisible.value = true;
}

function closeForm(): void {
  formVisible.value = false;
  editingPlan.value = null;
}

function onSlotChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  form.slot = (MEAL_TYPES[index]?.value ?? 'breakfast') as MealType;
}

function savePlan(): void {
  const draft: MealPlanDraft = {
    slot: form.slot,
    dishName: form.dishName.trim(),
    ingredients: form.ingredients.trim(),
    cook: form.cook.trim(),
    done: editingPlan.value?.done ?? false,
    note: form.note.trim(),
  };
  if (!draft.dishName) {
    uni.showToast({ title: '请填写菜品名称', icon: 'none' });
    return;
  }

  try {
    if (editingPlan.value) {
      mealStore.update(date.value, editingPlan.value.id, draft);
    } else {
      mealStore.add(date.value, draft);
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

function toggleDone(plan: MealPlan): void {
  mealStore.update(date.value, plan.id, { done: !plan.done });
}

function removePlan(plan: MealPlan): void {
  uni.showModal({
    title: '删除食谱计划',
    content: `确定删除「${plan.dishName}」吗？`,
    success: (result) => {
      if (!result.confirm) {
        return;
      }
      try {
        mealStore.remove(date.value, plan.id);
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
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">家庭食谱</text>
      <picker mode="date" :value="date" @change="onDateChange">
        <view class="picker-value picker-value-plain page-subtitle page-subtitle-spaced">
          <text>{{ formatDateKey(date) }} · 执行 {{ doneCount }}/{{ totalCount }}</text>
          <text class="picker-arrow">›</text>
        </view>
      </picker>
    </view>

    <view class="section">
      <button class="btn btn-primary btn-block" @tap="openAdd()">新增食谱计划</button>
    </view>

    <view v-if="formVisible" class="section">
      <view class="form-card">
        <view class="section-title">{{ editingPlan ? '编辑食谱计划' : '新增食谱计划' }}</view>

        <view class="field field-first">
          <text class="field-label">餐次</text>
          <picker :range="slotNames" :value="slotIndex" @change="onSlotChange">
            <view class="picker-value">
              <text>{{ slotNames[slotIndex] }}</text>
              <text class="picker-arrow">›</text>
            </view>
          </picker>
        </view>

        <view class="field">
          <text class="field-label">菜品名称</text>
          <input v-model="form.dishName" class="field-control" placeholder="例如：西红柿炒蛋" />
        </view>

        <view class="field">
          <text class="field-label">食材用料</text>
          <input v-model="form.ingredients" class="field-control" placeholder="例如：西红柿2个、鸡蛋3个" />
        </view>

        <view class="field">
          <text class="field-label">掌勺人</text>
          <input v-model="form.cook" class="field-control" placeholder="例如：妈妈" />
        </view>

        <view class="field">
          <text class="field-label">备注（可选）</text>
          <textarea v-model="form.note" class="field-control field-textarea" placeholder="例如：少盐" />
        </view>

        <view class="form-actions">
          <button class="btn btn-ghost" @tap="closeForm">取消</button>
          <button class="btn btn-primary" @tap="savePlan">保存</button>
        </view>
      </view>
    </view>

    <view class="section">
      <view v-if="mealStore.plans.length" class="meal-slots">
        <view v-for="group in grouped" :key="group.slot.value" class="meal-slot">
          <view class="section-header">
            <text class="section-title">{{ group.slot.label }}</text>
            <text class="page-subtitle page-subtitle-tight">
              {{ group.plans.filter((plan) => plan.done).length }}/{{ group.plans.length }}
            </text>
          </view>
          <view class="record-list">
            <view
              v-for="plan in group.plans"
              :key="plan.id"
              class="record-card"
              :class="{ 'done-item': plan.done }"
              @tap="toggleDone(plan)"
            >
              <view class="meal-head">
                <view class="meal-dish">
                  <text class="record-title" :class="{ 'done-strike': plan.done }">
                    {{ plan.dishName }}
                  </text>
                  <text v-if="plan.ingredients" class="record-meta">食材：{{ plan.ingredients }}</text>
                  <text v-if="plan.cook" class="record-meta">掌勺：{{ plan.cook }}</text>
                  <text v-if="plan.note" class="record-meta">备注：{{ plan.note }}</text>
                </view>
                <view class="meal-status" :class="plan.done ? 'meal-status-done' : ''">
                  <text>{{ plan.done ? '✓ 已执行' : '待执行' }}</text>
                </view>
              </view>

              <view class="record-actions" @tap.stop>
                <button class="btn btn-secondary" @tap="openEdit(plan)">编辑</button>
                <button class="btn btn-danger" @tap="removePlan(plan)">删除</button>
              </view>
            </view>
          </view>
          <button class="btn btn-ghost meal-add" @tap="openAdd(group.slot.value)">+ 添加{{ group.slot.label }}</button>
        </view>
      </view>
      <view v-else class="empty">这一天还没有食谱计划</view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.meal-slot {
  margin-bottom: 32rpx;
}

.meal-head {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.meal-dish {
  flex: 1;
}

.meal-status {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 116rpx;
  min-height: 52rpx;
  padding: 0 16rpx;
  border-radius: 999rpx;
  color: $uni-text-color-grey;
  background: #f0eeeb;
  font-size: 22rpx;
  font-weight: 600;
}

.meal-status-done {
  color: #ffffff;
  background: $uni-color-success;
}

.meal-add {
  margin-top: 16rpx;
  width: 100%;
}
</style>
