import { describe, expect, it } from 'vitest';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import {
  MAX_SYNC_ATTEMPTS,
  PENDING_SYNC_KEY,
  clearPendingSync,
  coalesceOp,
  dequeuePendingSync,
  dropPendingSync,
  failPendingSync,
  pendingClientIds,
  queuePendingSync,
  readPendingSync,
  writePendingSync,
  type SyncOp,
} from '@/utils/pendingSync';

function createStorage(): InMemoryStorageAdapter {
  return new InMemoryStorageAdapter();
}

const dietAdd = {
  domain: 'diet' as const,
  clientId: 'diet-1',
  op: 'add' as const,
  date: '2026-09-12',
};

describe('待同步标记：入队与合并', () => {
  it('入队后可以读回，且带上初始重试状态', () => {
    const storage = createStorage();

    const items = queuePendingSync(storage, dietAdd, 1000);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      domain: 'diet',
      clientId: 'diet-1',
      op: 'add',
      date: '2026-09-12',
      attempts: 0,
      queuedAt: 1000,
    });
    expect(readPendingSync(storage)).toHaveLength(1);
  });

  it('同一记录重复入队只保留一条（用户连续编辑不排出多条消息）', () => {
    const storage = createStorage();

    queuePendingSync(storage, dietAdd, 1000);
    queuePendingSync(storage, { ...dietAdd, op: 'update' }, 2000);
    queuePendingSync(storage, { ...dietAdd, op: 'update' }, 3000);

    const items = readPendingSync(storage);
    expect(items).toHaveLength(1);
    expect(items[0].queuedAt).toBe(3000);
  });

  it('重新入队会重置重试次数并清掉上次的失败原因', () => {
    const storage = createStorage();
    queuePendingSync(storage, dietAdd, 1000);
    failPendingSync(storage, 'diet', 'diet-1', new Error('网络超时'));

    const items = queuePendingSync(storage, { ...dietAdd, op: 'update' }, 2000);

    expect(items[0].attempts).toBe(0);
    expect(items[0].lastError).toBeUndefined();
  });

  it('不同记录互不干扰', () => {
    const storage = createStorage();

    queuePendingSync(storage, dietAdd, 1000);
    queuePendingSync(storage, { ...dietAdd, clientId: 'diet-2' }, 1000);
    queuePendingSync(storage, { ...dietAdd, domain: 'workout', clientId: 'diet-1' }, 1000);

    // 同 clientId 但不同 domain 是两条独立标记
    expect(readPendingSync(storage)).toHaveLength(3);
  });
});

describe('coalesceOp（动作合并规则）', () => {
  const cases: Array<[SyncOp, SyncOp, SyncOp, string]> = [
    ['add', 'add', 'add', '重复新增仍是新增'],
    ['add', 'update', 'add', '新增后编辑保持 add —— 否则云端没有记录时 update 会 404'],
    ['add', 'remove', 'remove', '新增后删除 → 删除（服务端幂等，未写入时也安全）'],
    ['update', 'add', 'add', '编辑后新增以新增为准'],
    ['update', 'update', 'update', '重复编辑仍是编辑'],
    ['update', 'remove', 'remove', '编辑后删除 → 删除'],
    ['remove', 'add', 'add', '删除后新增以新增为准'],
    ['remove', 'remove', 'remove', '重复删除仍是删除'],
  ];

  for (const [prev, next, expected, why] of cases) {
    it(`${prev} + ${next} → ${expected}（${why}）`, () => {
      expect(coalesceOp(prev, next)).toBe(expected);
    });
  }

  it('remove 恒胜：任何动作叠加删除都以删除收尾', () => {
    for (const prev of ['add', 'update', 'remove'] as SyncOp[]) {
      expect(coalesceOp(prev, 'remove')).toBe('remove');
    }
  });

  it('add 不会被 update 顶掉（守住「首次 add 响应丢失」场景）', () => {
    expect(coalesceOp('add', 'update')).toBe('add');
  });
});

describe('待同步标记：出队', () => {
  it('出队后不再出现在列表里', () => {
    const storage = createStorage();
    queuePendingSync(storage, dietAdd, 1000);

    dequeuePendingSync(storage, 'diet', 'diet-1');

    expect(readPendingSync(storage)).toEqual([]);
  });

  it('重复出队安全（目标已不存在时不报错）', () => {
    const storage = createStorage();

    expect(() => dequeuePendingSync(storage, 'diet', '不存在')).not.toThrow();
  });

  it('代次一致时正常出队', () => {
    const storage = createStorage();
    queuePendingSync(storage, dietAdd, 1000);

    dequeuePendingSync(storage, 'diet', 'diet-1', 1000);

    expect(readPendingSync(storage)).toEqual([]);
  });

  it('代次不一致时保留标记：同步期间用户又改了一次，不能把它一起清掉', () => {
    const storage = createStorage();
    queuePendingSync(storage, dietAdd, 1000);
    // 同步过程中用户再次编辑，标记被重新入队（queuedAt 刷新为 2000）
    queuePendingSync(storage, { ...dietAdd, op: 'update' }, 2000);

    // 推送的是 queuedAt=1000 那一代
    dequeuePendingSync(storage, 'diet', 'diet-1', 1000);

    const items = readPendingSync(storage);
    expect(items).toHaveLength(1);
    expect(items[0].queuedAt).toBe(2000);
  });
});

describe('待同步标记：失败累加与放弃', () => {
  it('失败会累加次数并记录原因', () => {
    const storage = createStorage();
    queuePendingSync(storage, dietAdd, 1000);

    const item = failPendingSync(storage, 'diet', 'diet-1', new Error('网络不可达'));

    expect(item?.attempts).toBe(1);
    expect(item?.lastError).toBe('网络不可达');
  });

  it('非 Error 的失败原因也会被转成字符串', () => {
    const storage = createStorage();
    queuePendingSync(storage, dietAdd, 1000);

    expect(failPendingSync(storage, 'diet', 'diet-1', 'boom')?.lastError).toBe('boom');
  });

  it('目标不存在时返回 null 且不写入', () => {
    const storage = createStorage();

    expect(failPendingSync(storage, 'diet', '不存在', new Error('x'))).toBeNull();
    expect(readPendingSync(storage)).toEqual([]);
  });

  it('代次不一致时不计失败：用户刚重新操作过，不该背上这次失败', () => {
    const storage = createStorage();
    queuePendingSync(storage, dietAdd, 1000);
    queuePendingSync(storage, { ...dietAdd, op: 'update' }, 2000);

    const item = failPendingSync(storage, 'diet', 'diet-1', new Error('x'), 1000);

    expect(item).toBeNull();
    expect(readPendingSync(storage)[0].attempts).toBe(0);
  });

  it('放弃后标记消失（dropPendingSync 与出队同义）', () => {
    const storage = createStorage();
    queuePendingSync(storage, dietAdd, 1000);
    failPendingSync(storage, 'diet', 'diet-1', new Error('x'));

    dropPendingSync(storage, 'diet', 'diet-1', 1000);

    expect(readPendingSync(storage)).toEqual([]);
  });

  it('MAX_SYNC_ATTEMPTS 为 5（方案文档约定的重试上限）', () => {
    expect(MAX_SYNC_ATTEMPTS).toBe(5);
  });
});

describe('待同步标记：持久化健壮性', () => {
  it('空列表写回时直接删键，不留空数组', () => {
    const storage = createStorage();
    storage.setItem(PENDING_SYNC_KEY, '[]');

    writePendingSync(storage, []);

    expect(storage.getItem(PENDING_SYNC_KEY)).toBeNull();
  });

  it('内容损坏时返回空数组，不抛异常', () => {
    const storage = createStorage();
    storage.setItem(PENDING_SYNC_KEY, '{不是 JSON');

    expect(readPendingSync(storage)).toEqual([]);
  });

  it('非法条目被过滤掉，合法条目保留', () => {
    const storage = createStorage();
    storage.setItem(
      PENDING_SYNC_KEY,
      JSON.stringify([
        { domain: 'diet', clientId: 'ok', op: 'add', date: '2026-09-12', attempts: 0, queuedAt: 1 },
        { domain: 'unknown', clientId: 'x', op: 'add', date: '2026-09-12', attempts: 0, queuedAt: 1 },
        { domain: 'diet', clientId: '', op: 'add', date: '2026-09-12', attempts: 0, queuedAt: 1 },
        { domain: 'diet', clientId: 'y', op: 'push', date: '2026-09-12', attempts: 0, queuedAt: 1 },
        null,
      ]),
    );

    expect(readPendingSync(storage).map((item) => item.clientId)).toEqual(['ok']);
  });

  it('clearPendingSync 清空全部标记（退出登录 / 切换家庭用）', () => {
    const storage = createStorage();
    queuePendingSync(storage, dietAdd, 1000);
    queuePendingSync(storage, { ...dietAdd, domain: 'workout' }, 1000);

    clearPendingSync(storage);

    expect(readPendingSync(storage)).toEqual([]);
  });
});

describe('pendingClientIds（供读取合并判断哪条本地记录更新）', () => {
  it('只返回指定 domain 的 id', () => {
    const storage = createStorage();
    queuePendingSync(storage, dietAdd, 1000);
    queuePendingSync(storage, { ...dietAdd, domain: 'workout', clientId: 'workout-1' }, 1000);
    queuePendingSync(storage, { ...dietAdd, clientId: 'diet-2' }, 1000);

    const ids = pendingClientIds(readPendingSync(storage), 'diet');

    expect(ids).toEqual(new Set(['diet-1', 'diet-2']));
  });
});
