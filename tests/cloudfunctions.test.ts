import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// 云函数 lib.js 为 CommonJS 纯逻辑模块，用 createRequire 加载（避免无类型声明的 TS 报错）
const require = createRequire(import.meta.url);
const familyLib = require('../uniCloud-alipay/cloudfunctions/family/lib');
const memberLib = require('../uniCloud-alipay/cloudfunctions/member/lib');

const ROOT = process.cwd();

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

/**
 * `lib.js` 的自包含约束。
 *
 * 每个云函数的 lib 都是「纯逻辑、零依赖」的一份独立拷贝（少量工具函数各自复制），
 * 这样单元测试才能直接 `require` 它、不必拉起 uniCloud 运行时。
 * 一旦有人在 lib 里 require 了别的模块，纯逻辑就不再可测、而且可能在云端
 * 因为缺少依赖而加载失败 —— 所以用一条源码级守卫把它钉死。
 *
 * ⚠️ `index.js` 不受此约束（它本来就 require `checkin-shared` 与 `./lib`）。
 */
describe('云函数 lib.js 必须自包含（不 require 任何模块）', () => {
  const LIBS = ['diet', 'workout', 'study', 'family', 'member', 'meal', 'travel', 'ledger'];

  it('每个 lib.js 都存在', () => {
    for (const name of LIBS) {
      const file = join(ROOT, `uniCloud-alipay/cloudfunctions/${name}/lib.js`);
      expect(existsSync(file), `${name}/lib.js 不存在`).toBe(true);
    }
  });

  it('⚠️ 磁盘上每个 lib.js 都已登记进 LIBS（新增云函数不许漏登记）', () => {
    // 上面两条断言只覆盖 LIBS 里列出的名字 —— 新增一个云函数、写好 lib.js、
    // 却忘了登记时，它的自包含性**完全没人守**，而且要等下一个人发现问题。
    // 这里反向扫盘，把「漏登记」变成一条显性失败。
    const base = join(ROOT, 'uniCloud-alipay/cloudfunctions');
    const onDisk = readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(base, name, 'lib.js')))
      .sort();

    expect(onDisk, '有 lib.js 但没登记进 LIBS').toEqual([...LIBS].sort());
  });

  it('每个 lib.js 里都没有 require 调用', () => {
    for (const name of LIBS) {
      const source = readFileSync(
        join(ROOT, `uniCloud-alipay/cloudfunctions/${name}/lib.js`),
        'utf8',
      );
      expect(source.includes('require('), `${name}/lib.js 不应 require 任何模块`).toBe(false);
    }
  });
});
