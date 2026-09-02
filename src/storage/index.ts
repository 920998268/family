import { UniStorageAdapter } from './UniStorageAdapter';
import type { StorageAdapter } from './StorageAdapter';

let defaultAdapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (!defaultAdapter) {
    defaultAdapter = new UniStorageAdapter();
  }
  return defaultAdapter;
}

export function setStorageAdapter(adapter: StorageAdapter): void {
  defaultAdapter = adapter;
}

