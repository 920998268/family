import type { MyFamilyStatus } from '@/unicloud';

/** 启动引导依赖（便于单测注入，避免直接耦合全局 uni / uniCloud） */
export interface SessionBootstrapDeps {
  /** 是否存在有效登录态 token */
  hasToken: () => boolean;
  /** 重置内存态，准备从云端回填 */
  restoreFromStorage: () => void;
  /** 拉取当前账号的家庭状态（含 uid 回填） */
  fetchFamilyStatus: () => Promise<MyFamilyStatus>;
  /** 从云端恢复个人档案与家庭成员 */
  restoreCloudData: (uid?: string) => Promise<unknown>;
  /** token 失效时清除登录态 */
  clearToken: () => void;
  /** 读取回填后的 uid */
  getUid: () => string;
}

export type SessionBootstrapResult =
  /** 无 token，保持登录页 */
  | 'no-token'
  /** 已恢复家庭与档案 */
  | 'restored'
  /** 已登录但尚未加入家庭 */
  | 'no-family'
  /** token 失效或网络异常，已清除登录态 */
  | 'invalid';

/**
 * 会话启动引导。
 *
 * 该逻辑全平台执行（含 H5）：H5 刷新页面后同样需要回填 uid 与家庭状态，
 * 否则页面内「本地无档案时从云端恢复」的兜底条件不成立，档案与成员会一直为空。
 * 是否跳转页面由调用方（依据平台）决定，这里只负责会话与数据的恢复。
 */
export async function bootstrapSession(
  deps: SessionBootstrapDeps,
): Promise<SessionBootstrapResult> {
  if (!deps.hasToken()) {
    return 'no-token';
  }

  try {
    deps.restoreFromStorage();
    const status = await deps.fetchFamilyStatus();

    if (!status.hasFamily) {
      return 'no-family';
    }

    try {
      await deps.restoreCloudData(deps.getUid());
    } catch (e) {
      // 云端恢复失败不阻断登录态，用户仍可正常使用本地缓存
      console.warn('[启动] 云端数据恢复失败:', e);
    }
    return 'restored';
  } catch {
    deps.clearToken();
    return 'invalid';
  }
}
