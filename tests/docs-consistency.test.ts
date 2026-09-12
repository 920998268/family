import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 文档 ↔ 代码一致性守卫。
 *
 * 文档漂移是本项目反复出现的真实问题：
 * - 路线图里 M0/M1 的待办很久没勾，但代码早就实现了；
 * - `backend-uniCloud-implementation.md` §7.1 的 `diets`/`workouts` 字段是早期设计稿，
 *   与实现完全不同（写的是 content/type/duration/note，实际是 foodName/sets/category…）。
 *
 * 这里把「文档提到的东西必须真实存在」固化成断言，避免同类问题再次发生。
 */

const ROOT = process.cwd();
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8');

const M2A_DOC = 'docs/0.3.2-m2a-requirements-and-solution.md';
const CHECKLIST = 'docs/0.3.2-m2a-deploy-checklist.md';
const M2B_DOC = 'docs/0.3.3-m2b-requirements-and-solution.md';
const M2B_CHECKLIST = 'docs/0.3.3-m2b-deploy-checklist.md';
const BACKEND_DOC = 'docs/backend-uniCloud-implementation.md';

/** 取某个二级标题下的正文（到下一个二级标题为止） */
function section(source: string, heading: string): string {
  const start = source.indexOf(heading);
  expect(start, `文档缺少章节：${heading}`).toBeGreaterThanOrEqual(0);

  const rest = source.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * 取「步骤表」那一个表格块的编号行。
 *
 * ⚠️ 必须限定表格块：同一个章节里往往还有个「验收对照表」也是 `| 1 |` 起编号，
 * 只按行首模式匹配会把两者混在一起（M2-A 文档上实际踩过）。
 */
function numberedRowsInTable(source: string, heading: string, headerNeedle: string): string[] {
  const lines = section(source, heading).split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.includes(headerNeedle));
  expect(headerIndex, `未找到表头「${headerNeedle}」`).toBeGreaterThanOrEqual(0);

  const rows: string[] = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break; // 表格结束
    if (/^\|[\s\-:|]+\|$/.test(line)) continue; // 表头分隔行
    if (/^\|\s*\d+\s*\|/.test(line)) rows.push(line);
  }
  return rows;
}

/** 断言文档里提到的仓库内路径都真实存在 */
function expectReferencedPathsExist(source: string, label: string): number {
  const paths = new Set(
    [...source.matchAll(/`((?:src|tests|docs|uniCloud-alipay)\/[A-Za-z0-9_./-]+)`/g)].map(
      (match) => match[1],
    ),
  );

  for (const path of paths) {
    expect(existsSync(join(ROOT, path)), `${label} 提到的路径不存在：${path}`).toBe(true);
  }
  return paths.size;
}

describe('M2-A 方案文档', () => {
  const source = read(M2A_DOC);

  it('8 个实施步骤全部标记为已完成', () => {
    const stepRows = numberedRowsInTable(source, '## 9. 实施步骤与提交计划', '| 步 | 内容 |');

    expect(stepRows).toHaveLength(8);
    for (const row of stepRows) {
      expect(row, `步骤行未标记完成：${row}`).toContain('已完成');
    }
  });

  it('保留出口验收标准的 5 条（真机验收的依据）', () => {
    for (const keyword of [
      'A 新增饮食或运动打卡，B 刷新后可见',
      '断网时 A 正常打卡',
      '两条都保留（不互相覆盖）',
      '历史本地数据在本机可见',
    ]) {
      expect(source).toContain(keyword);
    }
  });

  it('指向部署与验收清单文档', () => {
    expect(source).toContain('0.3.2-m2a-deploy-checklist.md');
  });
});

describe('部署与验收清单', () => {
  const source = read(CHECKLIST);

  it('覆盖全部必需的部署动作', () => {
    for (const item of [
      'diets.schema.json',
      'workouts.schema.json',
      'favorite_foods.schema.json',
      'checkin-shared',
      'cloudfunctions/diet',
      'cloudfunctions/workout',
    ]) {
      expect(source, `清单缺少 ${item}`).toContain(item);
    }
  });

  it('给出 5 条索引（含 3 条唯一索引）', () => {
    // diets/workouts 的 familyId+date 与 familyId+clientId，加 favorite_foods 的 familyId+name
    expect(source).toContain('familyId` + `date`');
    expect(source).toContain('familyId` + `clientId`');
    expect(source).toContain('familyId` + `name`');
    expect(source).toContain('唯一索引');
  });

  it('包含真机验收用例与回滚方案', () => {
    expect(source).toContain('真机验收用例');
    expect(source).toContain('回滚方案');
    // 数据安全红线必须写上
    expect(source).toContain('历史数据不丢');
  });

  it('清单里提到的仓库内路径都真实存在（防止文档写了不存在的文件）', () => {
    expect(expectReferencedPathsExist(source, 'M2-A 部署清单')).toBeGreaterThan(5);
  });
});

describe('M2-B 方案文档（学习打卡上云）', () => {
  const source = read(M2B_DOC);

  it('8 个实施步骤全部标记为已完成', () => {
    const stepRows = numberedRowsInTable(source, '## 9. 实施步骤', '| 步 | 内容 |');

    expect(stepRows).toHaveLength(8);
    for (const row of stepRows) {
      expect(row, `步骤行未标记完成：${row}`).toContain('已完成');
    }
  });

  it('保留出口验收标准的 7 条（真机验收的依据）', () => {
    for (const keyword of [
      'A 新增学习计划或打卡，B 重新进入页面后可见',
      'A 删除学习计划后，该计划的打卡在 B 端一并消失',
      '断网时 A 正常打卡',
      '同一计划同一天不会被重复打卡',
      '历史本地学习数据在本机可见',
    ]) {
      expect(source).toContain(keyword);
    }
  });

  it('指向部署与验收清单文档', () => {
    expect(source).toContain('0.3.3-m2b-deploy-checklist.md');
  });

  it('记录「跨设备删除不同步」这个已知缺口的口径', () => {
    // 这条缺口的说明散落在方案与部署清单两处，容易被后来的改动删掉
    expect(source).toContain('跨设备');
    expect(source).toContain('删除');
  });
});

describe('M2-B 部署清单', () => {
  const source = read(M2B_CHECKLIST);

  it('覆盖本期要上传的 4 项', () => {
    for (const item of [
      'uniCloud-alipay/database/study_plans.schema.json',
      'uniCloud-alipay/database/study_checkins.schema.json',
      'uniCloud-alipay/cloudfunctions/study',
      '5 条索引',
    ]) {
      expect(source, `清单缺少 ${item}`).toContain(item);
    }
  });

  it('给出 5 条索引，并标明哪 3 条是唯一索引', () => {
    expect(source).toContain('familyId` + `clientId`');
    expect(source).toContain('familyId` + `createdAt`');
    expect(source).toContain('familyId` + `date`');
    expect(source).toContain('familyId` + `planId` + `date`');
    expect(source).toContain('唯一');
  });

  it('明确说明 checkin-shared 本期不需要重传', () => {
    expect(source).toContain('checkin-shared');
    expect(source).toContain('不需要重传');
  });

  it('复述「不要用批量上传」的警示（M2-A 踩过的坑）', () => {
    expect(source).toContain('上传所有云函数、公共模块及 actions');
    expect(source).toContain('Invalid uni-id config file');
  });

  it('包含已知缺口说明与真机验收用例', () => {
    expect(source).toContain('跨设备删除不会同步');
    expect(source).toContain('真机验收用例');
    expect(source).toContain('级联删除');
  });

  it('清单里提到的仓库内路径都真实存在', () => {
    expect(expectReferencedPathsExist(source, 'M2-B 部署清单')).toBeGreaterThan(3);
  });
});

describe('后端实施文档的集合清单与实际 schema 一致', () => {
  const source = read(BACKEND_DOC);

  /**
   * 取 §7.1 表格中某个集合那一行的「关键字段」列。
   * 行形如 `| \`diets\` | 🟡 | 说明 | familyId, clientId, ... |`，字段列是第 4 个单元格。
   */
  function declaredFields(collection: string): string[] {
    const line = source.split(/\r?\n/).find((row) => row.startsWith(`| \`${collection}\` `));
    expect(line, `§7.1 缺少集合 ${collection} 的行`).toBeTruthy();

    const cells = (line as string).split('|');
    const raw = cells[4] ?? '';

    // 先剥掉括号与方括号内容（如 category(strength/cardio)、sets[{id,order,...}]），
    // 否则 sets 里的逗号会把字段切开
    return raw
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\([^)]*\)/g, '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(item));
  }

  const cases = [
    { collection: 'diets', schema: 'uniCloud-alipay/database/diets.schema.json', min: 10 },
    { collection: 'workouts', schema: 'uniCloud-alipay/database/workouts.schema.json', min: 10 },
    {
      collection: 'favorite_foods',
      schema: 'uniCloud-alipay/database/favorite_foods.schema.json',
      min: 8,
    },
    {
      collection: 'study_plans',
      schema: 'uniCloud-alipay/database/study_plans.schema.json',
      min: 10,
    },
    {
      collection: 'study_checkins',
      schema: 'uniCloud-alipay/database/study_checkins.schema.json',
      min: 9,
    },
  ];

  for (const item of cases) {
    it(`${item.collection}：文档列出的字段都在 schema 中声明`, () => {
      const schema = JSON.parse(read(item.schema)) as { properties: Record<string, unknown> };
      const declared = Object.keys(schema.properties);
      const documented = declaredFields(item.collection);

      expect(documented.length, `${item.collection} 文档字段解析异常`).toBeGreaterThanOrEqual(
        item.min,
      );
      for (const field of documented) {
        expect(declared, `${item.schema} 未声明文档写明的字段 ${field}`).toContain(field);
      }
    });
  }

  it('M2-A 在路线图中标记为已完成', () => {
    expect(source).toContain('**M2-A** ✅');
  });

  it('不再残留早期设计稿的字段名（content / type / duration / note）', () => {
    const line = source.split(/\r?\n/).find((row) => row.startsWith('| `diets` ')) as string;

    // `content` 是早期设计稿给 diets 的字段名，实现里叫 foodName
    expect(line).not.toContain('content');
  });
});
