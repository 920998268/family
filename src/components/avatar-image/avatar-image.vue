<template>
  <image
    v-if="displaySrc && !failed"
    :src="displaySrc"
    class="ai-img"
    :style="imgStyle"
    mode="aspectFill"
    @error="failed = true"
  />
  <view v-else class="ai-ph" :style="phStyle">
    <text class="ai-initial" :style="initialStyle">{{ initial }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { resolveAvatarUrl } from '@/utils/upload';

const props = withDefaults(
  defineProps<{
    /** 头像 URL（本地临时路径 / https / cloud:// fileID 均可） */
    src?: string;
    /** 头像尺寸 rpx */
    size?: number;
    /** 占位背景色（无头像或加载失败时） */
    bg?: string;
    /** 名称，取首字作为占位文字 */
    name?: string;
    /** 占位首字字号 rpx */
    fontSize?: number;
    /** 自定义占位内容（如相机 emoji），优先于 name 首字 */
    placeholder?: string;
  }>(),
  {
    src: '',
    size: 112,
    bg: '#f97316',
    name: '?',
    fontSize: 40,
    placeholder: '',
  },
);

const displaySrc = ref('');
const failed = ref(false);

const sizeStr = computed(() => `${props.size}rpx`);
const radiusStr = computed(() => `${Math.floor(props.size / 2)}rpx`);
const imgStyle = computed(() => ({
  width: sizeStr.value,
  height: sizeStr.value,
  borderRadius: radiusStr.value,
}));
const phStyle = computed(() => ({
  width: sizeStr.value,
  height: sizeStr.value,
  borderRadius: radiusStr.value,
  background: props.bg,
}));
const initialStyle = computed(() => ({
  fontSize: `${props.fontSize}rpx`,
  color: '#ffffff',
  fontWeight: '700' as const,
  lineHeight: '1',
}));
const initial = computed(() => props.placeholder || (props.name || '?').slice(0, 1));

async function load(): Promise<void> {
  failed.value = false;
  displaySrc.value = (await resolveAvatarUrl(props.src)) || '';
}

watch(() => props.src, load);
onMounted(load);
</script>

<style scoped>
.ai-img {
  display: block;
  flex-shrink: 0;
}
.ai-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ai-initial {
  display: block;
}
</style>
