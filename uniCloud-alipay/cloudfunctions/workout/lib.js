'use strict'

// 运动打卡云函数 —— 纯逻辑模块（可单元测试，不依赖 uniCloud）

const CATEGORIES = ['strength', 'cardio']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CLIENT_ID_RE = /^[A-Za-z0-9_-]+$/
const CLIENT_ID_MAX = 64
const NAME_MAX = 40
const SETS_MAX = 50
const REPS_MIN = 1
const REPS_MAX = 10000
const WEIGHT_MIN = 0
const WEIGHT_MAX = 2000
const DURATION_MIN = 1
const DURATION_MAX = 1440
const DISTANCE_MIN = 0
const DISTANCE_MAX = 1000
const CALORIES_MIN = 0
const CALORIES_MAX = 100000

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function validateDate(value, label) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return { ok: false, msg: `${label || '日期'}格式应为 YYYY-MM-DD` }
  }
  return { ok: true }
}

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

function normalizeOptionalId(value, label) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string' || value.length > CLIENT_ID_MAX) {
    return { ok: false, msg: `${label}不合法` }
  }
  return { ok: true, value }
}

function normalizeRequiredNumber(value, label, min, max) {
  if (value === undefined || value === null || value === '') {
    return { ok: false, msg: `${label}不能为空` }
  }
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) {
    return { ok: false, msg: `${label}需在 ${min}~${max} 之间` }
  }
  return { ok: true, value: n }
}

function normalizeOptionalNumber(value, label, min, max) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) {
    return { ok: false, msg: `${label}需在 ${min}~${max} 之间` }
  }
  return { ok: true, value: n }
}

/**
 * 归一化运动类型。
 *
 * ⚠️ 兼容逻辑：0.3.2 之前的训练记录没有 category 字段，
 * 此时按「有组明细 = 力量」推断，绝不因缺省而拒绝，否则老数据无法上云。
 */
function normalizeCategory(payload) {
  const data = payload || {}
  if (CATEGORIES.indexOf(data.category) !== -1) return data.category
  const sets = Array.isArray(data.sets) ? data.sets : []
  return sets.length > 0 ? 'strength' : 'cardio'
}

/**
 * 组明细校验与归一化。
 * order 由服务端按下标重排（不信任客户端顺序）；
 * id 缺失时补一个稳定 id，保证回传前端后仍满足 WorkoutSet 的形态要求。
 */
function validateSets(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, msg: '至少需要一组训练明细' }
  }
  if (value.length > SETS_MAX) {
    return { ok: false, msg: `组数不能超过 ${SETS_MAX} 组` }
  }

  const normalized = []
  for (let i = 0; i < value.length; i++) {
    const set = value[i] || {}
    const reps = Number(set.reps)
    const weightKg = Number(set.weightKg)

    if (!Number.isFinite(reps) || reps < REPS_MIN || reps > REPS_MAX) {
      return { ok: false, msg: `第 ${i + 1} 组次数需在 ${REPS_MIN}~${REPS_MAX} 之间` }
    }
    if (!Number.isFinite(weightKg) || weightKg < WEIGHT_MIN || weightKg > WEIGHT_MAX) {
      return { ok: false, msg: `第 ${i + 1} 组重量需在 ${WEIGHT_MIN}~${WEIGHT_MAX} 之间` }
    }

    normalized.push({
      id: isNonEmptyString(set.id) ? set.id : `set-${i + 1}`,
      order: i + 1,
      reps,
      weightKg
    })
  }
  return { ok: true, value: normalized }
}

/**
 * 校验并归一化一条运动记录（新增 / 更新后复校共用）。
 * 力量与有氧共用该入口，按 category 分流校验。
 */
function validateWorkoutPayload(payload) {
  const data = payload || {}

  const cid = validateClientId(data.clientId)
  if (!cid.ok) return cid

  const dateCheck = validateDate(data.date)
  if (!dateCheck.ok) return dateCheck

  const name = validateText(data.exerciseName, '动作名称', NAME_MAX)
  if (!name.ok) return name

  if (data.category !== undefined && CATEGORIES.indexOf(data.category) === -1) {
    return { ok: false, msg: '运动类型不合法（strength/cardio）' }
  }
  const category = normalizeCategory(data)

  const value = {
    clientId: data.clientId.trim(),
    date: data.date,
    category,
    exerciseName: name.value,
    sets: [],
    durationMin: null,
    distanceKm: null,
    calories: null,
    memberId: null
  }

  if (category === 'strength') {
    const sets = validateSets(data.sets)
    if (!sets.ok) return sets
    value.sets = sets.value
  } else {
    // 有氧不使用组明细，携带即视为形态矛盾
    if (Array.isArray(data.sets) && data.sets.length > 0) {
      return { ok: false, msg: '有氧记录不应包含组明细' }
    }
    const duration = normalizeRequiredNumber(data.durationMin, '运动时长', DURATION_MIN, DURATION_MAX)
    if (!duration.ok) return duration
    value.durationMin = duration.value

    const distance = normalizeOptionalNumber(data.distanceKm, '运动距离', DISTANCE_MIN, DISTANCE_MAX)
    if (!distance.ok) return distance
    value.distanceKm = distance.value
  }

  // 消耗热量：力量与有氧均可选填
  const calories = normalizeOptionalNumber(data.calories, '消耗热量', CALORIES_MIN, CALORIES_MAX)
  if (!calories.ok) return calories
  value.calories = calories.value

  const member = normalizeOptionalId(data.memberId, '打卡成员')
  if (!member.ok) return member
  value.memberId = member.value

  return { ok: true, value }
}

/**
 * 把局部更新合并到既有记录上，得到一份「完整形态」入参，
 * 再交给 validateWorkoutPayload 复校。
 * 这样即使 patch 只改了 category，也能校验出「切成有氧却还留着组明细」这类矛盾。
 */
function mergeWorkoutPatch(existing, payload) {
  const base = existing || {}
  const patch = payload || {}
  const pick = (key) => (patch[key] !== undefined ? patch[key] : base[key])

  return {
    ok: true,
    value: {
      clientId: base.clientId,
      date: pick('date'),
      exerciseName: pick('exerciseName'),
      category: pick('category'),
      sets: pick('sets'),
      durationMin: pick('durationMin'),
      distanceKm: pick('distanceKm'),
      calories: pick('calories'),
      memberId: pick('memberId')
    }
  }
}

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

// 云端记录 → 前端 WorkoutEntry 形态（补齐 category，老记录也能正确显示）
function toClientWorkout(row) {
  const doc = row || {}
  const sets = Array.isArray(doc.sets) ? doc.sets : []
  const category = CATEGORIES.indexOf(doc.category) !== -1
    ? doc.category
    : (sets.length > 0 ? 'strength' : 'cardio')

  return {
    id: doc.clientId || doc._id || '',
    date: doc.date || '',
    category,
    exerciseName: doc.exerciseName || '',
    sets: sets.map((set, index) => ({
      id: isNonEmptyString(set && set.id) ? set.id : `set-${index + 1}`,
      order: index + 1,
      reps: Number(set && set.reps) || 0,
      weightKg: Number(set && set.weightKg) || 0
    })),
    durationMin: doc.durationMin === undefined || doc.durationMin === null
      ? undefined
      : Number(doc.durationMin),
    distanceKm: doc.distanceKm === undefined || doc.distanceKm === null
      ? undefined
      : Number(doc.distanceKm),
    calories: doc.calories === undefined || doc.calories === null
      ? undefined
      : Number(doc.calories),
    memberId: doc.memberId || undefined
  }
}

module.exports = {
  CATEGORIES,
  validateDate,
  validateClientId,
  normalizeCategory,
  validateSets,
  validateWorkoutPayload,
  mergeWorkoutPatch,
  validateListQuery,
  toClientWorkout
}
