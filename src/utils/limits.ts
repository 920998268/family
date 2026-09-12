/**
 * 前端表单的输入长度上限。
 *
 * ⚠️ 这些值**必须与云端各云函数 `lib.js` 里的同名上限保持一致**，
 * 由 `tests/ui-limits.test.ts` 逐项守卫（含变异验证）。
 *
 * 为什么必须两端一致 —— 这是最隐蔽的一类数据丢失：
 *   云端上限比前端更严时，用户能输入超长内容 →
 *   本地写入**成功**（界面一切正常）→ 推送云端被拒（400）→
 *   重试 5 次后**丢弃待同步标记** → 该记录永久留在本地、云端没有，且全程不报错。
 *
 * 为什么不直接 import 云函数的 lib.js：
 *   它是 CommonJS 且位于 `uniCloud-alipay/` 下（不在前端构建范围内），
 *   前端引用会打乱构建边界。所以两端各留一份常量，用测试锁住一致性。
 *
 * 命名按模块加前缀：三个 lib 里都有叫 `NAME_MAX` 的常量但含义不同
 *（食物名 / 动作名 / …），扁平命名容易在跨模块引用时张冠李戴。
 */

/** 对应 `cloudfunctions/diet/lib.js` 的 FOOD_NAME_MAX / QUANTITY_MAX */
export const DIET_LIMITS = {
  foodName: 40,
  quantity: 20,
} as const;

/** 对应 `cloudfunctions/workout/lib.js` 的 NAME_MAX */
export const WORKOUT_LIMITS = {
  exerciseName: 40,
} as const;

/** 对应 `cloudfunctions/study/lib.js` 的 TITLE_MAX / SUBJECT_MAX / NOTE_MAX */
export const STUDY_LIMITS = {
  title: 40,
  subject: 40,
  note: 100,
} as const;
