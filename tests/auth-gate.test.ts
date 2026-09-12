import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  pullDiets: vi.fn(),
  pullWorkouts: vi.fn(),
  flush: vi.fn(),
  markDirty: vi.fn(),
  pendingCount: vi.fn(),
}));

vi.mock('@/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services')>();
  return {
    ...actual,
    getCheckinSyncService: () => ({
      pullDiets: mocks.pullDiets,
      pullWorkouts: mocks.pullWorkouts,
      flush: mocks.flush,
      markDirty: mocks.markDirty,
      pendingCount: mocks.pendingCount,
    }),
  };
});

import { useAuthStore } from '@/stores/auth';
import { flushPendingCheckins, isCheckinCloudReady } from '@/services/checkinRuntime';

const TOKEN_KEY = 'uni_id_token';

let token = '';

function stubUni(): void {
  (globalThis as any).uni = {
    getStorageSync: (key: string) => (key === TOKEN_KEY ? token : ''),
    setStorageSync: () => {},
    removeStorageSync: (key: string) => {
      if (key === TOKEN_KEY) token = '';
    },
  };
}

/**
 * 回归守卫：登录态判定必须**实时**反映 storage。
 *
 * 曾经的实现是 `const isLoggedIn = computed(() => hasToken())`。
 * `hasToken()` 读的是 uni storage（非响应式），这个 computed 没有任何响应式依赖，
 * 于是第一次求值后结果被永久缓存 —— 而 `App.vue` 的 `onShow` 必然会在
 * **登录之前**触发一次云同步前置判断，从而把 `false` 缓存下来。
 * 结果：之后即使登录成功，所有打卡云调用都被静默跳过，
 * 现象是「打卡正常、数据只在本地、云端没有也不报错」。
 */
describe('登录态判定必须实时反映 storage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    token = '';
    stubUni();
    mocks.flush.mockReset().mockResolvedValue({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      dropped: 0,
    });
  });

  it('未登录时求值过，登录后仍能变为已登录', () => {
    const auth = useAuthStore();

    // 这一步在旧实现里会把 false 永久缓存
    expect(auth.isLoggedIn()).toBe(false);

    token = 'token-abc';

    expect(auth.isLoggedIn()).toBe(true);
  });

  it('退出登录后立刻变为未登录', () => {
    const auth = useAuthStore();
    token = 'token-abc';
    expect(auth.isLoggedIn()).toBe(true);

    token = '';

    expect(auth.isLoggedIn()).toBe(false);
  });

  it('启动时（未登录）的前置判断不会锁死后续同步', () => {
    const auth = useAuthStore();

    // 模拟 App onShow 在登录前触发
    expect(isCheckinCloudReady()).toBe(false);

    token = 'token-abc';
    auth.familyId = 'f-1';

    expect(isCheckinCloudReady()).toBe(true);
  });

  it('登录前调过补传，登录后能真正发起重发', () => {
    token = '';
    flushPendingCheckins();
    expect(mocks.flush).not.toHaveBeenCalled();

    token = 'token-abc';
    useAuthStore().familyId = 'f-1';
    flushPendingCheckins();

    expect(mocks.flush).toHaveBeenCalledTimes(1);
  });

  it('已登录但未加入家庭时仍然不发起重发', () => {
    token = 'token-abc';
    useAuthStore().familyId = '';

    flushPendingCheckins();

    expect(mocks.flush).not.toHaveBeenCalled();
  });
});

describe('源码守卫：isLoggedIn 不得写成 computed', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/auth.ts'), 'utf8');

  it('是普通函数而非 computed', () => {
    expect(source).not.toMatch(/isLoggedIn\s*=\s*computed/);
    expect(source).toMatch(/function isLoggedIn\(\)\s*:\s*boolean/);
  });

  it('调用方一律以函数形式使用', () => {
    for (const page of [
      'src/pages/home/home.vue',
      'src/pages/me/me.vue',
      'src/pages/me/profile.vue',
      'src/pages/family-setup/family-setup.vue',
    ]) {
      const pageSource = readFileSync(join(process.cwd(), page), 'utf8');
      expect(pageSource, `${page} 仍在用属性形式访问 isLoggedIn`).not.toMatch(
        /isLoggedIn\s*&&/,
      );
    }
  });
});
