import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { bootstrapSession, type SessionBootstrapDeps } from '@/services/SessionBootstrap';

function createDeps(overrides: Partial<SessionBootstrapDeps> = {}): SessionBootstrapDeps {
  return {
    hasToken: () => true,
    restoreFromStorage: vi.fn(),
    fetchFamilyStatus: vi.fn().mockResolvedValue({ hasFamily: true, uid: 'u-1', familyId: 'f-1' }),
    restoreCloudData: vi.fn().mockResolvedValue({}),
    clearToken: vi.fn(),
    getUid: () => 'u-1',
    ...overrides,
  };
}

describe('bootstrapSession', () => {
  it('does nothing when there is no token', async () => {
    const deps = createDeps({ hasToken: () => false });

    await expect(bootstrapSession(deps)).resolves.toBe('no-token');
    expect(deps.restoreFromStorage).not.toHaveBeenCalled();
    expect(deps.fetchFamilyStatus).not.toHaveBeenCalled();
  });

  it('restores cloud data with the refreshed uid', async () => {
    const deps = createDeps();

    await expect(bootstrapSession(deps)).resolves.toBe('restored');
    expect(deps.restoreFromStorage).toHaveBeenCalledTimes(1);
    expect(deps.restoreCloudData).toHaveBeenCalledWith('u-1');
  });

  it('reports no-family without attempting a data restore', async () => {
    const deps = createDeps({
      fetchFamilyStatus: vi.fn().mockResolvedValue({ hasFamily: false, uid: 'u-1' }),
    });

    await expect(bootstrapSession(deps)).resolves.toBe('no-family');
    expect(deps.restoreCloudData).not.toHaveBeenCalled();
  });

  it('keeps the session when the cloud restore fails', async () => {
    const deps = createDeps({
      restoreCloudData: vi.fn().mockRejectedValue(new Error('network')),
    });

    await expect(bootstrapSession(deps)).resolves.toBe('restored');
    expect(deps.clearToken).not.toHaveBeenCalled();
  });

  it('clears the token when the family status call fails', async () => {
    const deps = createDeps({
      fetchFamilyStatus: vi.fn().mockRejectedValue(new Error('token expired')),
    });

    await expect(bootstrapSession(deps)).resolves.toBe('invalid');
    expect(deps.clearToken).toHaveBeenCalledTimes(1);
  });

  it('passes the uid refreshed by fetchFamilyStatus, not the stale one', async () => {
    let uid = '';
    const deps = createDeps({
      getUid: () => uid,
      fetchFamilyStatus: vi.fn().mockImplementation(async () => {
        uid = 'u-refreshed';
        return { hasFamily: true, uid: 'u-refreshed', familyId: 'f-1' };
      }),
    });

    await bootstrapSession(deps);

    expect(deps.restoreCloudData).toHaveBeenCalledWith('u-refreshed');
  });
});

describe('App.vue 启动引导接线', () => {
  const source = readFileSync(join(process.cwd(), 'src/App.vue'), 'utf8');

  it('runs bootstrap on every platform, not only on WeChat', () => {
    // onLaunch 内不能整段被条件编译包裹，否则 H5 刷新不会恢复会话
    expect(source).not.toMatch(/#ifdef\s+MP-WEIXIN\s*\n\s*bootstrap\(\)/);
    expect(source).toMatch(/\n\s*bootstrap\(\);/);
  });

  it('delegates session restoration to bootstrapSession', () => {
    expect(source).toContain('bootstrapSession');
    expect(source).toContain('restoreFamilyDataFromCloud');
  });
});
