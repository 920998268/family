<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  name: string;
  color: string;
  size?: 'md' | 'sm';
}>();

const initial = computed(() => (props.name || '家').slice(0, 1));
</script>

<template>
  <view
    class="avatar-dot"
    :class="props.size === 'sm' ? 'avatar-dot-sm' : ''"
    :style="{ background: props.color }"
  >
    <text>{{ initial }}</text>
  </view>
</template>
