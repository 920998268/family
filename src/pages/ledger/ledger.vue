<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useLedgerStore } from '@/stores/ledger';
import { useFamilyStore } from '@/stores/family';
import { summarize } from '@/services/LedgerService';
import { flushPendingCheckins } from '@/services/checkinRuntime';
import { formatDateKey, todayKey } from '@/utils/date';
import { formatMoney } from '@/utils/format';
import type { Transaction } from '@/types/models';

type TypeFilter = 'all' | 'income' | 'expense';

const ledgerStore = useLedgerStore();
const familyStore = useFamilyStore();

const filter = ref<TypeFilter>('all');
const activeMonth = ref(todayKey().slice(0, 7));

const allEntries = computed(() => ledgerStore.entries);
/**
 * store 现在只装当前月份（`loadMonth`）—— 这里的月份过滤是**防御性**的：
 * 它在「切换月份后旧响应到达」这类时序里兜底，不承担主要口径职责。
 */
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
  /**
   * 按月加载：本地先渲染，随后拉取**当月区间**。
   *
   * ⚠️ 不能用 `loadAll()`：它只读本地。上云之后别的设备记的账不会出现，
   *    而本页的汇总卡是对当前选中月份求和的 —— 少拉一个月的数据，
   *    「本月结余」直接算错，且界面上没有任何东西指向这里。
   */
  ledgerStore.loadMonth(activeMonth.value);
  familyStore.load();
  // 页面之间跳转时 App 不会重新 onShow，积压的待同步要靠数据页自己补一次
  flushPendingCheckins();
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

/**
 * ⚠️「本月结余」卡片与下面两张收入 / 支出卡片之间**必须**留出间距。
 *
 * 这两块在模板里是**相邻的兄弟节点**，而 `.section` 只是个块级容器
 *（全局样式里只有 `margin-top`，没有 flex / gap），所以默认间距是 **0** ——
 * 两张白底圆角卡片会直接贴在一起；余额数字较长或系统字体放大时，
 * 看起来就像结余卡片压住了收入 / 支出那一行（部分机型更明显）。
 *
 * 这里刻意用 `margin-bottom` 而**不是**给容器加 `display: flex; gap`：
 * flex 的 `gap` 在旧 WebView（iOS < 14.1 / Android WebView < 84）上不生效，
 * 而那恰好会表现为「只有部分机型重叠」—— 正是本次要修的现象。
 * margin 是所有 WebView 都支持的最低成本方案。
 */
.stat-card {
  margin-bottom: 24rpx;
}

.txn-date {
  padding: 18rpx 4rpx 6rpx;
  color: $uni-text-color-grey;
  font-size: 24rpx;
}
</style>
