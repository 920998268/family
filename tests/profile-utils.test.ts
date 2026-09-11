import { describe, expect, it } from 'vitest';

import { createAvatarOnlyProfile, isPlaceholderProfile, UNNAMED_PROFILE } from '@/utils/profile';
import { validateProfile } from '@/utils/validation';

describe('createAvatarOnlyProfile', () => {
  it('produces a payload that passes profile validation', () => {
    const draft = createAvatarOnlyProfile('张三', 'cloud://env/avatar/a.png');
    expect(validateProfile(draft)).toEqual({ valid: true, errors: [] });
    expect(draft.avatarUrl).toBe('cloud://env/avatar/a.png');
    expect(draft.birthDate).toBe('');
    expect(draft.heightCm).toBe(0);
  });

  it('falls back to a placeholder name when the display name is empty', () => {
    expect(createAvatarOnlyProfile('').name).toBe(UNNAMED_PROFILE);
    expect(createAvatarOnlyProfile('   ').name).toBe(UNNAMED_PROFILE);
    expect(createAvatarOnlyProfile(undefined).name).toBe(UNNAMED_PROFILE);
    expect(validateProfile(createAvatarOnlyProfile('')).valid).toBe(true);
  });

  it('trims a provided name and omits an empty avatar', () => {
    expect(createAvatarOnlyProfile('  李四  ').name).toBe('李四');
    expect(createAvatarOnlyProfile('李四').avatarUrl).toBeUndefined();
  });
});

describe('isPlaceholderProfile', () => {
  it('treats a missing profile as a placeholder', () => {
    expect(isPlaceholderProfile(null)).toBe(true);
    expect(isPlaceholderProfile(undefined)).toBe(true);
  });

  it('detects an avatar-only profile', () => {
    expect(isPlaceholderProfile(createAvatarOnlyProfile('张三', 'cloud://x'))).toBe(true);
  });

  it('returns false once any body data is present', () => {
    expect(isPlaceholderProfile({ ...createAvatarOnlyProfile('张三'), heightCm: 170 })).toBe(false);
    expect(
      isPlaceholderProfile({ ...createAvatarOnlyProfile('张三'), birthDate: '1990-01-01' }),
    ).toBe(false);
  });
});
