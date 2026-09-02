<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useFamilyStore } from '@/stores/family';

const props = defineProps<{
  modelValue: string[];
}>();
const emit = defineEmits<{
  'update:modelValue': [string[]];
}>();

const familyStore = useFamilyStore();

onShow(() => {
  familyStore.load();
});

function toggle(id: string): void {
  const next = props.modelValue.includes(id)
    ? props.modelValue.filter((item) => item !== id)
    : [...props.modelValue, id];
  emit('update:modelValue', next);
}
</script>

<template>
  <view class="member-multi">
    <view
      v-for="member in familyStore.members"
      :key="member.id"
      class="chip chip-select"
      :class="modelValue.includes(member.id) ? 'chip-active' : ''"
      @tap="toggle(member.id)"
    >
      <text>{{ member.name }}</text>
    </view>
    <text v-if="familyStore.members.length === 0" class="member-select-hint">
      请先在「我的-家庭成员」中添加成员
    </text>
  </view>
</template>

<style scoped lang="scss">
.member-multi {
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
