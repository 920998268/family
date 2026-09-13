import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { MEAL_LIMITS } from '@/utils/limits';

// 云函数 lib.js 为 CommonJS 纯逻辑模块，用 createRequire 加载（避免无类型声明的 TS 报错）
const require = createRequire(import.meta.url);
const mealLib = require('../uniCloud-alipay/cloudfunctions/meal/lib');

const ROOT = process.cwd();
const readText = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8');
const readJson = (relativePath: string) =>
  JSON.parse(readText(relativePath)) as {
    bsonType: string;
    required: string[];
    permission: Record<string, boolean>;
    properties: Record<string, { bsonType: string | string[]; title?: string; maxLength?: number }>;
  };

const SCHEMA_FILE = 'uniCloud-alipay/database/meal_plans.schema.json';
const INDEX_FILE = 'uniCloud-alipay/cloudfunctions/meal/index.js';
const schema = readJson(SCHEMA_FILE);
const indexSource = readText(INDEX_FILE);

/** 由云函数在服务端补齐、不由客户端传入的字段 */
const SERVER_FIELDS = ['familyId', 'createdByUid', 'createdAt', 'updatedAt'];

describe('meal_plans schema', () => {
  it('文件存在、可解析、有 properties 与 _id', () => {
    expect(schema.bsonType).toBe('object');
    expect(schema.properties).toBeTruthy();
    expect(schema.properties._id).toBeTruthy();
  });

  it('permission 全为 false（客户端不可直连，只能走云函数）', () => {
    expect(schema.permission).toEqual({
      read: false,
      create: false,
      update: false,
      delete: false,
    });
  });

  it('required 覆盖全部必写字段', () => {
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'familyId',
        'clientId',
        'date',
        'slot',
        'dishName',
        'ingredients',
        'cook',
        'done',
        'note',
      ]),
    );
  });

  it('createdAt / updatedAt 为毫秒时间戳', () => {
    expect(schema.properties.createdAt.bsonType).toBe('timestamp');
    expect(schema.properties.updatedAt.bsonType).toBe('timestamp');
    expect(schema.properties.createdAt.title).toContain('毫秒');
  });

  it('⚠️ 三个可空文本字段必须是 string（不可为 null）', () => {
    // 落 null 会让前端 validateMealPlan（要求 ingredients/cook/note 是字符串）判非法，
    // 整条记录被 MealPlanRepository 静默丢弃 —— 本地写入却是成功的
    expect(schema.properties.ingredients.bsonType).toBe('string');
    expect(schema.properties.cook.bsonType).toBe('string');
    expect(schema.properties.note.bsonType).toBe('string');
  });

  it('done 是布尔、date 是 10 位字符串', () => {
    expect(schema.properties.done.bsonType).toBe('bool');
    expect(schema.properties.date.bsonType).toBe('string');
    expect(schema.properties.date.maxLength).toBe(10);
  });

  it('不声明 memberId（前端 MealPlan 没有该字段，「掌勺人」是可自由填写的文本）', () => {
    // 这条断言是**有意的**：哪天 MealPlan 真的加了 memberId，这里会失败，
    // 逼人回来同步 schema、lib 与云函数（而不是让字段悄悄漂移）
    expect(schema.properties).not.toHaveProperty('memberId');
  });
});

describe('落库字段 ↔ schema 一致性（防止代码与 schema 漂移）', () => {
  it('云函数写入的字段全部已在 schema 中声明', () => {
    const value = mealLib.validateMealPayload({
      clientId: 'meal-1',
      date: '2026-09-13',
      slot: 'dinner',
      dishName: '番茄炒蛋',
      ingredients: '番茄、鸡蛋',
      cook: '妈妈',
      done: false,
      note: '少放盐',
    }).value;

    const declared = Object.keys(schema.properties);
    for (const key of [...Object.keys(value), ...SERVER_FIELDS]) {
      expect(declared, `${SCHEMA_FILE} 缺少字段 ${key}`).toContain(key);
    }
  });

  it('schema 的 maxLength 与 lib 的上限一致', () => {
    expect(schema.properties.clientId.maxLength).toBe(mealLib.CLIENT_ID_MAX);
    expect(schema.properties.dishName.maxLength).toBe(mealLib.DISH_NAME_MAX);
    expect(schema.properties.ingredients.maxLength).toBe(mealLib.INGREDIENTS_MAX);
    expect(schema.properties.cook.maxLength).toBe(mealLib.COOK_MAX);
    expect(schema.properties.note.maxLength).toBe(mealLib.NOTE_MAX);
  });

  it('⚠️ schema 的 maxLength 还必须对上「前端上限表」（只对 lib 会漏掉两端一起漂移）', () => {
    // 这条是 M3 第 4 步变异验证（M6）抓出来的缺口：
    // 上一条断言只校验 schema === lib，若把 schema 的 ingredients 改成 50、
    // lib 仍是 200，两边「一致」了，上一条照样通过 —— 但用户能在前端输入 200 字，
    // 推云端被 schema 拒掉，记录永久留在本地且不报错。
    //
    // 前端上限表 MEAL_LIMITS 已被 `ui-limits.test.ts` 锁死在 lib 上（含区间守卫），
    // 所以这里补上「schema ↔ 前端表」这第三条边，三角闭合：
    // 改 schema、改 lib、改前端表，任意一边单独漂移都会失败。
    expect(schema.properties.dishName.maxLength).toBe(MEAL_LIMITS.dishName);
    expect(schema.properties.ingredients.maxLength).toBe(MEAL_LIMITS.ingredients);
    expect(schema.properties.cook.maxLength).toBe(MEAL_LIMITS.cook);
    expect(schema.properties.note.maxLength).toBe(MEAL_LIMITS.note);
  });

  it('⚠️ schema 不能比 lib 更严（更严会拒掉 lib 认可的合法记录）', () => {
    // clientId 不在前端上限表里（它的长度由 createId() 决定、前端也没有 maxlength
    // 能约束它），所以用一个方向性断言兜底：schema 更严 = 静默丢数据；
    // schema 更松只是少了一层防线，不阻塞。绝对数值由 ui-limits 的 toBe(64) 钉住。
    for (const [field, limit] of [
      ['clientId', mealLib.CLIENT_ID_MAX],
      ['dishName', mealLib.DISH_NAME_MAX],
      ['ingredients', mealLib.INGREDIENTS_MAX],
      ['cook', mealLib.COOK_MAX],
      ['note', mealLib.NOTE_MAX],
    ] as const) {
      expect(
        schema.properties[field].maxLength,
        `${SCHEMA_FILE} 的 ${field} 上限比 lib 更严，合法记录会被拒`,
      ).toBeGreaterThanOrEqual(limit);
    }
  });
});

describe('meal 云函数越权防护（源码级守卫）', () => {
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

  it('不涉及 memberId（食谱没有归属成员字段）', () => {
    // 前端 MealPlan 没有 memberId：「掌勺人」cook 是可自由填写的文本，不是成员 id。
    // 所以本云函数不该出现 resolveMemberId 调用或 memberId 字段写入
    expect(indexSource).not.toContain('resolveMemberId(');
    expect(indexSource).not.toMatch(/memberId\s*:/);
  });

  it('路由齐备：list / add / update / remove / listTombstones', () => {
    for (const action of ['list', 'add', 'update', 'remove', 'listTombstones']) {
      expect(indexSource, `缺少 ${action} 分支`).toContain(`case '${action}':`);
    }
  });

  it('按日期查询（食谱的读取口径就是「某一天」）', () => {
    expect(indexSource).toContain('validateMealQuery(');
    expect(indexSource).toContain('where({ familyId, date: query.value.date })');
  });
});

describe('meal 的删除与墓碑', () => {
  it('先删记录、再写墓碑（顺序反了会造成记录复活）', () => {
    const removeIndex = indexSource.indexOf('collection(MEALS).doc(target._id).remove()');
    const tombstoneIndex = indexSource.indexOf("domain: 'mealPlan'");

    expect(removeIndex, '未删除记录本身').toBeGreaterThan(-1);
    expect(tombstoneIndex, '未写 mealPlan 墓碑').toBeGreaterThan(-1);
    expect(removeIndex, '必须先删记录、再写墓碑').toBeLessThan(tombstoneIndex);
  });

  it('⚠️ 墓碑写入必须在 if (target) 之外（记录不存在也要写，便于重试补写）', () => {
    const body = indexSource.slice(indexSource.indexOf('async function removeMeal('));
    const block = body.slice(0, body.indexOf('\n}\n'));
    const ifBlock = block.match(/if \(target\) \{([\s\S]*?)\n {2}\}/);

    expect(block).toContain('recordTombstones(');
    expect(ifBlock, '未找到 if (target) 块').toBeTruthy();
    expect(ifBlock?.[1], '墓碑不能塞进 if (target) 里').not.toContain('recordTombstones');
  });

  it('墓碑带上日期（本地按日期分区存储，带上就能直接定位分区）', () => {
    expect(indexSource).toContain('(target && target.date)');
  });

  it('删除是幂等的（记录不存在也返回成功）', () => {
    // 返回 404 会让离线队列把已删成功的记录当成失败而无限重试
    expect(indexSource).toMatch(/removed:\s*!!target/);
  });

  it('listTombstones 只拉 mealPlan 一类', () => {
    expect(indexSource).toContain("domains: ['mealPlan']");
  });
});

describe('meal 的更新不许改 date', () => {
  it('updateMeal 的写入字段里不含 date', () => {
    const body = indexSource.slice(indexSource.indexOf('async function updateMeal('));
    const block = body.slice(0, body.indexOf('\n}\n'));
    const updateCall = block.slice(block.indexOf('.update('));

    expect(updateCall, 'update 不应写入 date（前端 MealPatch 不含 date，改了记录会在按日期拉取时凭空消失）').not.toMatch(
      /^\s*date:/m,
    );
  });

  it('mergeMealPatch 里 date 取自 base 而非 patch（与上一条互为正反面）', () => {
    const libSource = readText('uniCloud-alipay/cloudfunctions/meal/lib.js');
    const body = libSource.slice(libSource.indexOf('function mergeMealPatch('));

    expect(body).toContain('date: base.date');
  });
});
