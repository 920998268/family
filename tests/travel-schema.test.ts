import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { TRAVEL_LIMITS } from '@/utils/limits';

// 云函数 lib.js 为 CommonJS 纯逻辑模块，用 createRequire 加载（避免无类型声明的 TS 报错）
const require = createRequire(import.meta.url);
const travelLib = require('../uniCloud-alipay/cloudfunctions/travel/lib');

const ROOT = process.cwd();
const readText = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8');
const readJson = (relativePath: string) =>
  JSON.parse(readText(relativePath)) as {
    bsonType: string;
    required: string[];
    permission: Record<string, boolean>;
    properties: Record<string, { bsonType: string | string[]; title?: string; maxLength?: number }>;
  };

const PLANS_SCHEMA_FILE = 'uniCloud-alipay/database/travels.schema.json';
const ITEMS_SCHEMA_FILE = 'uniCloud-alipay/database/travel_items.schema.json';
const INDEX_FILE = 'uniCloud-alipay/cloudfunctions/travel/index.js';

const plansSchema = readJson(PLANS_SCHEMA_FILE);
const itemsSchema = readJson(ITEMS_SCHEMA_FILE);
const indexSource = readText(INDEX_FILE);

const SCHEMAS = [
  { name: 'travels', file: PLANS_SCHEMA_FILE, schema: plansSchema },
  { name: 'travel_items', file: ITEMS_SCHEMA_FILE, schema: itemsSchema },
];

/** 由云函数在服务端补齐、不由客户端传入的字段 */
const SERVER_FIELDS = ['familyId', 'createdByUid', 'createdAt', 'updatedAt'];

/** 取某个函数的源码块（从函数声明到第一个顶层的 `}` 行） */
function functionBody(name: string): string {
  const body = indexSource.slice(indexSource.indexOf(`async function ${name}(`));
  return body.slice(0, body.indexOf('\n}\n'));
}

/**
 * 取「函数之前的 JSDoc + 函数体」。
 *
 * 注释里写下的约束（例如「这里的 items 不是权威口径」）同样是需要守住的契约，
 * 但对 `toggleItem` 这类断言「不得出现某个词」的用例不能用它 ——
 * 注释里恰恰会把那个词写出来（比如「不重写整个 items 数组」）。
 */
function functionBlock(name: string): string {
  const decl = indexSource.indexOf(`async function ${name}(`);
  const docStart = indexSource.lastIndexOf('/**', decl);
  const block = indexSource.slice(docStart === -1 ? decl : docStart);
  return block.slice(0, block.indexOf('\n}\n'));
}

/** 取 `.update({ ... })` 的写入字段块 */
function updateFields(block: string): string {
  const from = block.indexOf('.update({');
  return block.slice(from, block.indexOf('})', from));
}

describe('出行集合 schema（travels / travel_items）', () => {
  it('两个 schema 都存在且可解析', () => {
    for (const { name, schema } of SCHEMAS) {
      expect(schema.bsonType, `${name} bsonType`).toBe('object');
      expect(schema.properties, `${name} properties`).toBeTruthy();
      expect(schema.properties._id, `${name} 缺少 _id`).toBeTruthy();
    }
  });

  it('permission 全为 false（客户端不可直连，只能走云函数）', () => {
    for (const { name, schema } of SCHEMAS) {
      expect(schema.permission, `${name} 缺少 permission`).toEqual({
        read: false,
        create: false,
        update: false,
        delete: false,
      });
    }
  });

  it('required 含 familyId 与 clientId，且覆盖各自必写字段', () => {
    for (const { name, schema } of SCHEMAS) {
      expect(schema.required, `${name} 缺少 familyId`).toContain('familyId');
      expect(schema.required, `${name} 缺少 clientId`).toContain('clientId');
    }
    expect(plansSchema.required).toEqual(
      expect.arrayContaining([
        'title',
        'startDate',
        'endDate',
        'destination',
        'members',
        'budget',
        'status',
        'note',
      ]),
    );
    expect(itemsSchema.required).toEqual(
      expect.arrayContaining(['travelId', 'order', 'time', 'activity', 'note', 'done']),
    );
  });

  it('createdAt 为毫秒时间戳', () => {
    for (const { name, schema } of SCHEMAS) {
      expect(schema.properties.createdAt.bsonType, `${name}.createdAt`).toBe('timestamp');
      expect(schema.properties.createdAt.title, `${name}.createdAt 应写明毫秒`).toContain('毫秒');
      expect(schema.properties.updatedAt.bsonType, `${name}.updatedAt`).toBe('timestamp');
    }
  });

  it('⚠️ 可空文本字段必须是 string（不可为 null）', () => {
    // 落 null 会让前端 validateTravelPlan 判非法，整条计划被 TravelRepository 静默丢弃
    expect(plansSchema.properties.destination.bsonType).toBe('string');
    expect(plansSchema.properties.note.bsonType).toBe('string');
    expect(itemsSchema.properties.time.bsonType).toBe('string');
    expect(itemsSchema.properties.note.bsonType).toBe('string');
  });

  it('布尔字段声明为 bool', () => {
    expect(itemsSchema.properties.done.bsonType).toBe('bool');
  });

  it('travels.members 是数组（M2 所有集合都是标量字段，本期唯一一个数组字段）', () => {
    expect(plansSchema.properties.members.bsonType).toBe('array');
    expect(plansSchema.properties.members.title).toContain('去重');
  });

  it('数值字段同时声明 int / double（兼容驱动落库形式）', () => {
    expect(plansSchema.properties.budget.bsonType).toEqual(['int', 'double']);
    expect(itemsSchema.properties.order.bsonType).toEqual(['int', 'double']);
  });

  it('travel_items.travelId 是必填的 64 位字符串（主从约束的锚点）', () => {
    expect(itemsSchema.required).toContain('travelId');
    expect(itemsSchema.properties.travelId.bsonType).toBe('string');
    expect(itemsSchema.properties.travelId.maxLength).toBe(64);
    expect(itemsSchema.properties.travelId.title).toContain('不可修改');
  });

  it('日期字段是 10 位字符串', () => {
    expect(plansSchema.properties.startDate.maxLength).toBe(10);
    expect(plansSchema.properties.endDate.maxLength).toBe(10);
  });

  it('⚠️ travels 声明的是 members（复数数组），不是 memberId', () => {
    // 这条断言是**有意的**：哪天出行计划改成单一归属成员，这里会失败，
    // 逼人回来同步 schema、lib、云函数与前端模型
    expect(plansSchema.properties).not.toHaveProperty('memberId');
    expect(plansSchema.properties).toHaveProperty('members');
  });
});

describe('落库字段 ↔ schema 一致性（防止代码与 schema 漂移）', () => {
  it('travels：云函数写入的字段全部已在 schema 中声明', () => {
    const value = travelLib.validatePlanPayload({
      clientId: 'travel-1',
      title: '周末露营',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      destination: '莫干山',
      members: ['member-1'],
      budget: 1200,
      status: 'planned',
      note: '记得带帐篷',
    }).value;

    const declared = Object.keys(plansSchema.properties);
    for (const key of [...Object.keys(value), ...SERVER_FIELDS]) {
      expect(declared, `${PLANS_SCHEMA_FILE} 缺少字段 ${key}`).toContain(key);
    }
  });

  it('travel_items：云函数写入的字段全部已在 schema 中声明', () => {
    const value = travelLib.validateItemPayload({
      clientId: 'trip-1',
      travelId: 'travel-1',
      order: 0,
      time: '上午 9:00',
      activity: '出发',
      note: '集合点：小区东门',
      done: false,
    }).value;

    const declared = Object.keys(itemsSchema.properties);
    for (const key of [...Object.keys(value), ...SERVER_FIELDS]) {
      expect(declared, `${ITEMS_SCHEMA_FILE} 缺少字段 ${key}`).toContain(key);
    }
  });

  it('schema 的 maxLength 与 lib 的上限一致', () => {
    expect(plansSchema.properties.clientId.maxLength).toBe(travelLib.CLIENT_ID_MAX);
    expect(plansSchema.properties.title.maxLength).toBe(travelLib.TITLE_MAX);
    expect(plansSchema.properties.destination.maxLength).toBe(travelLib.DESTINATION_MAX);
    expect(plansSchema.properties.note.maxLength).toBe(travelLib.NOTE_MAX);
    expect(itemsSchema.properties.clientId.maxLength).toBe(travelLib.CLIENT_ID_MAX);
    expect(itemsSchema.properties.time.maxLength).toBe(travelLib.ITEM_TIME_MAX);
    expect(itemsSchema.properties.activity.maxLength).toBe(travelLib.ITEM_ACTIVITY_MAX);
    expect(itemsSchema.properties.note.maxLength).toBe(travelLib.ITEM_NOTE_MAX);
  });

  it('⚠️ schema 的 maxLength 还必须对上「前端上限表」（只对 lib 会漏掉两端一起漂移）', () => {
    // 与 `meal-schema.test.ts` 同源守卫：只校验 schema === lib 时，
    // 「schema 与 lib 一起被改错」是检测不到的（见 M3 第 4 步变异验证 M6）。
    // 前端上限表 TRAVEL_LIMITS 已被 `ui-limits.test.ts` 锁死在 lib 上（含区间守卫），
    // 补上「schema ↔ 前端表」这第三条边后，任意一边单独漂移都会失败。
    expect(plansSchema.properties.title.maxLength).toBe(TRAVEL_LIMITS.title);
    expect(plansSchema.properties.destination.maxLength).toBe(TRAVEL_LIMITS.destination);
    expect(plansSchema.properties.note.maxLength).toBe(TRAVEL_LIMITS.note);
    expect(itemsSchema.properties.time.maxLength).toBe(TRAVEL_LIMITS.itemTime);
    expect(itemsSchema.properties.activity.maxLength).toBe(TRAVEL_LIMITS.itemActivity);
    expect(itemsSchema.properties.note.maxLength).toBe(TRAVEL_LIMITS.itemNote);
  });

  it('⚠️ schema 不能比 lib 更严（更严会拒掉 lib 认可的合法记录）', () => {
    // clientId 不在前端上限表里（长度由 createId() 决定、前端也没有 maxlength 能约束它），
    // 所以用方向性断言兜底；绝对数值由 ui-limits 的 toBe(64) 钉住。
    for (const [label, schema, field, limit] of [
      ['travels', plansSchema, 'clientId', travelLib.CLIENT_ID_MAX],
      ['travels', plansSchema, 'title', travelLib.TITLE_MAX],
      ['travels', plansSchema, 'destination', travelLib.DESTINATION_MAX],
      ['travels', plansSchema, 'note', travelLib.NOTE_MAX],
      ['travel_items', itemsSchema, 'clientId', travelLib.CLIENT_ID_MAX],
      ['travel_items', itemsSchema, 'time', travelLib.ITEM_TIME_MAX],
      ['travel_items', itemsSchema, 'activity', travelLib.ITEM_ACTIVITY_MAX],
      ['travel_items', itemsSchema, 'note', travelLib.ITEM_NOTE_MAX],
    ] as const) {
      expect(
        schema.properties[field].maxLength,
        `${label}.${field} 上限比 lib 更严，合法记录会被拒`,
      ).toBeGreaterThanOrEqual(limit);
    }
  });
});

describe('travel 云函数越权防护（源码级守卫）', () => {
  it('不允许从客户端入参读取 familyId（必须由服务端推导）', () => {
    const dangerous = /\b(event|evt|payload|input|body)\s*\.\s*familyId\b/;
    expect(dangerous.test(indexSource), '直接从客户端入参取了 familyId').toBe(false);
  });

  it('必须调用 resolveContext 获取家庭归属', () => {
    expect(indexSource.includes('resolveContext(')).toBe(true);
  });

  it('定位记录必须按 familyId + clientId', () => {
    expect(indexSource).toContain('where({ familyId, clientId })');
  });

  it('十个 action 分支齐备', () => {
    for (const action of [
      'listPlans',
      'addPlan',
      'updatePlan',
      'removePlan',
      'listItems',
      'addItem',
      'updateItem',
      'toggleItem',
      'removeItem',
      'listTombstones',
    ]) {
      expect(indexSource, `缺少 ${action} 分支`).toContain(`case '${action}':`);
    }
  });
});

describe('行程明细的主从约束', () => {
  it('新增明细前必须校验计划存在且属于本家庭', () => {
    // 缺了它就能给不存在的计划塞明细 —— 明细会永远渲染不出来（孤儿）
    expect(indexSource).toContain('未找到该出行计划');
    expect(functionBody('addItem')).toContain('findPlan(familyId');
  });

  it('按计划拉取明细（明细的权威读取口径，天然有界）', () => {
    expect(functionBody('listItems')).toContain('where({ familyId, travelId: query.value.travelId })');
    expect(indexSource).toContain('validateItemQuery(');
  });

  it('⚠️ 已单列的明细不许改挂到别的计划（travelId 不参与更新）', () => {
    // 换计划会让「按计划拉取」的两个端点都看不到它，等于凭空消失
    const fields = updateFields(functionBody('updateItem'));
    expect(fields).not.toMatch(/^\s*travelId:/m);
    expect(readText('uniCloud-alipay/cloudfunctions/travel/lib.js')).toContain(
      'travelId: base.travelId',
    );
  });

  it('⚠️ toggleItem 只写 done（记录级），不整包重写 items 数组', () => {
    // 这是「两人同时勾选不同明细不互相覆盖」的实现基础
    const fields = updateFields(functionBody('toggleItem'));

    expect(fields).toContain('done:');
    expect(fields).not.toMatch(/^\s*(order|time|activity|note|travelId|clientId):/m);
    expect(functionBody('toggleItem')).not.toContain('items');
  });

  it('列表聚合的 items 不算权威口径（已在源码里写明，防止被误用做「缺失即删除」判定）', () => {
    expect(functionBlock('listPlans')).toContain('listItems(travelId)');
    expect(indexSource).toContain('不是明细的权威口径');
  });
});

describe('出行计划的级联删除（孤儿明细防线）', () => {
  it('先删明细、再删计划（顺序反了会留下永久孤儿）', () => {
    const cascadeIndex = indexSource.indexOf('deleteInBatches(');
    const removePlanIndex = indexSource.indexOf('collection(PLANS).doc(target._id).remove()');

    expect(cascadeIndex, '未使用 deleteInBatches 做级联删除').toBeGreaterThan(-1);
    expect(removePlanIndex, '未删除计划本身').toBeGreaterThan(-1);
    expect(cascadeIndex, '必须先删明细、再删计划').toBeLessThan(removePlanIndex);
  });

  it('删除前先收集明细身份（remove 只返回条数，拿不到 clientId）', () => {
    const collectIndex = indexSource.indexOf('collectItemRefs(');
    const deleteIndex = indexSource.indexOf('.where({ familyId, travelId: target.clientId })');

    expect(collectIndex, '未收集明细身份').toBeGreaterThan(-1);
    expect(collectIndex, '收集必须发生在删除之前').toBeLessThan(deleteIndex);
  });

  it('未删完时不删计划，返回可重试的失败', () => {
    // 带着未删完的明细删掉计划 = 永久孤儿；重试能继续删（每轮都有进展）
    expect(indexSource).toContain('cascade.truncated');
    expect(indexSource).toMatch(/truncated[\s\S]{0,200}?code:\s*500/);
  });

  it('墓碑顺序：先 travelItem 后 travelPlan（计划先没就失去了该删哪些明细的依据）', () => {
    const itemTombstone = indexSource.indexOf("domain: 'travelItem'");
    const planTombstone = indexSource.indexOf("domain: 'travelPlan'");
    const removePlan = indexSource.indexOf('collection(PLANS).doc(target._id).remove()');

    expect(itemTombstone, '未写 travelItem 墓碑').toBeGreaterThan(-1);
    expect(planTombstone, '未写 travelPlan 墓碑').toBeGreaterThan(-1);
    expect(itemTombstone, 'travelItem 墓碑必须早于 travelPlan 墓碑').toBeLessThan(planTombstone);
    expect(planTombstone, 'travelPlan 墓碑必须晚于删计划').toBeGreaterThan(removePlan);
  });

  it('唯一索引冲突必须转成 duplicated，不把 provider 错误码抛给前端', () => {
    expect(indexSource).toContain('isDuplicateKeyError(');
    expect(indexSource).toMatch(/isDuplicateKeyError\(e\)[\s\S]{0,220}?duplicated:\s*true/);
  });

  it('删除明细是幂等的（不存在也返回成功）', () => {
    expect(indexSource).toMatch(/removed:\s*!!target/);
  });

  it('listTombstones 一次返回 travelPlan + travelItem 两类', () => {
    expect(indexSource).toContain("domains: ['travelPlan', 'travelItem']");
  });
});
