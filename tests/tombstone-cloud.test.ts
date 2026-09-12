import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SYNC_DOMAINS } from '@/utils/pendingSync';

const require = createRequire(import.meta.url);
const ROOT = join(__dirname, '..');
const CLOUD = join(ROOT, 'uniCloud-alipay', 'cloudfunctions');

const sharedLib = require('../uniCloud-alipay/cloudfunctions/common/checkin-shared/lib');

function read(path: string): string {
  return readFileSync(join(CLOUD, path), 'utf8');
}

/** 取某个 async 函数的函数体（到下一个顶层 async function 为止） */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  expect(start, `缺少函数 ${name}`).toBeGreaterThanOrEqual(0);

  const rest = source.slice(start);
  const end = rest.indexOf('\nasync function ');
  return end === -1 ? rest : rest.slice(0, end);
}

const CASES = [
  { fn: 'diet', file: 'diet/index.js', remove: 'removeDiet', domain: 'diet' },
  { fn: 'workout', file: 'workout/index.js', remove: 'removeWorkout', domain: 'workout' },
  { fn: 'study', file: 'study/index.js', remove: 'removeCheckin', domain: 'studyCheckin' },
] as const;

describe('三个云函数都接入了墓碑', () => {
  for (const item of CASES) {
    const source = read(item.file);

    it(`${item.fn}：引入共享模块的墓碑读写`, () => {
      expect(source).toContain('recordTombstones');
      expect(source).toContain('listTombstones');
    });

    it(`${item.fn}：提供 listTombstones 路由`, () => {
      expect(source).toContain("case 'listTombstones'");
    });

    it(`${item.fn}：remove 写墓碑，domain 为 ${item.domain}`, () => {
      const body = functionBody(source, item.remove);

      expect(body, `${item.remove} 未写墓碑`).toContain('recordTombstones');
      expect(body).toContain(`domain: '${item.domain}'`);
    });

    /**
     * 这是**最容易写反**的一处：若先写墓碑、后删记录，
     * 一旦删除失败就会「记录复活」—— 别的设备已删本地记录，
     * 而这台设备下次 pull 时云端记录还在。
     */
    it(`${item.fn}：先删记录、后写墓碑（顺序不可颠倒）`, () => {
      const body = functionBody(source, item.remove);
      const removeAt = body.indexOf('.remove()');
      const tombstoneAt = body.indexOf('recordTombstones');

      expect(removeAt, `${item.remove} 未执行删除`).toBeGreaterThanOrEqual(0);
      expect(tombstoneAt, `${item.remove} 未写墓碑`).toBeGreaterThanOrEqual(0);
      expect(removeAt, '墓碑写在了删除之前 —— 删除失败会导致记录复活').toBeLessThan(tombstoneAt);
    });
  }
});

describe('学习计划的级联删除墓碑', () => {
  const source = read('study/index.js');
  const body = functionBody(source, 'removePlan');

  it('为计划本身写墓碑（domain: studyPlan）', () => {
    expect(body).toContain("domain: 'studyPlan'");
  });

  it('为其全部打卡写墓碑（domain: studyCheckin）', () => {
    expect(body).toContain("domain: 'studyCheckin'");
    expect(body, '未收集被删打卡的身份').toContain('collectCheckinRefs');
  });

  /**
   * `where().remove()` 只返回删除条数、拿不到被删文档，
   * 而墓碑需要 clientId —— 所以必须在删除**之前**把打卡身份查出来。
   */
  it('先收集打卡身份、再执行删除（顺序不可颠倒）', () => {
    const collectAt = body.indexOf('collectCheckinRefs');
    const deleteAt = body.indexOf('deleteInBatches');

    expect(collectAt, '未收集打卡身份').toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThanOrEqual(0);
    expect(collectAt, '删除之后再查就什么都没有了').toBeLessThan(deleteAt);
  });

  /**
   * truncated（没删完）时一条墓碑都不写：此时云端仍留着没删完的打卡，
   * 若先写墓碑，别的设备删掉本地打卡后，下次 pull 又会把云端的拉回来（记录复活）。
   */
  it('没删完（truncated）时直接返回重试，不写墓碑', () => {
    const truncatedAt = body.indexOf('cascade.truncated');
    const tombstoneAt = body.indexOf('recordTombstones');

    expect(truncatedAt, '缺少 truncated 保护').toBeGreaterThanOrEqual(0);
    expect(tombstoneAt).toBeGreaterThanOrEqual(0);
    expect(truncatedAt, 'truncated 分支必须排在写墓碑之前').toBeLessThan(tombstoneAt);
  });

  it('打卡墓碑写在删计划之前（计划先没了就定位不到该删哪些打卡）', () => {
    const checkinTombstoneAt = body.indexOf("domain: 'studyCheckin'");
    const removePlanAt = body.indexOf('PLANS).doc(target._id).remove()');

    expect(checkinTombstoneAt).toBeGreaterThanOrEqual(0);
    expect(removePlanAt).toBeGreaterThanOrEqual(0);
    expect(checkinTombstoneAt).toBeLessThan(removePlanAt);
  });
});

describe('domain 两端一致', () => {
  it('云函数用到的 domain 都在前端 SyncDomain 白名单内', () => {
    const used = ['diet', 'workout', 'studyPlan', 'studyCheckin'];

    for (const domain of used) {
      expect(SYNC_DOMAINS, `前端 SyncDomain 缺少 ${domain}`).toContain(domain);
      expect(sharedLib.isTombstoneDomain(domain), `共享模块不认 ${domain}`).toBe(true);
    }
  });

  it('前端 SyncDomain 的每个值，云侧都有对应的写入方', () => {
    const sources = CASES.map((item) => read(item.file)).join('\n') + read('study/index.js');

    for (const domain of SYNC_DOMAINS) {
      expect(sources, `没有任何云函数写 ${domain} 的墓碑`).toContain(`domain: '${domain}'`);
    }
  });
});
