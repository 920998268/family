import { setActivePinia, createPinia } from 'pinia';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth';

// 测试环境模拟全局 uni 对象
(globalThis as any).uni = {
  login: vi.fn(),
  switchTab: vi.fn(),
  redirectTo: vi.fn(),
  getStorageSync: vi.fn(() => ''),
  setStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
};

// mock unicloud 模块，避免依赖全局 uniCloud 对象
vi.mock('@/unicloud', () => ({
  hasToken: vi.fn(() => false),
  clearToken: vi.fn(),
  loginByWeixin: vi.fn(),
  logout: vi.fn(),
  getMyFamilyStatus: vi.fn(),
  createFamily: vi.fn(),
  joinFamily: vi.fn(),
}));

import {
  hasToken,
  loginByWeixin,
  getMyFamilyStatus,
  createFamily,
  joinFamily,
  clearToken,
} from '@/unicloud';

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    vi.mocked(hasToken).mockReturnValue(false);
    (globalThis as any).uni.login = vi.fn().mockResolvedValue({ code: 'test-code' });
  });

  it('初始状态未登录、无家庭', () => {
    vi.mocked(hasToken).mockReturnValue(false);
    const store = useAuthStore();
    expect(store.isLoggedIn).toBe(false);
    expect(store.hasFamily).toBe(false);
    expect(store.uid).toBe('');
    expect(store.familyId).toBe('');
    expect(store.loggingIn).toBe(false);
    expect(store.checking).toBe(false);
  });

  it('已登录时 isLoggedIn 为 true', () => {
    vi.mocked(hasToken).mockReturnValue(true);
    const store = useAuthStore();
    expect(store.isLoggedIn).toBe(true);
  });

  it('restoreFromStorage 重置内存状态', () => {
    const store = useAuthStore();
    store.uid = 'user-123';
    store.familyId = 'family-456';
    store.familyName = '测试家庭';
    store.restoreFromStorage();
    expect(store.uid).toBe('');
    expect(store.familyId).toBe('');
    expect(store.familyName).toBe('');
    expect(store.hasFamily).toBe(false);
  });

  it('loginWithWeixin 成功后设置 uid 和 nickname', async () => {
    vi.mocked(loginByWeixin).mockResolvedValue({
      token: 'test-token',
      uid: 'user-001',
      nickname: '测试用户',
    });
    vi.mocked(getMyFamilyStatus).mockResolvedValue({
      hasFamily: true,
      familyId: 'fam-001',
      familyName: '我的家',
      role: 'owner',
      inviteCode: 'ABC123',
    });
    const store = useAuthStore();
    await store.loginWithWeixin();
    expect(store.uid).toBe('user-001');
    expect(store.nickname).toBe('测试用户');
    expect(store.loggingIn).toBe(false);
  });

  it('loginWithWeixin 失败时重置 loggingIn', async () => {
    vi.mocked(loginByWeixin).mockRejectedValue(new Error('登录失败'));

    const store = useAuthStore();
    await expect(store.loginWithWeixin()).rejects.toThrow('登录失败');
    expect(store.loggingIn).toBe(false);
  });

  it('fetchFamilyStatus 有家庭时设置家庭信息', async () => {
    vi.mocked(getMyFamilyStatus).mockResolvedValue({
      hasFamily: true,
      familyId: 'fam-001',
      familyName: '幸福之家',
      role: 'member',
      inviteCode: 'XYZ789',
    });
    const store = useAuthStore();
    const status = await store.fetchFamilyStatus();
    expect(status.hasFamily).toBe(true);
    expect(store.familyId).toBe('fam-001');
    expect(store.familyName).toBe('幸福之家');
    expect(store.familyRole).toBe('member');
    expect(store.inviteCode).toBe('XYZ789');
    expect(store.hasFamily).toBe(true);
    expect(store.checking).toBe(false);
  });

  it('fetchFamilyStatus 无家庭时清空家庭信息', async () => {
    vi.mocked(getMyFamilyStatus).mockResolvedValue({ hasFamily: false });
    const store = useAuthStore();
    store.familyId = 'old-fam';
    const status = await store.fetchFamilyStatus();
    expect(status.hasFamily).toBe(false);
    expect(store.familyId).toBe('');
    expect(store.hasFamily).toBe(false);
  });

  it('createNewFamily 成功后设置家庭信息', async () => {
    vi.mocked(createFamily).mockResolvedValue({
      _id: 'new-fam',
      name: '新建家庭',
      inviteCode: 'NEW001',
      ownerId: 'user-001',
      memberCount: 1,
      createdAt: Date.now(),
    });
    const store = useAuthStore();
    const family = await store.createNewFamily('新建家庭');
    expect(family._id).toBe('new-fam');
    expect(store.familyId).toBe('new-fam');
    expect(store.familyName).toBe('新建家庭');
    expect(store.familyRole).toBe('owner');
    expect(store.inviteCode).toBe('NEW001');
  });

  it('joinExistingFamily 成功后设置家庭信息', async () => {
    vi.mocked(joinFamily).mockResolvedValue({
      _id: 'joined-fam',
      name: '加入的家庭',
      inviteCode: 'JOIN01',
      ownerId: 'owner-001',
      memberCount: 2,
      createdAt: Date.now(),
    });
    const store = useAuthStore();
    const family = await store.joinExistingFamily('JOIN01');
    expect(family._id).toBe('joined-fam');
    expect(store.familyId).toBe('joined-fam');
    expect(store.familyRole).toBe('member');
  });

  it('logout 清除所有状态', async () => {
    const store = useAuthStore();
    store.uid = 'user-001';
    store.familyId = 'fam-001';
    store.nickname = '测试';
    await store.logout();
    expect(clearToken).toHaveBeenCalled();
    expect(store.uid).toBe('');
    expect(store.familyId).toBe('');
    expect(store.nickname).toBe('');
    expect(store.isLoggedIn).toBe(false);
  });

  it('fetchFamilyStatus 从云端回填 uid（应用重启后恢复档案的前提）', async () => {
    vi.mocked(getMyFamilyStatus).mockResolvedValue({
      hasFamily: true,
      uid: 'user-9527',
      familyId: 'fam-001',
      familyName: '幸福一家',
      role: 'owner',
      inviteCode: 'AB12CD',
    });
    const store = useAuthStore();
    // 模拟应用重启：restoreFromStorage 会把内存态清空
    store.restoreFromStorage();
    expect(store.uid).toBe('');

    await store.fetchFamilyStatus();

    expect(store.uid).toBe('user-9527');
    expect(store.familyId).toBe('fam-001');
    expect(store.hasFamily).toBe(true);
  });

  it('fetchFamilyStatus 在无家庭时也回填 uid 并清空家庭字段', async () => {
    vi.mocked(getMyFamilyStatus).mockResolvedValue({
      hasFamily: false,
      uid: 'user-9527',
      familyId: '',
    });
    const store = useAuthStore();
    store.familyId = 'stale-family';

    await store.fetchFamilyStatus();

    expect(store.uid).toBe('user-9527');
    expect(store.familyId).toBe('');
    expect(store.hasFamily).toBe(false);
  });

  it('fetchFamilyStatus 在云端未返回 uid 时不清空已有 uid', async () => {
    vi.mocked(getMyFamilyStatus).mockResolvedValue({ hasFamily: true, familyId: 'fam-001' });
    const store = useAuthStore();
    store.uid = 'user-keep';

    await store.fetchFamilyStatus();

    expect(store.uid).toBe('user-keep');
  });
});
