import { describe, expect, it } from 'vitest';

import type { FamilyMember } from '@/types/models';
import { matchCloudMember } from '@/utils/member';

function localMember(overrides: Partial<FamilyMember> & Record<string, any> = {}) {
  return {
    id: 'local-1',
    name: '小明',
    role: 'son',
    avatarColor: '#f97316',
    ...overrides,
  } as FamilyMember;
}

describe('matchCloudMember', () => {
  it('prefers the cloud id recorded on the local member', () => {
    const list = [
      { _id: 'c-1', name: '小明' },
      { _id: 'c-2', name: '小明' },
    ];
    const result = matchCloudMember(list, localMember({ cloudId: 'c-2' }));

    expect(result?._id).toBe('c-2');
  });

  it('falls back to matching the bound account uid', () => {
    const list = [
      { _id: 'c-1', name: '小明' },
      { _id: 'c-2', name: '小红', userId: 'u-9' },
    ];
    const result = matchCloudMember(list, localMember({ userId: 'u-9' }));

    expect(result?._id).toBe('c-2');
  });

  it('falls back to matching the preset mobile', () => {
    const list = [{ _id: 'c-1', name: '小明', mobile: '13800000000' }];
    const result = matchCloudMember(list, localMember({ mobile: '13800000000' }));

    expect(result?._id).toBe('c-1');
  });

  it('falls back to name matching for an unbound member', () => {
    const list = [
      { _id: 'c-1', name: '小红', userId: 'u-1' },
      { _id: 'c-2', name: '小明', userId: null },
    ];
    const result = matchCloudMember(list, localMember());

    expect(result?._id).toBe('c-2');
  });

  it('never matches a bound record by name', () => {
    const list = [{ _id: 'c-1', name: '小明', userId: 'u-1' }];

    expect(matchCloudMember(list, localMember())).toBeUndefined();
  });

  it('returns undefined when a bound member has no counterpart', () => {
    expect(matchCloudMember([], localMember({ userId: 'u-404' }))).toBeUndefined();
  });

  it('ignores a stale cloud id and falls through to other strategies', () => {
    const list = [{ _id: 'c-2', name: '小明', userId: null }];
    const result = matchCloudMember(list, localMember({ cloudId: 'c-deleted' }));

    expect(result?._id).toBe('c-2');
  });
});
