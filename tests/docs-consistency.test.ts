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
const BACKEND_DOC = 'docs/backend-uniCloud-implementation.md';

/** 取某个二级标题下的正文（到下一个二级标题为止） */
function section(source: string, heading: string): string {
  const start = source.indexOf(heading);
  expect(start, `文档缺少章节：${heading}`).toBeGreaterThanOrEqual(0);

  const rest = source.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('M2-A 方案文档', () => {
  const source = read(M2A_DOC);

  it('8 个实施步骤全部标记为已完成', () => {
    // 只看 §9 开头那个「步骤表」表格块：§9.8 的验收对照表也是 | 1 | 起的编号行，
    // 不限定表格块会把它一起算进来
    const lines = section(source, '## 9. 实施步骤与提交计划').split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => line.includes('| 步 | 内容 |'));
    expect(headerIndex, '未找到实施步骤表').toBeGreaterThanOrEqual(0);

    const stepRows: string[] = [];
    for (let i = headerIndex + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line.startsWith('|')) break; // 表格结束
      if (/^\|[\s\-:|]+\|$/.test(line)) continue; // 表头分隔行
      if (/^\|\s*\d+\s*\|/.test(line)) stepRows.push(line);
    }

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
    const paths = new Set(
      [...source.matchAll(/`((?:src|tests|docs|uniCloud-alipay)\/[A-Za-z0-9_./-]+)`/g)].map(
        (match) => match[1],
      ),
    );

    expect(paths.size).toBeGreaterThan(5);
    for (const path of paths) {
      expect(existsSync(join(ROOT, path)), `清单提到的路径不存在：${path}`).toBe(true);
    }
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
