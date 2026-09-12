<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { DietEntry, FavoriteFood, MealType } from '@/types/models';
import { MEAL_TYPES } from '@/types/models';
import type { DietDraft } from '@/services/DietService';
import { useFavoriteFoodStore } from '@/stores/favoriteFood';
import { favoriteFoodText } from '@/utils/format';
import { DIET_LIMITS } from '@/utils/limits';

const props = defineProps<{
  date: string;
  entry?: DietEntry | null;
}>();

const emit = defineEmits<{
  save: [draft: DietDraft];
  cancel: [];
}>();

const favoriteStore = useFavoriteFoodStore();

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

const favoritesVisible = ref(false);

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
  favoritesVisible.value = false;
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

/** 展开 / 收起常用食物列表；展开时按需拉取（不预加载，避免每次打开表单都打网络） */
function toggleFavorites(): void {
  favoritesVisible.value = !favoritesVisible.value;
  if (favoritesVisible.value) {
    void favoriteStore.load();
  }
}

/** 一键带出：名称 / 数量 / 营养值一起填上，用户只需确认 */
function applyFavorite(food: FavoriteFood): void {
  form.foodName = food.name;
  form.quantity = food.quantity;
  form.calories = food.calories;
  form.protein = food.protein;
  form.carbs = food.carbs;
  form.fat = food.fat;
  favoritesVisible.value = false;
}

async function removeFavorite(food: FavoriteFood): Promise<void> {
  try {
    await favoriteStore.remove(food.name);
  } catch (error) {
    uni.showToast({ title: '删除失败', icon: 'none' });
  }
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

    <view class="field field-first">
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
      <view class="section-header">
        <text class="field-label field-label-inline">食物名称</text>
        <button class="link-button" @tap="toggleFavorites">
          {{ favoritesVisible ? '收起' : '常用' }}
        </button>
      </view>
      <input
        v-model="form.foodName"
        class="field-control"
        :maxlength="DIET_LIMITS.foodName"
        placeholder="例如：鸡胸肉"
      />

      <view v-if="favoritesVisible" class="favorite-panel">
        <text v-if="favoriteStore.loading" class="empty">加载中…</text>
        <text v-else-if="favoriteStore.foods.length === 0" class="empty">
          还没有常用食物，打卡后会自动沉淀
        </text>
        <view v-else class="record-list">
          <view
            v-for="food in favoriteStore.foods"
            :key="food.id"
            class="record-card favorite-card"
            @tap="applyFavorite(food)"
          >
            <view class="section-header">
              <text class="record-title">{{ food.name }}</text>
              <text class="favorite-count">用过 {{ food.useCount }} 次</text>
            </view>
            <text v-if="favoriteFoodText(food)" class="record-meta">
              {{ favoriteFoodText(food) }}
            </text>
            <view class="record-actions">
              <button class="btn btn-danger btn-sm" @tap.stop="removeFavorite(food)">
                删除
              </button>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view class="field">
      <text class="field-label">数量或份量</text>
      <input
        v-model="form.quantity"
        class="field-control"
        :maxlength="DIET_LIMITS.quantity"
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

<style scoped lang="scss">
.favorite-panel {
  margin-top: 14rpx;
}

.favorite-card {
  padding: 16rpx 20rpx;
}

.favorite-count {
  color: $uni-text-color-grey;
  font-size: 22rpx;
}

.favorite-card .record-actions {
  margin-top: 10rpx;
}
</style>
