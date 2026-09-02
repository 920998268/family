import type { StorageAdapter } from './StorageAdapter';

export class UniStorageAdapter implements StorageAdapter {
  getItem(key: string): string | null {
    return uni.getStorageSync(key) ?? null;
  }

  setItem(key: string, value: string): void {
    uni.setStorageSync(key, value);
  }

  removeItem(key: string): void {
    uni.removeStorageSync(key);
  }

  keys(): string[] {
    return uni.getStorageInfoSync().keys;
  }
}

