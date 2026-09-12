<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { hasToken, clearToken, initUniCloud } from '@/unicloud';
import { restoreFamilyDataFromCloud } from '@/services/CloudRestoreService';
import { bootstrapSession } from '@/services/SessionBootstrap';
import { flushPendingCheckins } from '@/services/checkinRuntime';

onLaunch(() => {
  initUniCloud();
  // 全平台执行：H5 刷新后同样需要回填 uid / 家庭状态并恢复云端数据
  bootstrap();
});

onShow(() => {
  // 回到前台时补传离线期间产生的打卡记录。
  // 前置条件（已登录 + 已加入家庭）在 flushPendingCheckins 内部判断，
  // 不满足时直接返回且**不消耗重试次数**，标记会留到条件具备后再推。
  flushPendingCheckins();
});

/**
 * 启动引导：
 * 已登录 → 回填 uid 与家庭状态 → 从云端恢复个人档案与家庭成员
 * 未登录 → 停留在登录页（pages.json 第一个页面）
 *
 * 仅「页面跳转」区分平台：微信小程序按有无家庭跳转，
 * H5 停留在当前路由（刷新时不会把用户从所在页面拽走）。
 */
async function bootstrap(): Promise<void> {
  const authStore = useAuthStore();
  const result = await bootstrapSession({
    hasToken,
    restoreFromStorage: () => authStore.restoreFromStorage(),
    fetchFamilyStatus: () => authStore.fetchFamilyStatus(),
    restoreCloudData: (uid) => restoreFamilyDataFromCloud(uid),
    clearToken,
    getUid: () => authStore.uid,
  });

  // #ifdef MP-WEIXIN
  if (result === 'restored') {
    uni.switchTab({ url: '/pages/home/home' });
  } else if (result === 'no-family') {
    // 用 reLaunch 清空页面栈，避免用户返回到登录页
    uni.reLaunch({ url: '/pages/family-setup/family-setup' });
  }
  // #endif
}
</script>

<style lang="scss">
@import "./styles/app.scss";

page {
  min-height: 100%;
  background: #faf6f1;
  color: #2d2a26;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}

view,
text,
button,
input,
textarea,
picker {
  box-sizing: border-box;
}

button {
  border: 0;
  line-height: 1;
}
</style>
