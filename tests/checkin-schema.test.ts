import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const dietLib = require('../uniCloud-alipay/cloudfunctions/diet/lib');
const workoutLib = require('../uniCloud-alipay/cloudfunctions/workout/lib');

const ROOT = process.cwd();

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
}

const dietsSchema = readJson('uniCloud-alipay/database/diets.schema.json');
const workoutsSchema = readJson('uniCloud-alipay/database/workouts.schema.json');
const foodsSchema = readJson('uniCloud-alipay/database/favorite_foods.schema.json');

/** 由云函数在服务端补齐、不由客户端传入的字段 */
const SERVER_FIELDS = ['familyId', 'createdByUid', 'createdAt', 'updatedAt'];

const SCHEMAS = [
  { name: 'diets', schema: dietsSchema },
  { name: 'workouts', schema: workoutsSchema },
  { name: 'favorite_foods', schema: foodsSchema },
];

describe('打卡集合 schema', () => {
  it('三个 schema 文件都存在且可解析', () => {
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

  it('required 含 familyId，且 diets/workouts 含 clientId', () => {
    expect(dietsSchema.required).toContain('familyId');
    expect(dietsSchema.required).toContain('clientId');
    expect(workoutsSchema.required).toContain('familyId');
    expect(workoutsSchema.required).toContain('clientId');
    expect(foodsSchema.required).toContain('familyId');
  });

  it('familyId 字段无客户端写入入口（permission 已全关）', () => {
    for (const { name, schema } of SCHEMAS) {
      expect(schema.properties.familyId.bsonType, `${name}.familyId`).toBe('string');
    }
  });
});

describe('落库字段 ↔ schema 一致性（防止代码与 schema 漂移）', () => {
  it('diets：云函数写入的字段全部已在 schema 中声明', () => {
    const value = dietLib.validateDietPayload({
      clientId: 'diet-1',
      date: '2026-09-11',
      mealType: 'lunch',
      foodName: '鸡胸肉',
      quantity: '200g',
      calories: 300,
    }).value;

    const declared = Object.keys(dietsSchema.properties);
    for (const key of [...Object.keys(value), ...SERVER_FIELDS]) {
      expect(declared, `diets.schema.json 缺少字段 ${key}`).toContain(key);
    }
  });

  it('workouts：云函数写入的字段全部已在 schema 中声明', () => {
    const value = workoutLib.validateWorkoutPayload({
      clientId: 'workout-1',
      date: '2026-09-11',
      category: 'strength',
      exerciseName: '卧推',
      sets: [{ id: 'set-1', order: 1, reps: 8, weightKg: 60 }],
    }).value;

    const declared = Object.keys(workoutsSchema.properties);
    for (const key of [...Object.keys(value), ...SERVER_FIELDS]) {
      expect(declared, `workouts.schema.json 缺少字段 ${key}`).toContain(key);
    }
  });

  it('favorite_foods：云函数写入的字段全部已在 schema 中声明', () => {
    const value = dietLib.validateFoodCollect({
      foodName: '牛奶',
      quantity: '1 杯',
      calories: 150,
    }).value;

    const declared = Object.keys(foodsSchema.properties);
    // 收集函数产出 name/quantity/营养；其余由云函数补齐
    for (const key of [
      ...Object.keys(value),
      ...SERVER_FIELDS,
      'useCount',
      'lastUsedAt',
    ]) {
      expect(declared, `favorite_foods.schema.json 缺少字段 ${key}`).toContain(key);
    }
  });

  it('有氧专属字段已在 workouts schema 中声明', () => {
    const value = workoutLib.validateWorkoutPayload({
      clientId: 'workout-2',
      date: '2026-09-11',
      category: 'cardio',
      exerciseName: '跑步',
      durationMin: 30,
      distanceKm: 5.2,
    }).value;

    const declared = Object.keys(workoutsSchema.properties);
    for (const key of Object.keys(value)) {
      expect(declared, `workouts.schema.json 缺少字段 ${key}`).toContain(key);
    }
  });
});

describe('云函数越权防护（源码级守卫）', () => {
  const INDEX_FILES = ['uniCloud-alipay/cloudfunctions/diet/index.js', 'uniCloud-alipay/cloudfunctions/workout/index.js'];

  it('不允许从客户端入参读取 familyId（必须由服务端推导）', () => {
    const dangerous = /\b(event|evt|payload|input|body)\s*\.\s*familyId\b/;
    for (const file of INDEX_FILES) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(dangerous.test(source), `${file} 直接从客户端入参取了 familyId`).toBe(false);
    }
  });

  it('必须调用 resolveContext 获取家庭归属', () => {
    for (const file of INDEX_FILES) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source.includes('resolveContext('), `${file} 未调用 resolveContext`).toBe(true);
    }
  });

  it('必须校验打卡成员归属（resolveMemberId）', () => {
    for (const file of INDEX_FILES) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source.includes('resolveMemberId('), `${file} 未校验 memberId 归属`).toBe(true);
    }
  });

  it('删除操作必须按 familyId + clientId 定位记录', () => {
    for (const file of INDEX_FILES) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source.includes('where({ familyId, clientId })'), `${file} 未按家庭+clientId 定位`).toBe(
        true,
      );
    }
  });
});

describe('buildDateWhere（列表查询条件构造）', () => {
  const dbCmd = {
    gte: (value: unknown) => ({
      op: 'gte',
      value,
      and: (other: unknown) => ({ op: 'and', left: { op: 'gte', value }, right: other }),
    }),
    lte: (value: unknown) => ({ op: 'lte', value }),
  };

  it('单日查询直接等值匹配', () => {
    expect(dietLib.buildDateWhere(dbCmd, { date: '2026-09-11' })).toEqual({
      date: '2026-09-11',
    });
    expect(workoutLib.buildDateWhere(dbCmd, { date: '2026-09-11' })).toEqual({
      date: '2026-09-11',
    });
  });

  it('区间查询组合 gte + lte', () => {
    expect(dietLib.buildDateWhere(dbCmd, { from: '2026-09-01', to: '2026-09-11' })).toMatchObject({
      date: {
        op: 'and',
        left: { op: 'gte', value: '2026-09-01' },
        right: { op: 'lte', value: '2026-09-11' },
      },
    });
  });

  it('只给单边时退化为 gte / lte', () => {
    // 桩对象的 gte/lte 自带 and 方法，故用 toMatchObject 只校验关键字段
    expect(dietLib.buildDateWhere(dbCmd, { from: '2026-09-01' })).toMatchObject({
      date: { op: 'gte', value: '2026-09-01' },
    });
    expect(dietLib.buildDateWhere(dbCmd, { to: '2026-09-11' })).toMatchObject({
      date: { op: 'lte', value: '2026-09-11' },
    });
  });
});

describe('escapeRegExp（模糊匹配转义）', () => {
  it('普通中文不受影响', () => {
    expect(dietLib.escapeRegExp('牛奶')).toBe('牛奶');
  });

  it('转义正则元字符', () => {
    expect(dietLib.escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
    expect(dietLib.escapeRegExp('(x)[y]{2}')).toBe('\\(x\\)\\[y\\]\\{2\\}');
  });

  it('非字符串返回空串', () => {
    expect(dietLib.escapeRegExp(undefined)).toBe('');
    expect(dietLib.escapeRegExp(123)).toBe('');
  });
});
