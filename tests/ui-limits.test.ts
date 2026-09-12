import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DIET_LIMITS, STUDY_LIMITS, WORKOUT_LIMITS } from '@/utils/limits';

const require = createRequire(import.meta.url);
const dietLib = require('../uniCloud-alipay/cloudfunctions/diet/lib');
const workoutLib = require('../uniCloud-alipay/cloudfunctions/workout/lib');
const studyLib = require('../uniCloud-alipay/cloudfunctions/study/lib');

const ROOT = process.cwd();
const readText = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8');

/**
 * 前端表单的 `maxlength` ↔ 云端 lib 上限的一致性守卫。
 *
 * 不一致的后果是最隐蔽的一类数据丢失：前端能输入超长值 → 本地写入成功 →
 * 推云端被拒 → 重试 5 次后丢弃待同步标记 → 记录永久留在本地且全程不报错。
 */

/**
 * 读取云函数 lib 里的数值常量。
 *
 * `study` 的 lib 导出了这些常量，直接取即可；
 * 但 `diet` / `workout` 的 lib **没有导出**常量，而它们**已经在云端部署过** ——
 * 为了一个测试去改已部署的云函数、逼用户重传，不划算。
 * 所以退化为从源码文本里读（正则只匹配 `const NAME = 数字` 这类简单声明；
 * 若哪天常量被改名，这条守卫会直接失败，提醒同步更新）。
 */
function libConstant(moduleExports: Record<string, unknown>, file: string, name: string): number {
  const exported = moduleExports[name];
  if (typeof exported === 'number') {
    return exported;
  }

  const match = readText(file).match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`));
  if (!match) {
    throw new Error(`${file} 中未找到常量 ${name}`);
  }
  return Number(match[1]);
}

const DIET_LIB = 'uniCloud-alipay/cloudfunctions/diet/lib.js';
const WORKOUT_LIB = 'uniCloud-alipay/cloudfunctions/workout/lib.js';
const STUDY_LIB = 'uniCloud-alipay/cloudfunctions/study/lib.js';

/** 从 .vue 源码里抽出所有 input/textarea 标签，返回 v-model 名 → maxlength 表达式 */
function maxlengthByModel(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const tags = source.match(/<(?:input|textarea)[^>]*>/g) ?? [];

  for (const tag of tags) {
    const model = tag.match(/v-model(?:\.[a-z]+)?="([^"]*)"/)?.[1];
    const maxlength = tag.match(/:?maxlength="([^"]*)"/)?.[1];
    if (model && maxlength) {
      map.set(model, maxlength);
    }
  }

  return map;
}

describe('前端与云端的长度上限必须一致', () => {
  it('饮食：食物名称 40 / 数量 20', () => {
    expect(DIET_LIMITS.foodName).toBe(libConstant(dietLib, DIET_LIB, 'FOOD_NAME_MAX'));
    expect(DIET_LIMITS.quantity).toBe(libConstant(dietLib, DIET_LIB, 'QUANTITY_MAX'));
  });

  it('运动：动作名称 40', () => {
    expect(WORKOUT_LIMITS.exerciseName).toBe(libConstant(workoutLib, WORKOUT_LIB, 'NAME_MAX'));
  });

  it('学习：标题 40 / 学习内容 40 / 备注 100', () => {
    expect(STUDY_LIMITS.title).toBe(studyLib.TITLE_MAX);
    expect(STUDY_LIMITS.subject).toBe(studyLib.SUBJECT_MAX);
    expect(STUDY_LIMITS.note).toBe(studyLib.NOTE_MAX);
  });

  it('⚠️ 上限必须落在合理区间（防止被改成 0 或离谱的大数）', () => {
    for (const [label, value] of [
      ['食物名称', DIET_LIMITS.foodName],
      ['数量', DIET_LIMITS.quantity],
      ['动作名称', WORKOUT_LIMITS.exerciseName],
      ['计划标题', STUDY_LIMITS.title],
      ['学习内容', STUDY_LIMITS.subject],
      ['打卡备注', STUDY_LIMITS.note],
    ] as const) {
      expect(value, `${label} 上限应 ≥ 10`).toBeGreaterThanOrEqual(10);
      expect(value, `${label} 上限应 ≤ 200`).toBeLessThanOrEqual(200);
    }
  });
});

describe('表单输入框必须挂上 maxlength（否则上限形同虚设）', () => {
  it('饮食表单：食物名称与数量', () => {
    const map = maxlengthByModel(readText('src/components/DietForm.vue'));

    expect(map.get('form.foodName'), '食物名称未设置 maxlength').toBe('DIET_LIMITS.foodName');
    expect(map.get('form.quantity'), '数量未设置 maxlength').toBe('DIET_LIMITS.quantity');
  });

  it('运动表单：动作名称', () => {
    const map = maxlengthByModel(readText('src/components/WorkoutForm.vue'));

    expect(map.get('exerciseName'), '动作名称未设置 maxlength').toBe(
      'WORKOUT_LIMITS.exerciseName',
    );
  });

  it('学习页面：计划标题与学习内容', () => {
    const map = maxlengthByModel(readText('src/pages/checkin/study.vue'));

    expect(map.get('form.title'), '计划标题未设置 maxlength').toBe('STUDY_LIMITS.title');
    expect(map.get('form.subject'), '学习内容未设置 maxlength').toBe('STUDY_LIMITS.subject');
  });

  it('文本类输入框不留未设上限的漏网之鱼', () => {
    const targets: Array<[string, string[]]> = [
      ['src/components/DietForm.vue', ['form.foodName', 'form.quantity']],
      ['src/components/WorkoutForm.vue', ['exerciseName']],
      ['src/pages/checkin/study.vue', ['form.title', 'form.subject']],
    ];

    for (const [file, models] of targets) {
      const source = readText(file);
      const map = maxlengthByModel(source);

      for (const model of models) {
        expect(map.has(model), `${file} 的 ${model} 缺少 maxlength`).toBe(true);
      }
    }
  });
});

describe('数值输入的边界由前端校验器保证（与云端数值上限对齐）', () => {
  it('数值范围两端一致，不需要额外的输入限制', () => {
    // 前端 numberError 会在本地就拦下越界值并报错（用户可见），
    // 不像字符串长度那样会静默推不上去 —— 所以数值输入项不挂 maxlength 是安全的。
    // 这条测试把「两端数值范围一致」这个前提固定下来。
    expect(libConstant(dietLib, DIET_LIB, 'NUTRITION_MAX')).toBe(100000);
    expect(libConstant(workoutLib, WORKOUT_LIB, 'REPS_MAX')).toBe(10000);
    expect(libConstant(workoutLib, WORKOUT_LIB, 'WEIGHT_MAX')).toBe(2000);
    expect(libConstant(workoutLib, WORKOUT_LIB, 'DURATION_MAX')).toBe(1440);
    expect(libConstant(workoutLib, WORKOUT_LIB, 'DISTANCE_MAX')).toBe(1000);
    expect(libConstant(workoutLib, WORKOUT_LIB, 'CALORIES_MAX')).toBe(100000);
    // study 的 lib 有导出常量，顺带验证导出值 == 源码值（防止导出与实现漂移）
    expect(studyLib.TARGET_TIMES_MAX).toBe(libConstant(studyLib, STUDY_LIB, 'TARGET_TIMES_MAX'));
  });
});
