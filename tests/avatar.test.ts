import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveAvatarUrl } from '@/utils/upload';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveAvatarUrl', () => {
  it('returns undefined for an empty source', async () => {
    await expect(resolveAvatarUrl(undefined)).resolves.toBeUndefined();
    await expect(resolveAvatarUrl('')).resolves.toBeUndefined();
  });

  it('passes through non-cloud urls untouched', async () => {
    const getTempFileURL = vi.fn();
    vi.stubGlobal('uniCloud', { getTempFileURL });

    await expect(resolveAvatarUrl('https://cdn.example.com/a.png')).resolves.toBe(
      'https://cdn.example.com/a.png',
    );
    await expect(resolveAvatarUrl('wxfile://tmp/a.png')).resolves.toBe('wxfile://tmp/a.png');
    expect(getTempFileURL).not.toHaveBeenCalled();
  });

  it('resolves a cloud fileID to a temporary url', async () => {
    const getTempFileURL = vi.fn().mockResolvedValue({
      fileList: [{ fileID: 'cloud://env/a.png', tempFileURL: 'https://tmp.example.com/a.png' }],
    });
    vi.stubGlobal('uniCloud', { getTempFileURL });

    await expect(resolveAvatarUrl('cloud://env/a.png')).resolves.toBe(
      'https://tmp.example.com/a.png',
    );
    expect(getTempFileURL).toHaveBeenCalledWith({ fileList: ['cloud://env/a.png'] });
  });

  it('caches resolved cloud urls', async () => {
    const getTempFileURL = vi.fn().mockResolvedValue({
      fileList: [{ tempFileURL: 'https://tmp.example.com/cached.png' }],
    });
    vi.stubGlobal('uniCloud', { getTempFileURL });

    await resolveAvatarUrl('cloud://env/cached.png');
    await resolveAvatarUrl('cloud://env/cached.png');

    expect(getTempFileURL).toHaveBeenCalledTimes(1);
  });

  it('falls back to the original fileID when resolution fails', async () => {
    const getTempFileURL = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('uniCloud', { getTempFileURL });

    await expect(resolveAvatarUrl('cloud://env/broken.png')).resolves.toBe(
      'cloud://env/broken.png',
    );
  });
});
