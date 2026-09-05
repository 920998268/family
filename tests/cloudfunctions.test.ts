import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

// 云函数 lib.js 为 CommonJS 纯逻辑模块，用 createRequire 加载（避免无类型声明的 TS 报错）
const require = createRequire(import.meta.url);
const familyLib = require('../uniCloud/cloudfunctions/family/lib');
const memberLib = require('../uniCloud/cloudfunctions/member/lib');

describe('family 云函数纯逻辑', () => {
  it('generateInviteCode 生成 6 位邀请码且不含易混淆字符', () => {
    const code = familyLib.generateInviteCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(code).not.toMatch(/[OI10]/);
  });

  it('generateInviteCode 多次生成不重复', () => {
    const codes = new Set(Array.from({ length: 50 }, () => familyLib.generateInviteCode()));
    expect(codes.size).toBe(50);
  });

  it('validateCreateFamily：空名称拒绝', () => {
    expect(familyLib.validateCreateFamily({ name: '' }).ok).toBe(false);
    expect(familyLib.validateCreateFamily({}).ok).toBe(false);
  });

  it('validateCreateFamily：超长名称拒绝', () => {
    expect(familyLib.validateCreateFamily({ name: 'x'.repeat(21) }).ok).toBe(false);
  });

  it('validateCreateFamily：正常名称通过并 trim', () => {
    const r = familyLib.validateCreateFamily({ name: ' 幸福一家 ' });
    expect(r.ok).toBe(true);
    expect(r.value.name).toBe('幸福一家');
  });

  it('validateJoinFamily：空/格式错误拒绝', () => {
    expect(familyLib.validateJoinFamily({ inviteCode: '' }).ok).toBe(false);
    expect(familyLib.validateJoinFamily({ inviteCode: 'abc' }).ok).toBe(false);
    expect(familyLib.validateJoinFamily({ inviteCode: 'abc1234' }).ok).toBe(false);
    expect(familyLib.validateJoinFamily({}).ok).toBe(false);
  });

  it('validateJoinFamily：小写转大写后通过', () => {
    const r = familyLib.validateJoinFamily({ inviteCode: ' ab12cd ' });
    expect(r.ok).toBe(true);
    expect(r.value.inviteCode).toBe('AB12CD');
  });
});

describe('member 云函数纯逻辑', () => {
  it('validateMember：姓名为空拒绝', () => {
    expect(memberLib.validateMember({ name: '' }).ok).toBe(false);
    expect(memberLib.validateMember({}).ok).toBe(false);
  });

  it('validateMember：非法性别拒绝', () => {
    expect(memberLib.validateMember({ name: '小明', gender: 'xx' }).ok).toBe(false);
  });

  it('validateMember：非法生日格式拒绝', () => {
    expect(memberLib.validateMember({ name: '小明', birthday: '2026/01/01' }).ok).toBe(false);
  });

  it('validateMember：身高/体重/目标体重越界拒绝', () => {
    expect(memberLib.validateMember({ name: '小明', height: 0 }).ok).toBe(false);
    expect(memberLib.validateMember({ name: '小明', height: 300 }).ok).toBe(false);
    expect(memberLib.validateMember({ name: '小明', weight: -1 }).ok).toBe(false);
    expect(memberLib.validateMember({ name: '小明', targetWeight: 999 }).ok).toBe(false);
  });

  it('validateMember：完整合法档案通过', () => {
    const r = memberLib.validateMember({
      name: '小明',
      gender: 'male',
      birthday: '2010-05-01',
      height: 150,
      weight: 40,
      targetWeight: 45,
    });
    expect(r.ok).toBe(true);
  });
});
