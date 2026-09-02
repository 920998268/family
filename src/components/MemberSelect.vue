<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useFamilyStore } from '@/stores/family';

defineProps<{
  modelValue?: string;
}>();
const emit = defineEmits<{
  'update:modelValue': [string | undefined];
}>();

const familyStore = useFamilyStore();

onShow(() => {
  familyStore.load();
});

function select(id: string | undefined): void {
  emit('update:modelValue', id);
}
</script>

<template>
  <view class="member-select">
    <view
      class="chip chip-select"
      :class="!modelValue ? 'chip-active' : ''"
      @tap="select(undefined)"
    >
      <text>未指定</text>
    </view>
    <view
      v-for="member in familyStore.members"
      :key="member.id"
      class="chip chip-select"
      :class="modelValue === member.id ? 'chip-active' : ''"
      @tap="select(member.id)"
    >
      <text>{{ member.name }}</text>
    </view>
    <text v-if="familyStore.members.length === 0" class="member-select-hint">
      请先在「我的-家庭成员」中添加成员
    </text>
  </view>
</template>

<style scoped lang="scss">
.member-select {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
}

.chip-select {
  border: 2rpx solid transparent;
}

.chip-active {
  border-color: $uni-color-primary;
  color: $uni-color-primary;
  background: $uni-color-primary-light;
}

.member-select-hint {
  width: 100%;
  color: $uni-text-color-grey;
  font-size: 22rpx;
}
</style>
