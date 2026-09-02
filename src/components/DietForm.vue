<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type { DietEntry, MealType } from '@/types/models';
import { MEAL_TYPES } from '@/types/models';
import type { DietDraft } from '@/services/DietService';

const props = defineProps<{
  date: string;
  entry?: DietEntry | null;
}>();

const emit = defineEmits<{
  save: [draft: DietDraft];
  cancel: [];
}>();

const mealNames = MEAL_TYPES.map((item) => item.label);

const form = reactive<DietDraft>({
  mealType: 'breakfast',
  foodName: '',
  quantity: '',
  calories: undefined,
  protein: undefined,
  carbs: undefined,
  fat: undefined,
});

const mealIndex = computed(() => {
  const index = MEAL_TYPES.findIndex((item) => item.value === form.mealType);
  return Math.max(index, 0);
});

function resetForm(): void {
  const entry = props.entry;
  form.mealType = entry?.mealType ?? 'breakfast';
  form.foodName = entry?.foodName ?? '';
  form.quantity = entry?.quantity ?? '';
  form.calories = entry?.calories;
  form.protein = entry?.protein;
  form.carbs = entry?.carbs;
  form.fat = entry?.fat;
}

watch(
  () => props.entry,
  () => resetForm(),
  { immediate: true },
);

function onMealChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  form.mealType = (MEAL_TYPES[index]?.value ?? 'breakfast') as MealType;
}

function submit(): void {
  if (!form.foodName.trim() || !form.quantity.trim()) {
    uni.showToast({ title: '请填写食物名称和数量', icon: 'none' });
    return;
  }

  emit('save', {
    mealType: form.mealType,
    foodName: form.foodName.trim(),
    quantity: form.quantity.trim(),
    calories: toOptionalNumber(form.calories),
    protein: toOptionalNumber(form.protein),
    carbs: toOptionalNumber(form.carbs),
    fat: toOptionalNumber(form.fat),
  });
}

function toOptionalNumber(value: number | undefined): number | undefined {
  if (value === undefined || Number.isNaN(value)) {
    return undefined;
  }
  return value;
}
</script>

<template>
  <view class="form-card">
    <view class="section-title">
      {{ entry ? '编辑饮食记录' : '新增饮食记录' }}
    </view>

    <view class="field" style="margin-top: 24rpx">
      <text class="field-label">日期</text>
      <text class="field-control">{{ date }}</text>
    </view>

    <view class="field">
      <text class="field-label">餐次</text>
      <picker
        :range="mealNames"
        :value="mealIndex"
        @change="onMealChange"
      >
        <view class="picker-value">
          <text>{{ mealNames[mealIndex] }}</text>
          <text class="picker-arrow">›</text>
        </view>
      </picker>
    </view>

    <view class="field">
      <text class="field-label">食物名称</text>
      <input
        v-model="form.foodName"
        class="field-control"
        placeholder="例如：鸡胸肉"
      />
    </view>

    <view class="field">
      <text class="field-label">数量或份量</text>
      <input
        v-model="form.quantity"
        class="field-control"
        placeholder="例如：200g / 1碗"
      />
    </view>

    <view class="field">
      <text class="field-label">热量（千卡，可选）</text>
      <input
        v-model.number="form.calories"
        class="field-control"
        type="number"
        placeholder="可不填"
      />
    </view>

    <view class="field">
      <text class="field-label">蛋白质（克，可选）</text>
      <input
        v-model.number="form.protein"
        class="field-control"
        type="number"
        placeholder="可不填"
      />
    </view>

    <view class="field">
      <text class="field-label">碳水化合物（克，可选）</text>
      <input
        v-model.number="form.carbs"
        class="field-control"
        type="number"
        placeholder="可不填"
      />
    </view>

    <view class="field">
      <text class="field-label">脂肪（克，可选）</text>
      <input
        v-model.number="form.fat"
        class="field-control"
        type="number"
        placeholder="可不填"
      />
    </view>

    <view class="form-actions">
      <button class="btn btn-ghost" @tap="emit('cancel')">取消</button>
      <button class="btn btn-primary" @tap="submit">保存</button>
    </view>
  </view>
</template>

