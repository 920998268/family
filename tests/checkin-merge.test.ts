import { describe, expect, it } from 'vitest';

import { mergeCheckins } from '@/utils/checkinMerge';

interface Row {
  id: string;
  label: string;
}

const local = (id: string, label: string): Row => ({ id, label });

describe('mergeCheckins（本地 ∪ 云端）', () => {
  it('同 id 以云端为准（别的设备改过要能覆盖本地旧值）', () => {
    const merged = mergeCheckins([local('a', '本地')], [local('a', '云端')]);

    expect(merged).toEqual([{ id: 'a', label: '云端' }]);
  });

  it('本地独有记录保留（尚未上云的新记录不能被抹掉）', () => {
    const merged = mergeCheckins(
      [local('a', '本地'), local('only-local', '仅本地')],
      [local('a', '云端')],
    );

    expect(merged.map((row) => row.label)).toEqual(['云端', '仅本地']);
  });

  it('云端独有记录加入（别的设备新增的）', () => {
    const merged = mergeCheckins([], [local('remote', '云端')]);

    expect(merged.map((row) => row.id)).toEqual(['remote']);
  });

  it('云端为空时完全保留本地（断网兜底：本地画面不受影响）', () => {
    const merged = mergeCheckins([local('a', '本地1'), local('b', '本地2')], []);

    expect(merged.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('两边都为空返回空数组', () => {
    expect(mergeCheckins([], [])).toEqual([]);
  });

  it('结果顺序稳定：先按云端顺序，再接本地独有', () => {
    const merged = mergeCheckins(
      [local('l1', '本地1'), local('l2', '本地2')],
      [local('r1', '云端1'), local('l2', '云端2'), local('r2', '云端3')],
    );

    expect(merged.map((row) => row.id)).toEqual(['r1', 'l2', 'r2', 'l1']);
  });

  it('不修改入参（纯函数）', () => {
    const localList = [local('a', '本地'), local('b', '本地')];
    const remoteList = [local('a', '云端')];

    mergeCheckins(localList, remoteList);

    expect(localList.map((row) => row.label)).toEqual(['本地', '本地']);
    expect(remoteList).toHaveLength(1);
  });
});

describe('mergeCheckins：有待同步修改的记录必须用本地版本（关键守卫）', () => {
  /**
   * 若一律「云端为准」，离线时改的那条记录会被云端旧值覆盖回去 ——
   * 用户看到自己刚改的内容自己变回去，且这次覆盖还会被回写进本地缓存。
   */
  it('待同步 id 用本地版本，其余仍以云端为准', () => {
    const merged = mergeCheckins(
      [local('dirty', '本地新值'), local('clean', '本地旧值')],
      [local('dirty', '云端旧值'), local('clean', '云端新值')],
      new Set(['dirty']),
    );

    expect(merged).toEqual([
      { id: 'dirty', label: '本地新值' },
      { id: 'clean', label: '云端新值' },
    ]);
  });

  it('待同步集合为空时等价于「云端为准」', () => {
    const merged = mergeCheckins([local('a', '本地')], [local('a', '云端')], new Set());

    expect(merged[0].label).toBe('云端');
  });

  it('待同步 id 在云端不存在时仍作为本地独有保留', () => {
    const merged = mergeCheckins([local('a', '本地')], [], new Set(['a']));

    expect(merged).toEqual([{ id: 'a', label: '本地' }]);
  });

  it('未传待同步集合时不抛异常（默认云端为准）', () => {
    expect(mergeCheckins([local('a', '本地')], [local('a', '云端')])[0].label).toBe('云端');
  });
});

describe('mergeCheckins：异常输入', () => {
  it('云端出现重复 id 时只保留第一条，避免同一条记录展示两遍', () => {
    const merged = mergeCheckins([], [local('a', '云端1'), local('a', '云端2')]);

    expect(merged).toEqual([{ id: 'a', label: '云端1' }]);
  });

  it('本地出现重复 id 时以第一条为准', () => {
    const merged = mergeCheckins([local('a', '本地1'), local('a', '本地2')], []);

    expect(merged).toEqual([{ id: 'a', label: '本地1' }]);
  });
});
