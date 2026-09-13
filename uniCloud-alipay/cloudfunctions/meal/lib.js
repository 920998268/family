'use strict'

// 食谱云函数 —— 纯逻辑模块（可单元测试，不依赖 uniCloud）
//
// 集合只有一张（`meal_plans`），没有主从关系，所以这里是「一块」而不是两块。
// 这一点与 `study`（计划 + 打卡，必须合并）、`travel`（计划 + 明细）不同 ——
// 判据见 docs/0.3.5-m3-requirements-and-solution.md §2.1：
// **只有存在主从关系（子记录要校验父存在、删父要级联删子）才合并云函数。**
//
// ⚠️ 本模块自包含（不 require 任何其它模块），才能被单元测试直接加载。
//    与 diet / workout / study 的 lib.js 保持同样的取舍：少量工具函数各自复制一份，
//    换取「纯逻辑 100% 可测」。
//
// ⚠️ 本文件的长度上限与前端 `src/utils/limits.ts` 的 `MEAL_LIMITS` 必须一致，
//    由 `tests/ui-limits.test.ts` 逐项守卫。不一致会造成最隐蔽的一类数据丢失：
//    本地写入成功 → 推云端 400 → 重试 5 次后丢弃待同步标记 → 记录永久留在本地。

const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CLIENT_ID_RE = /^[A-Za-z0-9_-]+$/
const CLIENT_ID_MAX = 64
const DISH_NAME_MAX = 40
const INGREDIENTS_MAX = 200
const COOK_MAX = 20
const NOTE_MAX = 100
const LIST_LIMIT = 500

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

// 日期以 YYYY-MM-DD 字符串原样存取，服务端不做时区换算
function validateDate(value, label) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return { ok: false, msg: `${label || '日期'}格式应为 YYYY-MM-DD` }
  }
  return { ok: true }
}

// clientId 由客户端生成，是幂等写入的唯一键
function validateClientId(value) {
  if (!isNonEmptyString(value)) return { ok: false, msg: '缺少 clientId' }
  if (value.length > CLIENT_ID_MAX) return { ok: false, msg: `clientId 长度不能超过 ${CLIENT_ID_MAX}` }
  if (!CLIENT_ID_RE.test(value)) return { ok: false, msg: 'clientId 含非法字符' }
  return { ok: true }
}

function validateText(value, label, max) {
  if (!isNonEmptyString(value)) return { ok: false, msg: `${label}不能为空` }
  const trimmed = value.trim()
  if (trimmed.length > max) return { ok: false, msg: `${label}长度需在 1~${max} 字之间` }
  return { ok: true, value: trimmed }
}

/**
 * 可选文本字段（食材 / 掌勺人 / 备注）：允许缺省、空串、null，统一落成字符串。
 *
 * ⚠️ 必须落成 `''` 而**不能落 `null`**：前端 `validateMealPlan` 要求
 *    `ingredients` / `cook` / `note` 都是**字符串**
 *    （`typeof plan.cook !== 'string'` 即判非法）。
 *    落 null 会让整条食谱在前端被判非法、被 `MealPlanRepository` **静默丢弃** ——
 *    本地写入却是成功的，极难对照发现。
 *    这一点与 `study/lib.js` 的 `normalizeNote`（同样落 `''`）保持一致。
 */
function normalizeOptionalText(value, label, max) {
  if (value === undefined || value === null) return { ok: true, value: '' }
  if (typeof value !== 'string') return { ok: false, msg: `${label}不合法` }
  const trimmed = value.trim()
  if (trimmed.length > max) {
    return { ok: false, msg: `${label}长度不能超过 ${max} 字` }
  }
  return { ok: true, value: trimmed }
}

/**
 * 校验并归一化一条食谱记录（新增 / 更新后复校共用）。
 * 返回的 value 即最终要落库的字段（不含 familyId / createdAt 等由服务端补齐的部分）。
 */
function validateMealPayload(payload) {
  const data = payload || {}

  const cid = validateClientId(data.clientId)
  if (!cid.ok) return cid

  const dateCheck = validateDate(data.date)
  if (!dateCheck.ok) return dateCheck

  if (MEAL_SLOTS.indexOf(data.slot) === -1) {
    return { ok: false, msg: '餐次取值不合法（breakfast/lunch/dinner/snack）' }
  }

  const dishName = validateText(data.dishName, '菜品名称', DISH_NAME_MAX)
  if (!dishName.ok) return dishName

  const ingredients = normalizeOptionalText(data.ingredients, '食材', INGREDIENTS_MAX)
  if (!ingredients.ok) return ingredients

  const cook = normalizeOptionalText(data.cook, '掌勺人', COOK_MAX)
  if (!cook.ok) return cook

  const note = normalizeOptionalText(data.note, '备注', NOTE_MAX)
  if (!note.ok) return note

  return {
    ok: true,
    value: {
      clientId: data.clientId.trim(),
      date: data.date,
      slot: data.slot,
      dishName: dishName.value,
      ingredients: ingredients.value,
      cook: cook.value,
      // 前端 `validateMealPlan` 要求 `done` 是**布尔**，所以这里必须收敛成 boolean
      //（缺省 / `'true'` / 1 等一律按 false，不做「真值」猜测）
      done: data.done === true,
      note: note.value
    }
  }
}

/**
 * 把局部更新合并到既有记录上，得到一份「完整形态」入参，
 * 再交给 `validateMealPayload` 复校 —— 这样即使 patch 只改了菜品名，
 * 也能校验出整体是否仍合法。逐字段校验发现不了「单字段 patch 造成的整体矛盾」。
 *
 * ⚠️ `date` **不可由 patch 修改**（与 `clientId` 同等对待）：
 *    前端 `MealPlanPatch = Partial<Omit<MealPlan, 'id' | 'date'>>` 本来就不含 `date`，
 *    本地 `MealService.update(date, id, patch)` 也把 `date` 写死。
 *    云端若允许改 `date`，记录的所属日期就会与本地分叉 ——
 *    而拉取通路 `pullMealPlans(date)` 是按日期查的，改了日期的记录会在旧日期下凭空消失。
 */
function mergeMealPatch(existing, payload) {
  const base = existing || {}
  const patch = payload || {}
  const pick = (key) => (patch[key] !== undefined ? patch[key] : base[key])

  return {
    ok: true,
    value: {
      clientId: base.clientId,
      date: base.date,
      slot: pick('slot'),
      dishName: pick('dishName'),
      ingredients: pick('ingredients'),
      cook: pick('cook'),
      done: pick('done'),
      note: pick('note')
    }
  }
}

/**
 * 列表查询：只按具体日期查。
 *
 * 食谱的读取口径就是「某一天」（本地存储 `family.meal.v1.<date>` 也是按日期分区），
 * 所以不做 diet 那样的 from/to 区间查询 —— 没有调用方，多一条通路就多一处要守。
 */
function validateMealQuery(payload) {
  const data = payload || {}
  if (!isNonEmptyString(data.date)) {
    return { ok: false, msg: '缺少查询日期' }
  }
  const check = validateDate(data.date)
  if (!check.ok) return check
  return { ok: true, value: { date: data.date } }
}

/**
 * 云端记录 → 前端 `MealPlan` 形态。
 *
 * ⚠️ 输出必须能被前端 `validateMealPlan` 接受（`tests/meal-lib.test.ts` 有守卫）：
 *    `id / date / slot / dishName` 非空且合法，`ingredients / cook / note` 是字符串
 *    （缺字段落 `''` 而不是 `null`），`done` 是布尔。
 */
function toClientMeal(row) {
  const doc = row || {}
  return {
    id: doc.clientId || doc._id || '',
    date: doc.date || '',
    // 脏数据（餐次被改成非法值）兜底为 breakfast，而不是整条记录被前端丢弃
    slot: MEAL_SLOTS.indexOf(doc.slot) !== -1 ? doc.slot : 'breakfast',
    dishName: typeof doc.dishName === 'string' ? doc.dishName : '',
    ingredients: typeof doc.ingredients === 'string' ? doc.ingredients : '',
    cook: typeof doc.cook === 'string' ? doc.cook : '',
    done: doc.done === true,
    note: typeof doc.note === 'string' ? doc.note : ''
  }
}

module.exports = {
  MEAL_SLOTS,
  CLIENT_ID_MAX,
  DISH_NAME_MAX,
  INGREDIENTS_MAX,
  COOK_MAX,
  NOTE_MAX,
  LIST_LIMIT,
  validateDate,
  validateClientId,
  normalizeOptionalText,
  validateMealPayload,
  mergeMealPatch,
  validateMealQuery,
  toClientMeal
}
