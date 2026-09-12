import type { WorkoutCategory } from '@/types/models';
import type { WorkoutDraft } from '@/services/WorkoutService';

/**
 * 运动打卡表单的取值 → `WorkoutDraft`。
 *
 * 抽成纯函数是为了能单测：表单组件没有组件测试环境，
 * 而这里的校验分支（力量 / 有氧 / 空串 / 非法数字）恰恰是最容易出错的地方，
 * 也是「有氧记录建不出来」这类问题的第一现场。
 */

export interface WorkoutFormInput {
  category: WorkoutCategory;
  exerciseName: string;
  /** 力量：组明细。表单里可能是空串或 NaN（`v-model.number` 的产物），故按 unknown 收 */
  sets: ReadonlyArray<{ reps: unknown; weightKg: unknown }>;
  /** 有氧：时长（分钟，必填） */
  durationMin?: unknown;
  /** 有氧：距离（公里，选填） */
  distanceKm?: unknown;
  /** 消耗热量（千卡，选填；力量与有氧通用） */
  calories?: unknown;
}

export type WorkoutFormResult =
  | { ok: true; draft: WorkoutDraft }
  | { ok: false; msg: string };

/**
 * 选填数值归一化：空值 / 非法输入 → `undefined`。
 *
 * 注意 `Number.isNaN` 单独用不够：`Number.isNaN('')` 是 `false`，
 * 空输入框（`v-model.number` 会给空串）会被当成有效值一路传下去。
 * 必须先显式排除空串，再用 `Number.isFinite` 兜底。
 */
export function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/** 把表单输入整理成 `WorkoutDraft`；非法时返回可直接 toast 的提示语 */
export function buildWorkoutDraft(input: WorkoutFormInput): WorkoutFormResult {
  const name = (input.exerciseName || '').trim();

  if (input.category === 'cardio') {
    if (!name) {
      return { ok: false, msg: '请填写运动项目' };
    }

    const duration = optionalNumber(input.durationMin);
    if (duration === undefined || duration <= 0) {
      return { ok: false, msg: '请填写运动时长（分钟）' };
    }

    return {
      ok: true,
      draft: {
        exerciseName: name,
        category: 'cardio',
        // 有氧不带组明细：带上会被云端判为「形态矛盾」而拒绝
        sets: [],
        durationMin: duration,
        distanceKm: optionalNumber(input.distanceKm),
        calories: optionalNumber(input.calories),
      },
    };
  }

  if (!name) {
    return { ok: false, msg: '请填写训练动作' };
  }

  const sets = input.sets.map((set) => ({
    reps: Number(set.reps),
    weightKg: Number(set.weightKg),
  }));

  if (sets.length === 0) {
    return { ok: false, msg: '请至少填写一组' };
  }

  const hasInvalid = sets.some(
    (set) =>
      !Number.isFinite(set.reps) ||
      set.reps <= 0 ||
      !Number.isFinite(set.weightKg) ||
      set.weightKg < 0,
  );
  if (hasInvalid) {
    return { ok: false, msg: '请填写有效的组数和重量' };
  }

  return {
    ok: true,
    draft: {
      exerciseName: name,
      category: 'strength',
      sets,
      calories: optionalNumber(input.calories),
    },
  };
}
