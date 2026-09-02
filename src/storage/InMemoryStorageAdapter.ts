import type { StorageAdapter } from './StorageAdapter';

export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  keys(): string[] {
    return Array.from(this.map.keys());
  }

  clear(): void {
    this.map.clear();
  }
}

