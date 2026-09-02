<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useLedgerStore } from '@/stores/ledger';
import { useFamilyStore } from '@/stores/family';
import { summarize } from '@/services/LedgerService';
import { formatDateKey, todayKey } from '@/utils/date';
import { formatMoney } from '@/utils/format';
import type { Transaction } from '@/types/models';

type TypeFilter = 'all' | 'income' | 'expense';

const ledgerStore = useLedgerStore();
const familyStore = useFamilyStore();

const filter = ref<TypeFilter>('all');
const activeMonth = ref(todayKey().slice(0, 7));

const allEntries = computed(() => ledgerStore.entries);
const filteredEntries = computed(() => {
  let list = allEntries.value.filter((entry) =>
    entry.date.startsWith(activeMonth.value),
  );
  if (filter.value !== 'all') {
    list = list.filter((entry) => entry.type === filter.value);
  }
  return list.sort((a, b) => b.date.localeCompare(a.date));
});

const summary = computed(() => summarize(filteredEntries.value));

const grouped = computed(() => {
  const map = new Map<string, Transaction[]>();
  for (const entry of filteredEntries.value) {
    const group = map.get(entry.date) ?? [];
    group.push(entry);
    map.set(entry.date, group);
  }
  return Array.from(map.entries());
});

onShow(() => {
  ledgerStore.loadAll();
  familyStore.load();
});

function setFilter(value: TypeFilter): void {
  filter.value = value;
}

function memberName(entry: Transaction): string {
  return familyStore.nameOf(entry.memberId);
}

function goRecord(): void {
  uni.navigateTo({ url: '/pages/ledger/record' });
}

function editEntry(entry: Transaction): void {
  uni.navigateTo({ url: `/pages/ledger/record?id=${entry.id}&date=${entry.date}` });
}
</script>

<template>
  <view class="page-shell">
    <view>
      <text class="page-title">家庭账本</text>
      <text class="page-subtitle">{{ activeMonth }} · 记录全家每一笔收支</text>
    </view>

    <view class="section ledger-summary">
      <view class="stat-card">
        <text class="stat-value">{{ formatMoney(summary.balance) }}</text>
        <text class="stat-label">本月结余</text>
      </view>
      <view class="summary-grid">
        <view class="summary-item">
          <text class="summary-label">收入</text>
          <text class="summary-value txn-income">{{ formatMoney(summary.income) }}</text>
        </view>
        <view class="summary-item">
          <text class="summary-label">支出</text>
          <text class="summary-value txn-expense">{{ formatMoney(summary.expense) }}</text>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="seg-control">
        <view
          class="seg-item"
          :class="filter === 'all' ? 'seg-item-active' : ''"
          @tap="setFilter('all')"
        >
          <text>全部</text>
        </view>
        <view
          class="seg-item"
          :class="filter === 'income' ? 'seg-item-active' : ''"
          @tap="setFilter('income')"
        >
          <text>收入</text>
        </view>
        <view
          class="seg-item"
          :class="filter === 'expense' ? 'seg-item-active' : ''"
          @tap="setFilter('expense')"
        >
          <text>支出</text>
        </view>
      </view>
    </view>

    <view class="section">
      <view v-if="grouped.length" class="record-card">
        <view v-for="(group, index) in grouped" :key="group[0]">
          <view v-if="index > 0" class="divider" />
          <view class="txn-date">{{ formatDateKey(group[0]) }}</view>
          <view
            v-for="entry in group[1]"
            :key="entry.id"
            class="txn-row"
            @tap="editEntry(entry)"
          >
            <view class="txn-category">
              <text class="txn-category-name">{{ entry.category }}</text>
              <text class="txn-category-meta">
                {{ memberName(entry) || '家庭' }}{{ entry.note ? ` · ${entry.note}` : '' }}
              </text>
            </view>
            <text class="txn-amount" :class="entry.type === 'income' ? 'txn-income' : 'txn-expense'">
              {{ entry.type === 'income' ? '+' : '-' }}{{ formatMoney(entry.amount) }}
            </text>
          </view>
        </view>
      </view>
      <view v-else class="empty">本月还没有收支记录</view>
    </view>

    <view class="fab-wrap">
      <view class="fab" @tap="goRecord">
        <text>＋</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.ledger-summary {
  margin-top: 24rpx;
}

.txn-date {
  padding: 18rpx 4rpx 6rpx;
  color: $uni-text-color-grey;
  font-size: 24rpx;
}
</style>
