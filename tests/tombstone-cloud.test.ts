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

/**
 * 取 `if (target) { ... }` 的整块（含标记）。
 *
 * 用大括号配对而不是正则：块里有嵌套的 `{}`（对象字面量、回调），正则会提前截断。
 * ⚠️ 也不能用 `indexOf` 比较先后 —— 把墓碑塞进 `if (target)` 的**末尾**，
 * `indexOf` 依旧排在 `if (target) {` 之后，断言会假通过。必须真的把块切出来。
 */
function ifTargetBlock(source: string): string {
  const start = source.indexOf('if (target) {');
  if (start < 0) throw new Error('未找到 if (target) {');

  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('if (target) 的大括号不配对');
}

const CASES = [
  { fn: 'diet', file: 'diet/index.js', remove: 'removeDiet', domain: 'diet' },
  { fn: 'workout', file: 'workout/index.js', remove: 'removeWorkout', domain: 'workout' },
  { fn: 'study', file: 'study/index.js', remove: 'removeCheckin', domain: 'studyCheckin' },
  // M3 第 6 步新增：食谱与行程明细。两者都是「先删记录、后写墓碑、无条件写」。
  { fn: 'meal', file: 'meal/index.js', remove: 'removeMeal', domain: 'mealPlan' },
  { fn: 'travel', file: 'travel/index.js', remove: 'removeItem', domain: 'travelItem' },
  // M4 第 6 步新增：账本（与 meal 同构：单表、按日期分区、先删后写墓碑）
  { fn: 'ledger', file: 'ledger/index.js', remove: 'removeTransaction', domain: 'transaction' },
] as const;

describe('五个云函数都接入了墓碑', () => {
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

describe('出行计划的级联删除墓碑', () => {
  const source = read('travel/index.js');
  const body = functionBody(source, 'removePlan');

  it('为计划本身写墓碑（domain: travelPlan）', () => {
    expect(body).toContain("domain: 'travelPlan'");
  });

  it('为其全部明细写墓碑（domain: travelItem）', () => {
    expect(body).toContain("domain: 'travelItem'");
    expect(body, '未收集被删明细的身份').toContain('collectItemRefs');
  });

  /**
   * `where().remove()` 只返回删除条数、拿不到被删文档，而墓碑需要 clientId ——
   * 所以必须在删除**之前**把明细身份查出来。
   */
  it('先收集明细身份、再执行删除（顺序不可颠倒）', () => {
    const collectAt = body.indexOf('collectItemRefs');
    const deleteAt = body.indexOf('deleteInBatches');

    expect(collectAt, '未收集明细身份').toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThanOrEqual(0);
    expect(collectAt, '删除之后再查就什么都没有了').toBeLessThan(deleteAt);
  });

  /** truncated（没删完）时一条墓碑都不写：云端仍留着明细，先写墓碑会造成「记录复活」 */
  it('没删完（truncated）时直接返回重试，不写墓碑', () => {
    const truncatedAt = body.indexOf('cascade.truncated');
    const tombstoneAt = body.indexOf("domain: 'travelItem'");

    expect(truncatedAt, '缺少 truncated 保护').toBeGreaterThanOrEqual(0);
    expect(tombstoneAt).toBeGreaterThanOrEqual(0);
    expect(truncatedAt, 'truncated 分支必须排在写明细墓碑之前').toBeLessThan(tombstoneAt);
  });

  /**
   * 计划墓碑必须写在 `if (target)` **之外**（0.3.4 §3.2）。
   *
   * 「计划已删、写墓碑失败」时客户端会重试，重试时 `findPlan` 已经找不到记录了 ——
   * 若墓碑写在 `if (target)` 里面，这条墓碑**永远补不上**，
   * 别的设备的本地副本不会消失，还有被再次推上去复活的风险。
   */
  it('⚠️ 计划墓碑写在 if (target) 之外（否则重试补不上）', () => {
    const guarded = ifTargetBlock(body);

    // 明细墓碑与级联删除**必须**在守卫内（只有计划存在时才有明细可删）
    expect(guarded, '明细墓碑应在 if (target) 内').toContain("domain: 'travelItem'");

    // 计划墓碑**必须**在守卫外：塞进去的话，「计划已删、墓碑写失败 → 客户端重试」
    // 这条唯一能补写的路径就永远走不到了。
    expect(guarded, '⚠️ 计划墓碑被塞进了 if (target) 里 —— 重试永远补不上').not.toContain(
      "domain: 'travelPlan'",
    );
    expect(body, '计划墓碑缺失').toContain("domain: 'travelPlan'");
  });
});

describe('domain 两端一致', () => {
  it('云函数用到的 domain 都在前端 SyncDomain 白名单内', () => {
    const used = [
      'diet',
      'workout',
      'studyPlan',
      'studyCheckin',
      'mealPlan',
      'travelPlan',
      'travelItem',
      'transaction',
    ];

    for (const domain of used) {
      expect(SYNC_DOMAINS, `前端 SyncDomain 缺少 ${domain}`).toContain(domain);
      expect(sharedLib.isTombstoneDomain(domain), `共享模块不认 ${domain}`).toBe(true);
    }
  });

  /**
   * ⚠️ 这条是 M4 第 6 步新增**最该有**的一条：把「云函数源码里真实写出的 domain」
   * 与「前端白名单」直接对齐。
   *
   * 为什么不能只用 `CASES` 对齐：`CASES` 里每个云函数只列了**一个** `remove` 函数
   * （为的是验证「先删记录、后写墓碑、墓碑无条件写」那套顺序），
   * 所以只覆盖 6 个 domain —— `studyPlan` / `travelPlan` 是由级联删除的
   * `removePlan` 写的，另有专门的 describe 守着。用 `CASES` 对齐会误报。
   *
   * 这条断言的两个方向都有意义：
   * - 白名单里有、源码里没写 → 那类删除永远不传播（漏加了写入方）；
   * - 源码里写了、白名单里没有 → `buildTombstoneDocs` 静默返回 `[]`，
   *   正是 M3 第 6 步踩过的那个坑。
   */
  it('⚠️ 云函数源码写出的 domain 集合，与前端白名单逐值相等', () => {
    const sources = [...CASES.map((item) => read(item.file)), read('study/index.js'), read('travel/index.js')].join('\n');
    const written = new Set(
      [...sources.matchAll(/domain:\s*'([A-Za-z]+)'/g)].map((match) => match[1]),
    );

    expect([...written].sort()).toEqual([...SYNC_DOMAINS].sort());
  });

  it('前端 SyncDomain 的每个值，云侧都有对应的写入方', () => {
    const sources = CASES.map((item) => read(item.file)).join('\n');

    for (const domain of SYNC_DOMAINS) {
      expect(sources, `没有任何云函数写 ${domain} 的墓碑`).toContain(`domain: '${domain}'`);
    }
  });

  /**
   * ⚠️ 白名单是**全有或全无**的：`buildTombstoneDocs` 对未知 domain 返回 `[]`、
   * `listTombstones` 又把 domains 过滤成空 —— 少一个 domain，那类删除就
   * 「删成功、墓碑不写、也拉不到」，全程无报错。
   *
   * 两端数量必须相等，且逐值相等（不是只对个数）。
   */
  it('⚠️ 前端白名单与云侧白名单逐值相等（个数 + 顺序无关，集合相等）', () => {
    const cloud = [...sharedLib.TOMBSTONE_DOMAINS].sort();
    const front = [...SYNC_DOMAINS].sort();

    expect(front, '前端与云侧 domain 白名单不一致 —— 差的那些会静默不传播').toEqual(cloud);
  });
});
