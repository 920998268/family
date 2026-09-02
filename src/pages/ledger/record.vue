<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { useLedgerStore } from '@/stores/ledger';
import { useFamilyStore } from '@/stores/family';
import type { TransactionType } from '@/types/models';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types/models';
import type { TransactionDraft } from '@/services/LedgerService';
import { isValidDateKey, todayKey } from '@/utils/date';
import { errorMessage } from '@/utils/error';
import MemberSelect from '@/components/MemberSelect.vue';

const ledgerStore = useLedgerStore();
const familyStore = useFamilyStore();

const editingId = ref<string | null>(null);
const date = ref(todayKey());
const memberId = ref<string | undefined>(undefined);

const form = reactive({
  type: 'expense' as TransactionType,
  amount: 0,
  category: EXPENSE_CATEGORIES[0],
  note: '',
});

const categories = computed(() =>
  form.type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES,
);

const categoryIndex = computed(() => {
  const index = categories.value.findIndex((item) => item === form.category);
  return Math.max(index, 0);
});

onLoad((options) => {
  if (options?.id && typeof options.id === 'string') {
    editingId.value = options.id;
  }
  if (options?.date && typeof options.date === 'string' && isValidDateKey(options.date)) {
    date.value = options.date;
  }
});

onShow(() => {
  familyStore.load();
  if (editingId.value) {
    ledgerStore.loadAll();
    const entry = ledgerStore.entries.find((item) => item.id === editingId.value);
    if (entry) {
      date.value = entry.date;
      form.type = entry.type;
      form.amount = entry.amount;
      form.category = entry.category;
      form.note = entry.note;
      memberId.value = entry.memberId;
    }
  } else {
    ledgerStore.load(date.value);
  }
});

function setType(type: TransactionType): void {
  form.type = type;
  form.category = (type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES)[0];
}

function onCategoryChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value);
  form.category = categories.value[index] ?? categories.value[0];
}

function onDateChange(event: { detail: { value: string } }): void {
  date.value = event.detail.value;
}

function goBack(): void {
  uni.navigateBack();
}

function remove(): void {
  const id = editingId.value;
  if (!id) {
    return;
  }
  uni.showModal({
    title: '删除收支记录',
    content: '确定删除这笔记录吗？',
    success: (result) => {
      if (!result.confirm) {
        return;
      }
      try {
        ledgerStore.remove(date.value, id);
        uni.showToast({ title: '已删除', icon: 'success' });
        setTimeout(() => {
          uni.navigateBack();
        }, 400);
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

function save(): void {
  const amount = Number(form.amount);
  if (!amount || amount <= 0) {
    uni.showToast({ title: '请填写有效金额', icon: 'none' });
    return;
  }

  const draft: TransactionDraft = {
    type: form.type,
    amount,
    category: form.category,
    memberId: memberId.value,
    note: form.note.trim(),
  };

  try {
    if (editingId.value) {
      ledgerStore.update(date.value, editingId.value, draft);
    } else {
      ledgerStore.add(date.value, draft);
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
      <view class="section-title">{{ editingId ? '编辑收支记录' : '记一笔' }}</view>

      <view class="field field-first">
        <view class="seg-control">
          <view
            class="seg-item"
            :class="form.type === 'expense' ? 'seg-item-active' : ''"
            @tap="setType('expense')"
          >
            <text>支出</text>
          </view>
          <view
            class="seg-item"
            :class="form.type === 'income' ? 'seg-item-active' : ''"
            @tap="setType('income')"
          >
            <text>收入</text>
          </view>
        </view>
      </view>

      <view class="field">
        <text class="field-label">金额（元）</text>
        <input v-model.number="form.amount" class="field-control" type="digit" placeholder="例如：58.50" />
      </view>

      <view class="field">
        <text class="field-label">分类</text>
        <picker :range="categories" :value="categoryIndex" @change="onCategoryChange">
          <view class="picker-value">
            <text>{{ categories[categoryIndex] }}</text>
            <text class="picker-arrow">›</text>
          </view>
        </picker>
      </view>

      <view class="field">
        <text class="field-label">日期</text>
        <picker mode="date" :value="date" @change="onDateChange">
          <view class="picker-value">
            <text>{{ date }}</text>
            <text class="picker-arrow">›</text>
          </view>
        </picker>
      </view>

      <view class="field">
        <text class="field-label">记账成员（可选）</text>
        <MemberSelect v-model="memberId" />
      </view>

      <view class="field">
        <text class="field-label">备注（可选）</text>
        <input v-model="form.note" class="field-control" placeholder="例如：超市买菜" />
      </view>

      <view class="form-actions">
        <button v-if="editingId" class="btn btn-danger" @tap="remove">删除</button>
        <button class="btn btn-ghost" @tap="goBack">取消</button>
        <button class="btn btn-primary" @tap="save">保存</button>
      </view>
    </view>
  </view>
</template>
