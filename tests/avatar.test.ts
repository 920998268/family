import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCloud: vi.fn(),
  isCloudReady: vi.fn(),
  uploadAvatar: vi.fn(),
}));

vi.mock('@/unicloud', () => ({
  getCloud: mocks.getCloud,
  isCloudReady: mocks.isCloudReady,
  uploadAvatar: mocks.uploadAvatar,
}));

import { ensureCloudAvatar, resolveAvatarUrl } from '@/utils/upload';

// ensureCloudAvatar 内部会调用 uni.showLoading / uni.hideLoading
(globalThis as any).uni = {
  showLoading: vi.fn(),
  hideLoading: vi.fn(),
};

describe('resolveAvatarUrl', () => {
  let getTempFileURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getTempFileURL = vi.fn();
    mocks.getCloud.mockReset();
    mocks.getCloud.mockReturnValue({ getTempFileURL });
    mocks.isCloudReady.mockReset();
    mocks.isCloudReady.mockReturnValue(true);
  });

  it('returns undefined for an empty source', async () => {
    await expect(resolveAvatarUrl(undefined)).resolves.toBeUndefined();
    await expect(resolveAvatarUrl('')).resolves.toBeUndefined();
  });

  it('passes through non-cloud urls untouched', async () => {
    await expect(resolveAvatarUrl('https://cdn.example.com/a.png')).resolves.toBe(
      'https://cdn.example.com/a.png',
    );
    await expect(resolveAvatarUrl('wxfile://tmp/a.png')).resolves.toBe('wxfile://tmp/a.png');
    expect(mocks.getCloud).not.toHaveBeenCalled();
  });

  it('resolves a cloud fileID through the initialized client', async () => {
    getTempFileURL.mockResolvedValue({
      fileList: [{ fileID: 'cloud://env/a.png', tempFileURL: 'https://tmp.example.com/a.png' }],
    });

    await expect(resolveAvatarUrl('cloud://env/init-client.png')).resolves.toBe(
      'https://tmp.example.com/a.png',
    );
    // 必须经 getCloud() 拿到已初始化实例，不能用框架的裸 uniCloud 快照
    expect(mocks.getCloud).toHaveBeenCalled();
    expect(getTempFileURL).toHaveBeenCalledWith({ fileList: ['cloud://env/init-client.png'] });
  });

  it('caches resolved cloud urls', async () => {
    getTempFileURL.mockResolvedValue({
      fileList: [{ tempFileURL: 'https://tmp.example.com/cached.png' }],
    });

    await resolveAvatarUrl('cloud://env/cached-2.png');
    await resolveAvatarUrl('cloud://env/cached-2.png');

    expect(getTempFileURL).toHaveBeenCalledTimes(1);
  });

  it('falls back to the original fileID when resolution fails', async () => {
    getTempFileURL.mockRejectedValue(new Error('network'));

    await expect(resolveAvatarUrl('cloud://env/broken-2.png')).resolves.toBe(
      'cloud://env/broken-2.png',
    );
  });

  it('skips the cloud call entirely when uniCloud is not initialized', async () => {
    mocks.isCloudReady.mockReturnValue(false);

    await expect(resolveAvatarUrl('cloud://env/not-ready.png')).resolves.toBe(
      'cloud://env/not-ready.png',
    );
    expect(mocks.getCloud).not.toHaveBeenCalled();
  });
});

describe('ensureCloudAvatar', () => {
  beforeEach(() => {
    mocks.uploadAvatar.mockReset();
  });

  it('keeps an already-cloud fileID untouched', async () => {
    await expect(ensureCloudAvatar('cloud://env/keep.png')).resolves.toBe('cloud://env/keep.png');
    expect(mocks.uploadAvatar).not.toHaveBeenCalled();
  });

  it('uploads a local temp path and returns the cloud fileID', async () => {
    mocks.uploadAvatar.mockResolvedValue('cloud://env/uploaded.png');

    await expect(ensureCloudAvatar('wxfile://tmp/avatar.png')).resolves.toBe(
      'cloud://env/uploaded.png',
    );
    expect(mocks.uploadAvatar).toHaveBeenCalledWith('wxfile://tmp/avatar.png');
  });
});

const SRC_DIR = join(process.cwd(), 'src');
const CLIENT_DIRS = ['pages', 'utils', 'services', 'stores', 'components', 'repositories', 'storage'];

function collectClientFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return collectClientFiles(full);
    }
    return /\.(vue|ts)$/.test(entry) ? [full] : [];
  });
}

describe('前端不得直接使用裸 uniCloud 全局', () => {
  /**
   * 编译后裸 `uniCloud.xxx()` 会内联成 @dcloudio/uni-cloud 的静态导出快照，
   * 该快照在「未关联服务空间」时是直接 reject 的桩对象，运行时初始化也改不到它，
   * 会抛出「cli项目内使用uniCloud需要使用HBuilderX的运行菜单运行项目」。
   * 前端云能力必须统一走 getCloud()。
   */
  it('has no bare uniCloud.<method>() calls in client code', () => {
    const offenders: string[] = [];

    for (const dir of CLIENT_DIRS) {
      for (const file of collectClientFiles(join(SRC_DIR, dir))) {
        const source = readFileSync(file, 'utf8');
        // 匹配裸 uniCloud.xxx，排除 globalThis.uniCloud 这类带前缀的写法
        if (/(^|[^.\w$])uniCloud\s*\./.test(source)) {
          offenders.push(file.replace(/\\/g, '/'));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
