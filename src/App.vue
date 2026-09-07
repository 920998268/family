<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { hasToken, clearToken, initUniCloud } from '@/unicloud';
import { restoreFamilyDataFromCloud } from '@/services/CloudRestoreService';

onLaunch(() => {
  initUniCloud();
  // #ifdef MP-WEIXIN
  bootstrap();
  // #endif
});

/**
 * 微信小程序启动引导：
 * 已登录 → 检查家庭状态 → 有家庭进首页 / 无家庭进家庭设置
 * 未登录 → 停留在登录页（pages.json 第一个页面）
 */
async function bootstrap(): Promise<void> {
  if (!hasToken()) {
    return;
  }
  try {
    const authStore = useAuthStore();
    authStore.restoreFromStorage();
    const status = await authStore.fetchFamilyStatus();
    if (status.hasFamily) {
      // 从云端恢复该账号已保存的个人档案与家庭成员
      try {
        await restoreFamilyDataFromCloud(authStore.uid);
      } catch (e) {
        console.warn('[启动] 云端数据恢复失败:', e);
      }
      uni.switchTab({ url: '/pages/home/home' });
    } else {
      // 用 reLaunch 清空页面栈，避免用户返回到登录页
      uni.reLaunch({ url: '/pages/family-setup/family-setup' });
    }
  } catch {
    // token 失效或网络异常，清除后留在登录页
    clearToken();
  }
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
