import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SCSS 变量守卫。
 *
 * ## 为什么需要它（本守卫的由来）
 *
 * M4 第 7 步在 `backup.vue` 里写了 `$uni-bg-color-grey` —— 那是 **uni-app 内置**的
 * 变量名，而本项目自己的 `src/uni.scss` 只定义了 9 个变量，**没有这一个**。
 *
 * 后果的形态很刁钻：
 * - `npm test` **全绿**（单测不编译样式）；
 * - `npm run type-check` **0 错误**（vue-tsc 不看 SCSS）；
 * - 只有 `npm run build:mp-weixin` 会以
 *   「Undefined variable」**直接构建失败**。
 *
 * 而项目每一步的验收约定恰好是「`npm test` 全绿 + `type-check` 0 错误」——
 * 也就是说这个错误可以**一路带到发版前**才暴露。本守卫把这一步提前到单测里：
 * 扫描全部 `<style>` 块与 `.scss` 文件，要求用到的每个 `$uni-*` 都在 `uni.scss` 里定义。
 *
 * ⚠️ 不要把它放宽成「只警告」：SCSS 的未定义变量是**硬错误**，不是风格问题。
 */

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** 收集 `src/uni.scss` 里定义的变量名（带 `$`） */
function definedVariables(): Set<string> {
  const source = readFileSync(join(SRC, 'uni.scss'), 'utf8');
  const names = new Set<string>();
  for (const match of source.matchAll(/^\s*(\$[A-Za-z0-9_-]+)\s*:/gm)) {
    names.add(match[1]);
  }
  return names;
}

/** 递归列出 src 下的 .vue / .scss / .css（**排除第三方 uni_modules**） */
function styleSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      /**
       * ⚠️ 跳过 `src/uni_modules`：那是第三方插件自带的样式体系
       * （`uni-scss` 在它自己的 `_variables.scss` 里定义变量、再在
       * `setting/*.scss` 里使用），与本项目的 `uni.scss` 是两套东西。
       * 把它们算进来只会得到一屏假报警，反而让守卫被无视。
       */
      if (entry === 'uni_modules') {
        continue;
      }
      found.push(...styleSources(full));
      continue;
    }
    if (/\.(vue|scss|css)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * 去掉注释。
 *
 * ⚠️ 必须去注释，否则**说明文字本身会让守卫误报** ——
 * 本项目就发生过：`backup.vue` 里那句「不要用 `$uni-bg-color-grey`」的注释
 * 被当成真实使用，反而报了一个假错误。（更糟的是，这种假报警会诱使人
 * 用「删掉注释」来让测试变绿。）
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 取出 `<style>` 块的内容（已去注释）；非 .vue 文件直接整体返回 */
function styleBlocks(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  if (!file.endsWith('.vue')) {
    return [stripComments(source)];
  }
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) =>
    stripComments(match[1]),
  );
}

/** 文件中出现的全部 `$uni-*` 变量名 */
function usedUniVariables(text: string): string[] {
  return [...text.matchAll(/\$uni-[A-Za-z0-9_-]+/g)].map((match) => match[0]);
}

describe('SCSS 变量：用到的 $uni-* 必须都在 uni.scss 里定义', () => {
  it('uni.scss 自身至少定义了本项目用到的那批变量', () => {
    const defined = definedVariables();
    // 保住基准：这几个是 app.scss 与各页面广泛依赖的，被删掉会立刻全线崩塌
    for (const name of ['$uni-color-primary', '$uni-text-color', '$uni-bg-color']) {
      expect(defined.has(name), `uni.scss 缺少基准变量 ${name}`).toBe(true);
    }
  });

  it('⚠️ 不存在未定义的 $uni-* 变量（未定义 = 构建直接失败）', () => {
    const defined = definedVariables();
    const offenders: string[] = [];

    for (const file of styleSources(SRC)) {
      // uni.scss 是定义处本身，跳过
      if (file.endsWith(`uni.scss`)) {
        continue;
      }
      for (const block of styleBlocks(file)) {
        for (const name of usedUniVariables(block)) {
          if (!defined.has(name)) {
            offenders.push(`${relative(ROOT, file).split(sep).join('/')} → ${name}`);
          }
        }
      }
    }

    expect(
      [...new Set(offenders)],
      '这些变量在 src/uni.scss 里没有定义，`npm run build:mp-weixin` 会失败',
    ).toEqual([]);
  });

  it('守卫自身有效：故意用一个不存在的变量必须被判非法', () => {
    // 反向验证「扫描逻辑真的能发现未定义变量」，避免规则写错后永远绿
    const defined = definedVariables();
    const fake = '$uni-bg-color-grey';

    expect(defined.has(fake)).toBe(false);
    expect(usedUniVariables(`.x { background: ${fake}; }`)).toContain(fake);
  });
});
