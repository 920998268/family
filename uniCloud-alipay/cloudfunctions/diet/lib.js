'use strict'

// 饮食打卡云函数 —— 纯逻辑模块（可单元测试，不依赖 uniCloud）

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']
const NUTRITION_FIELDS = [
  ['calories', '热量'],
  ['protein', '蛋白质'],
  ['carbs', '碳水化合物'],
  ['fat', '脂肪']
]
const NUTRITION_MAX = 100000

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CLIENT_ID_RE = /^[A-Za-z0-9_-]+$/
const CLIENT_ID_MAX = 64
const FOOD_NAME_MAX = 40
const QUANTITY_MAX = 20
const KEYWORD_MAX = 20
const FOOD_LIMIT_DEFAULT = 20
const FOOD_LIMIT_MAX = 100

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

// 可选关联字段（如 memberId）：空值统一归一为 null
function normalizeOptionalId(value, label) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string' || value.length > CLIENT_ID_MAX) {
    return { ok: false, msg: `${label}不合法` }
  }
  return { ok: true, value }
}

function normalizeNutrition(payload, options) {
  const onlyProvided = !!(options && options.onlyProvided)
  const out = {}
  for (let i = 0; i < NUTRITION_FIELDS.length; i++) {
    const key = NUTRITION_FIELDS[i][0]
    const label = NUTRITION_FIELDS[i][1]
    const raw = payload[key]
    // 更新场景下未传该字段表示「不修改」；新增场景下未传表示「留空」
    if (raw === undefined && onlyProvided) continue
    if (raw === undefined || raw === null || raw === '') {
      out[key] = null
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0 || n > NUTRITION_MAX) {
      return { ok: false, msg: `${label}数值不合法（0~${NUTRITION_MAX}）` }
    }
    out[key] = n
  }
  return { ok: true, value: out }
}

/**
 * 校验并归一化一条饮食记录（新增 / 更新后复校共用）。
 * 返回的 value 即最终要落库的字段（不含 familyId / createdAt 等由服务端补齐的部分）。
 */
function validateDietPayload(payload) {
  const data = payload || {}

  const cid = validateClientId(data.clientId)
  if (!cid.ok) return cid

  const dateCheck = validateDate(data.date)
  if (!dateCheck.ok) return dateCheck

  if (MEAL_TYPES.indexOf(data.mealType) === -1) {
    return { ok: false, msg: '餐次取值不合法（breakfast/lunch/dinner/snack）' }
  }

  const name = validateText(data.foodName, '食物名称', FOOD_NAME_MAX)
  if (!name.ok) return name
  const quantity = validateText(data.quantity, '数量', QUANTITY_MAX)
  if (!quantity.ok) return quantity

  const nutrition = normalizeNutrition(data)
  if (!nutrition.ok) return nutrition

  const member = normalizeOptionalId(data.memberId, '打卡成员')
  if (!member.ok) return member

  const value = {
    clientId: data.clientId.trim(),
    date: data.date,
    mealType: data.mealType,
    foodName: name.value,
    quantity: quantity.value,
    memberId: member.value
  }
  for (let i = 0; i < NUTRITION_FIELDS.length; i++) {
    const key = NUTRITION_FIELDS[i][0]
    value[key] = nutrition.value[key]
  }
  return { ok: true, value }
}

/**
 * 把局部更新合并到既有记录上，得到一份「完整形态」入参，
 * 再交给 validateDietPayload 复校 —— 保证库里任何一条记录都始终是合法且自洽的。
 */
function mergeDietPatch(existing, payload) {
  const base = existing || {}
  const patch = payload || {}
  const pick = (key) => (patch[key] !== undefined ? patch[key] : base[key])
  const merged = {
    clientId: base.clientId,
    date: pick('date'),
    mealType: pick('mealType'),
    foodName: pick('foodName'),
    quantity: pick('quantity'),
    memberId: pick('memberId')
  }
  for (let i = 0; i < NUTRITION_FIELDS.length; i++) {
    const key = NUTRITION_FIELDS[i][0]
    merged[key] = pick(key)
  }
  return { ok: true, value: merged }
}

// 列表查询：支持按单日（date）或按区间（from/to）
function validateListQuery(payload) {
  const data = payload || {}

  if (isNonEmptyString(data.date)) {
    const check = validateDate(data.date)
    if (!check.ok) return check
    return { ok: true, value: { date: data.date } }
  }

  const from = data.from
  const to = data.to
  if (from === undefined && to === undefined) {
    return { ok: false, msg: '缺少查询条件（date 或 from/to）' }
  }
  if (from !== undefined) {
    const check = validateDate(from, '起始日期')
    if (!check.ok) return check
  }
  if (to !== undefined) {
    const check = validateDate(to, '结束日期')
    if (!check.ok) return check
  }
  if (from !== undefined && to !== undefined && from > to) {
    return { ok: false, msg: '起始日期不能晚于结束日期' }
  }
  return { ok: true, value: { from: from || '', to: to || '' } }
}

/**
 * 把 validateListQuery 的结果转成云数据库的 where 片段。
 * 传入 dbCmd 而非直接引用 uniCloud，保证本函数可单元测试。
 */
function buildDateWhere(dbCmd, query) {
  const q = query || {}
  if (q.date) return { date: q.date }
  if (q.from && q.to) return { date: dbCmd.gte(q.from).and(dbCmd.lte(q.to)) }
  if (q.from) return { date: dbCmd.gte(q.from) }
  return { date: dbCmd.lte(q.to) }
}

// 关键词模糊匹配前转义正则元字符，避免用户输入被当成正则执行
function escapeRegExp(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 云端记录 → 前端 DietEntry 形态
function toClientDiet(row) {
  const doc = row || {}
  const out = {
    id: doc.clientId || doc._id || '',
    date: doc.date || '',
    mealType: doc.mealType || 'breakfast',
    foodName: doc.foodName || '',
    quantity: doc.quantity || ''
  }
  for (let i = 0; i < NUTRITION_FIELDS.length; i++) {
    const key = NUTRITION_FIELDS[i][0]
    out[key] = doc[key] === undefined || doc[key] === null ? undefined : Number(doc[key])
  }
  out.memberId = doc.memberId || undefined
  return out
}

// 从一条饮食记录中提炼常用食物（自动收集）
function validateFoodCollect(payload) {
  const data = payload || {}
  const name = validateText(data.foodName, '食物名称', FOOD_NAME_MAX)
  if (!name.ok) return name

  const nutrition = normalizeNutrition(data)
  if (!nutrition.ok) return nutrition

  const quantity = typeof data.quantity === 'string' ? data.quantity.trim() : ''
  if (quantity.length > QUANTITY_MAX) {
    return { ok: false, msg: `数量长度需在 1~${QUANTITY_MAX} 字之间` }
  }

  const value = { name: name.value, quantity }
  for (let i = 0; i < NUTRITION_FIELDS.length; i++) {
    const key = NUTRITION_FIELDS[i][0]
    value[key] = nutrition.value[key]
  }
  return { ok: true, value }
}

function validateFoodQuery(payload) {
  const data = payload || {}
  let limit = FOOD_LIMIT_DEFAULT
  if (data.limit !== undefined && data.limit !== null && data.limit !== '') {
    const n = Number(data.limit)
    if (!Number.isFinite(n) || n < 1 || n > FOOD_LIMIT_MAX) {
      return { ok: false, msg: `limit 需在 1~${FOOD_LIMIT_MAX} 之间` }
    }
    limit = Math.floor(n)
  }
  const keyword = typeof data.keyword === 'string' ? data.keyword.trim() : ''
  if (keyword.length > KEYWORD_MAX) {
    return { ok: false, msg: `关键词长度不能超过 ${KEYWORD_MAX}` }
  }
  return { ok: true, value: { limit, keyword } }
}

// 云端记录 → 前端 FavoriteFood 形态
function toClientFood(row) {
  const doc = row || {}
  const out = {
    id: doc._id || doc.name || '',
    name: doc.name || '',
    quantity: doc.quantity || '',
    useCount: Number(doc.useCount) || 0
  }
  for (let i = 0; i < NUTRITION_FIELDS.length; i++) {
    const key = NUTRITION_FIELDS[i][0]
    out[key] = doc[key] === undefined || doc[key] === null ? undefined : Number(doc[key])
  }
  out.lastUsedAt = doc.lastUsedAt === undefined || doc.lastUsedAt === null
    ? undefined
    : Number(doc.lastUsedAt)
  return out
}

module.exports = {
  MEAL_TYPES,
  validateDate,
  validateClientId,
  validateDietPayload,
  mergeDietPatch,
  validateListQuery,
  buildDateWhere,
  escapeRegExp,
  toClientDiet,
  validateFoodCollect,
  validateFoodQuery,
  toClientFood
}
