import { getCheckinSyncService } from '@/services';
import type { CheckinRef } from '@/services/CheckinSyncService';
import { useAuthStore } from '@/stores/auth';
import type { SyncDomain, SyncOp } from '@/utils/pendingSync';

/**
 * 打卡云同步的运行时入口（store 与 App / 页面生命周期都从这里进出）。
 *
 * 把「前置条件判断」集中在这里，而不是散在 store 与页面里：
 * 云调用有两个动作，对前置条件的要求**恰好相反**，写反了都会丢数据。
 */

/**
 * 云同步是否可用：已登录 **且** 已加入家庭。
 *
 * ⚠️ 未加入家庭时云函数会一直报错，而失败次数累加到上限会把待同步标记丢掉
 * ＝本地记录再也上不了云。所以「拉取」与「重发」都必须先过这道门。
 */
export function isCheckinCloudReady(): boolean {
  const auth = useAuthStore();
  return auth.isLoggedIn && auth.hasFamily;
}

/**
 * 登记待同步。**刻意不做前置判断**：本地写入必须留下痕迹。
 *
 * 若这里也加门，用户「先打卡、后加入家庭」时，之前写的记录会永远不上云
 * ——标记压根没建过。而重发被门挡住时不会消耗重试次数，标记会一直留着，
 * 等条件具备后自然会被推上去。
 */
export function markCheckinDirty(domain: SyncDomain, op: SyncOp, ref: CheckinRef): void {
  getCheckinSyncService().markDirty(domain, op, ref);
}

/**
 * 重发待同步（页面 / App `onShow` 调用）。
 * 不阻塞调用方，失败留给下一轮；本地画面不受影响。
 */
export function flushPendingCheckins(): void {
  if (!isCheckinCloudReady()) {
    return;
  }
  void getCheckinSyncService()
    .flush()
    .catch((error) => {
      console.warn('[同步] 重发待同步失败:', error);
    });
}
