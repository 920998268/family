import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FAMILY_SETUP_PATH, ME_TAB_PATH, openFamilySetup, openMeTab } from '@/utils/navigation';

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

describe('family entry navigation', () => {
  let navigateTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    navigateTo = vi.fn();
    vi.stubGlobal('uni', { navigateTo });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the family setup page, not the legacy member page', () => {
    openFamilySetup();

    expect(navigateTo).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/family-setup/family-setup' });
  });

  it('exposes the family setup path', () => {
    expect(FAMILY_SETUP_PATH).toBe('/pages/family-setup/family-setup');
  });
});

const REPO_ROOT = process.cwd();
const SRC_DIR = join(REPO_ROOT, 'src');
const LEGACY_PAGE_PATH = 'pages/me/family';

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return collectSourceFiles(full);
    }
    return /\.(vue|ts|json)$/.test(entry) ? [full] : [];
  });
}

describe('legacy member page removal', () => {
  it('is no longer registered in pages.json', () => {
    const pagesJson = readFileSync(join(SRC_DIR, 'pages.json'), 'utf8');
    expect(pagesJson).not.toContain(LEGACY_PAGE_PATH);
    expect(pagesJson).toContain('pages/family-setup/family-setup');
  });

  it('is not referenced by any source file', () => {
    const offenders = collectSourceFiles(SRC_DIR).filter((file) =>
      readFileSync(file, 'utf8').includes(LEGACY_PAGE_PATH),
    );
    expect(offenders).toEqual([]);
  });

  it('no longer ships a page component', () => {
    const pageFiles = collectSourceFiles(SRC_DIR).map((file) => file.replace(/\\/g, '/'));
    expect(pageFiles.some((file) => file.endsWith('src/pages/me/family.vue'))).toBe(false);
  });
});
