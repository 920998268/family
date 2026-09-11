import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFamily,
  getMyFamilyStatus,
  listCloudMembers,
  updateCloudMember,
} from '@/unicloud';

function stubCloudResult(result: unknown): ReturnType<typeof vi.fn> {
  const callFunction = vi.fn().mockResolvedValue({ result });
  vi.stubGlobal('uniCloud', { callFunction });
  return callFunction;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloud error message passthrough', () => {
  it('surfaces the msg returned by the family cloud function', async () => {
    stubCloudResult({ code: 400, msg: '你已加入家庭，无法重复创建' });

    await expect(createFamily('测试家庭')).rejects.toThrow('你已加入家庭，无法重复创建');
  });

  it('surfaces the msg returned by the member cloud function', async () => {
    stubCloudResult({ code: 400, msg: '尚未加入家庭' });

    await expect(listCloudMembers()).rejects.toThrow('尚未加入家庭');
  });

  it('surfaces msg for mutations too', async () => {
    stubCloudResult({ code: 401, msg: '登录态无效或已过期' });

    await expect(updateCloudMember('m-1', { name: '小明' })).rejects.toThrow(
      '登录态无效或已过期',
    );
  });

  it('still accepts the legacy message field', async () => {
    stubCloudResult({ code: 400, message: '旧字段错误' });

    await expect(createFamily('测试家庭')).rejects.toThrow('旧字段错误');
  });

  it('falls back to a generic message when no text is provided', async () => {
    stubCloudResult({ code: 500 });

    await expect(getMyFamilyStatus()).rejects.toThrow('family 云函数 [getMyStatus] 调用失败');
  });

  it('returns data on success', async () => {
    stubCloudResult({ code: 0, data: { hasFamily: true, familyId: 'f-1' } });

    await expect(getMyFamilyStatus()).resolves.toEqual({ hasFamily: true, familyId: 'f-1' });
  });
});
