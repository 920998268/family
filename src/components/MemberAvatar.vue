<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  name: string;
  color: string;
  size?: 'md' | 'sm';
  avatarUrl?: string;
}>();

const initial = computed(() => (props.name || '家').slice(0, 1));
</script>

<template>
  <view
    class="avatar-dot"
    :class="props.size === 'sm' ? 'avatar-dot-sm' : ''"
    :style="{ background: props.avatarUrl ? 'transparent' : props.color }"
  >
    <image v-if="props.avatarUrl" :src="props.avatarUrl" class="avatar-img" mode="aspectFill" />
    <text v-else>{{ initial }}</text>
  </view>
</template>

<style scoped>
.avatar-dot {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.avatar-dot-sm {
  width: 56rpx;
  height: 56rpx;
}

.avatar-img {
  width: 100%;
  height: 100%;
}

.avatar-dot text {
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
}

.avatar-dot-sm text {
  font-size: 22rpx;
}
</style>
