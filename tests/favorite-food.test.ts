import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services')>();
  return {
    ...actual,
    createFavoriteFoodService: () => ({ list: mocks.list, remove: mocks.remove }),
  };
});

import { FavoriteFoodService } from '@/services/FavoriteFoodService';
import type { FavoriteFoodRemoteRepo } from '@/repositories/remote/FavoriteFoodRemoteRepo';
import { useAuthStore } from '@/stores/auth';
import { useFavoriteFoodStore } from '@/stores/favoriteFood';
import type { FavoriteFood } from '@/types/models';

const TOKEN_KEY = 'uni_id_token';

function stubUni(token: string): void {
  (globalThis as any).uni = {
    getStorageSync: (key: string) => (key === TOKEN_KEY ? token : ''),
    setStorageSync: () => {},
    removeStorageSync: () => {},
  };
}

const food = (name: string): FavoriteFood => ({
  id: `f-${name}`,
  name,
  quantity: '1 杯',
  calories: 150,
  useCount: 1,
});

function createRemote(): FavoriteFoodRemoteRepo {
  return {
    list: vi.fn().mockResolvedValue([food('牛奶')]),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FavoriteFoodService', () => {
  it('list 直接委托远端', async () => {
    const remote = createRemote();
    const service = new FavoriteFoodService(remote);

    await expect(service.list('牛')).resolves.toEqual([food('牛奶')]);
    expect(remote.list).toHaveBeenCalledWith('牛');
  });

  it('remove 去掉首尾空格', async () => {
    const remote = createRemote();
    const service = new FavoriteFoodService(remote);

    await service.remove('  牛奶  ');

    expect(remote.remove).toHaveBeenCalledWith('牛奶');
  });

  it('remove 空名称直接抛错，不打网络', async () => {
    const remote = createRemote();
    const service = new FavoriteFoodService(remote);

    await expect(service.remove('   ')).rejects.toThrow('缺少食物名称');
    expect(remote.remove).not.toHaveBeenCalled();
  });
});

describe('useFavoriteFoodStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    stubUni('token-test');
    useAuthStore().familyId = 'f-1';
    mocks.list.mockReset().mockResolvedValue([food('牛奶'), food('鸡胸肉')]);
    mocks.remove.mockReset().mockResolvedValue(undefined);
  });

  it('已登录且已加入家庭时拉取常用食物', async () => {
    const store = useFavoriteFoodStore();

    await store.load();

    expect(store.foods.map((item) => item.name)).toEqual(['牛奶', '鸡胸肉']);
    expect(store.loaded).toBe(true);
    expect(store.loading).toBe(false);
  });

  it('未登录时不发请求，直接清空', async () => {
    stubUni('');
    const store = useFavoriteFoodStore();

    await store.load();

    expect(mocks.list).not.toHaveBeenCalled();
    expect(store.foods).toEqual([]);
  });

  it('未加入家庭时不发请求（云函数必然报错）', async () => {
    useAuthStore().familyId = '';
    const store = useFavoriteFoodStore();

    await store.load();

    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('拉取失败时当作没有常用食物，不打扰用户', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.list.mockRejectedValue(new Error('网络不可达'));
    const store = useFavoriteFoodStore();

    await store.load();

    expect(store.foods).toEqual([]);
    expect(store.loading).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('删除后重新拉取列表', async () => {
    const store = useFavoriteFoodStore();
    await store.load();
    mocks.list.mockClear();

    await store.remove('牛奶');

    expect(mocks.remove).toHaveBeenCalledWith('牛奶');
    expect(mocks.list).toHaveBeenCalled();
  });

  it('未登录时删除不做任何事', async () => {
    stubUni('');
    const store = useFavoriteFoodStore();

    await store.remove('牛奶');

    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('关键词会透传给服务', async () => {
    const store = useFavoriteFoodStore();

    await store.load('牛');

    expect(mocks.list).toHaveBeenCalledWith('牛');
  });
});
