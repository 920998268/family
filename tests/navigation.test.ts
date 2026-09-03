import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ME_TAB_PATH, openMeTab } from '@/utils/navigation';

describe('profile navigation', () => {
  let switchTab: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    switchTab = vi.fn();
    vi.stubGlobal('uni', { switchTab });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the Me tab page after saving a profile', () => {
    openMeTab();

    expect(switchTab).toHaveBeenCalledTimes(1);
    expect(switchTab).toHaveBeenCalledWith({ url: '/pages/me/me' });
  });

  it('exposes the Me tab path', () => {
    expect(ME_TAB_PATH).toBe('/pages/me/me');
  });
});
