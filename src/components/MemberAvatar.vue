<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { resolveAvatarUrl } from '@/utils/upload';

const props = defineProps<{
  name: string;
  color: string;
  size?: 'md' | 'sm';
  avatarUrl?: string;
}>();

const initial = computed(() => (props.name || '家').slice(0, 1));

// 云存储 fileID(cloud://) 无法被 image 直接渲染，需解析为临时 URL
const resolvedUrl = ref('');
const failed = ref(false);

async function load(): Promise<void> {
  failed.value = false;
  resolvedUrl.value = (await resolveAvatarUrl(props.avatarUrl)) || '';
}

watch(() => props.avatarUrl, load, { immediate: true });

const showImage = computed(() => !!resolvedUrl.value && !failed.value);
</script>

<template>
  <view
    class="avatar-dot"
    :class="props.size === 'sm' ? 'avatar-dot-sm' : ''"
    :style="{ background: showImage ? 'transparent' : props.color }"
  >
    <image
      v-if="showImage"
      :src="resolvedUrl"
      class="avatar-img"
      mode="aspectFill"
      @error="failed = true"
    />
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
