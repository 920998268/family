import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const studyLib = require('../uniCloud-alipay/cloudfunctions/study/lib');

const ROOT = process.cwd();
const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
const readText = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8');

const plansSchema = readJson('uniCloud-alipay/database/study_plans.schema.json');
const checkinsSchema = readJson('uniCloud-alipay/database/study_checkins.schema.json');

const INDEX_FILE = 'uniCloud-alipay/cloudfunctions/study/index.js';
const indexSource = readText(INDEX_FILE);

/** 由云函数在服务端补齐、不由客户端传入的字段 */
const SERVER_FIELDS = ['familyId', 'createdByUid', 'createdAt', 'updatedAt'];

const SCHEMAS = [
  { name: 'study_plans', schema: plansSchema },
  { name: 'study_checkins', schema: checkinsSchema },
];

describe('学习集合 schema', () => {
  it('两个 schema 文件都存在且可解析', () => {
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

  it('required 含 familyId 与 clientId', () => {
    for (const { name, schema } of SCHEMAS) {
      expect(schema.required, `${name} 缺少 familyId`).toContain('familyId');
      expect(schema.required, `${name} 缺少 clientId`).toContain('clientId');
    }
    expect(plansSchema.required).toEqual(
      expect.arrayContaining(['title', 'subject', 'frequency', 'targetTimes']),
    );
    expect(checkinsSchema.required).toEqual(expect.arrayContaining(['planId', 'date']));
  });

  it('createdAt 为毫秒时间戳', () => {
    for (const { name, schema } of SCHEMAS) {
      expect(schema.properties.createdAt.bsonType, `${name}.createdAt`).toBe('timestamp');
    }
  });

  it('只有 study_plans.createdAt 需要标注毫秒（前端 StudyPlan.createdAt 是 ISO，要换算）', () => {
    // 前端 StudyCheckin 模型没有 createdAt 字段，所以 study_checkins 不涉及跨端换算。
    // 这条注释是为了让下一个人知道：两边的说明差异是**有意的**，不是漏写。
    expect(plansSchema.properties.createdAt.title).toContain('毫秒');
    expect(plansSchema.properties.updatedAt.bsonType).toBe('timestamp');
  });

  it('study_checkins.note 必须是字符串（不可为 null）', () => {
    // 落 null 会让前端 validateStudyCheckin 判非法，整条打卡被静默丢弃
    expect(checkinsSchema.properties.note.bsonType).toBe('string');
  });
});

describe('落库字段 ↔ schema 一致性（防止代码与 schema 漂移）', () => {
  it('study_plans：云函数写入的字段全部已在 schema 中声明', () => {
    const value = studyLib.validatePlanPayload({
      clientId: 'study-1',
      title: '每天背单词',
      subject: '英语',
      frequency: 'daily',
      targetTimes: 1,
    }).value;

    const declared = Object.keys(plansSchema.properties);
    for (const key of [...Object.keys(value), ...SERVER_FIELDS]) {
      expect(declared, `study_plans.schema.json 缺少字段 ${key}`).toContain(key);
    }
  });

  it('study_checkins：云函数写入的字段全部已在 schema 中声明', () => {
    const value = studyLib.validateCheckinPayload({
      clientId: 'checkin-1',
      planId: 'study-1',
      date: '2026-09-12',
      note: '背了 50 个词',
    }).value;

    const declared = Object.keys(checkinsSchema.properties);
    for (const key of [...Object.keys(value), ...SERVER_FIELDS]) {
      expect(declared, `study_checkins.schema.json 缺少字段 ${key}`).toContain(key);
    }
  });

  it('schema 的 maxLength 与 lib 的上限一致', () => {
    expect(plansSchema.properties.clientId.maxLength).toBe(studyLib.CLIENT_ID_MAX);
    expect(plansSchema.properties.title.maxLength).toBe(studyLib.TITLE_MAX);
    expect(plansSchema.properties.subject.maxLength).toBe(studyLib.SUBJECT_MAX);
    expect(checkinsSchema.properties.clientId.maxLength).toBe(studyLib.CLIENT_ID_MAX);
    expect(checkinsSchema.properties.note.maxLength).toBe(studyLib.NOTE_MAX);
  });
});

describe('云函数越权防护（源码级守卫）', () => {
  it('不允许从客户端入参读取 familyId（必须由服务端推导）', () => {
    const dangerous = /\b(event|evt|payload|input|body)\s*\.\s*familyId\b/;
    expect(dangerous.test(indexSource), '直接从客户端入参取了 familyId').toBe(false);
  });

  it('必须调用 resolveContext 获取家庭归属', () => {
    expect(indexSource.includes('resolveContext(')).toBe(true);
  });

  it('必须校验打卡成员归属（resolveMemberId）', () => {
    expect(indexSource.includes('resolveMemberId(')).toBe(true);
  });

  it('定位记录必须按 familyId + clientId', () => {
    expect(indexSource).toContain('where({ familyId, clientId })');
  });

  it('打卡前必须校验计划存在且属于本家庭', () => {
    // 主从约束：「学习打卡从属于学习计划」。缺了它就能给不存在的计划打卡
    expect(indexSource).toContain('未找到该学习计划');
  });
});

describe('级联删除（孤儿打卡防线）', () => {
  it('先删打卡、再删计划（顺序反了会留下永久孤儿）', () => {
    const cascadeIndex = indexSource.indexOf('deleteInBatches(');
    const removePlanIndex = indexSource.indexOf('collection(PLANS).doc(target._id).remove()');

    expect(cascadeIndex, '未使用 deleteInBatches 做级联删除').toBeGreaterThan(-1);
    expect(removePlanIndex, '未删除计划本身').toBeGreaterThan(-1);
    expect(cascadeIndex, '必须先删打卡、再删计划').toBeLessThan(removePlanIndex);
  });

  it('未删完时不删计划，返回可重试的失败', () => {
    // 带着未删完的打卡删掉计划 = 永久孤儿；重试能继续删（每轮都有进展）
    expect(indexSource).toContain('cascade.truncated');
    expect(indexSource).toMatch(/truncated[\s\S]{0,200}?code:\s*500/);
  });

  it('唯一索引冲突必须转成 duplicated，不把 provider 错误码抛给前端', () => {
    expect(indexSource).toContain('isDuplicateKeyError(');
    expect(indexSource).toMatch(/isDuplicateKeyError\(e\)[\s\S]{0,220}?duplicated:\s*true/);
  });

  it('删除打卡是幂等的（不存在也返回成功）', () => {
    expect(indexSource).toMatch(/removed:\s*false/);
  });
});
