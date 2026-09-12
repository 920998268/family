'use strict'

// 学习打卡云函数 —— 纯逻辑模块（可单元测试，不依赖 uniCloud）
//
// 含「学习计划」与「学习打卡」两块。两者是**主从关系**（打卡从属于计划：
// 打卡要校验计划存在、删计划要级联删打卡），所以合并在同一个云函数里。
// 详见 docs/0.3.3-m2b-requirements-and-solution.md §2.1。
//
// ⚠️ 本模块自包含（不 require 任何其它模块），才能被单元测试直接加载。
//    与 diet / workout 的 lib.js 保持同样的取舍：少量工具函数各自复制一份，
//    换取「纯逻辑 100% 可测」。

const FREQUENCIES = ['daily', 'weekly']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CLIENT_ID_RE = /^[A-Za-z0-9_-]+$/
const CLIENT_ID_MAX = 64
const TITLE_MAX = 40
const SUBJECT_MAX = 40
const NOTE_MAX = 100
const TARGET_TIMES_MIN = 1
const TARGET_TIMES_MAX = 1000
const PLAN_LIST_LIMIT = 200
const CHECKIN_LIST_LIMIT = 500

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

/**
 * 毫秒时间戳（或已是 ISO 的字符串）→ ISO 字符串。
 *
 * ⚠️ 前端 `StudyPlan.createdAt` 是 **ISO 字符串**，而云端存 **毫秒时间戳**，
 *    这里统一落成 ISO，前端就不必再区分两种格式。
 * ⚠️ 本模块自包含，所以这是 `src/utils/date.ts` 的 `toIsoString` 的一份最小等价实现，
 *    两边行为必须一致（`tests/study-lib.test.ts` 有守卫）。
 * ⚠️ 解析失败返回**空串**：会被前端 `validateStudyPlan` 以「创建时间不合法」
 *    明确拦下；若凑一个看似合法却错误的值，计划列表排序会**静默错乱**。
 */
function toIsoString(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    const fromNumber = new Date(value)
    return Number.isNaN(fromNumber.getTime()) ? '' : fromNumber.toISOString()
  }
  if (typeof value !== 'string' || !value) return ''
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toISOString()
}

/**
 * 备注归一化：允许缺省 / 空串 / null，统一落成字符串。
 *
 * ⚠️ 必须落成 `''` 而**不能落 `null`**：前端 `validateStudyCheckin` 要求
 *    `note` 是字符串，落 null 会让整条打卡在前端被判非法、
 *    被 `StudyCheckinRepository` **静默丢弃**（本地写入却是成功的，极难对照发现）。
 */
function normalizeNote(value) {
  if (value === undefined || value === null) return { ok: true, value: '' }
  if (typeof value !== 'string') return { ok: false, msg: '打卡备注不合法' }
  const trimmed = value.trim()
  if (trimmed.length > NOTE_MAX) {
    return { ok: false, msg: `打卡备注长度不能超过 ${NOTE_MAX} 字` }
  }
  return { ok: true, value: trimmed }
}

/**
 * 校验并归一化一条学习计划（新增 / 更新后复校共用）。
 */
function validatePlanPayload(payload) {
  const data = payload || {}

  const cid = validateClientId(data.clientId)
  if (!cid.ok) return cid

  const title = validateText(data.title, '计划标题', TITLE_MAX)
  if (!title.ok) return title

  const subject = validateText(data.subject, '学习内容', SUBJECT_MAX)
  if (!subject.ok) return subject

  if (FREQUENCIES.indexOf(data.frequency) === -1) {
    return { ok: false, msg: '打卡频率不合法（daily/weekly）' }
  }

  const targetTimes = normalizeRequiredNumber(
    data.targetTimes,
    '目标次数',
    TARGET_TIMES_MIN,
    TARGET_TIMES_MAX
  )
  if (!targetTimes.ok) return targetTimes

  const member = normalizeOptionalId(data.memberId, '归属成员')
  if (!member.ok) return member

  return {
    ok: true,
    value: {
      clientId: data.clientId.trim(),
      title: title.value,
      subject: subject.value,
      frequency: data.frequency,
      targetTimes: targetTimes.value,
      memberId: member.value
    }
  }
}

/**
 * 把局部更新合并到既有计划上，得到一份「完整形态」入参，
 * 再交给 `validatePlanPayload` 复校 —— 这样即使 patch 只改了频率，
 * 也能校验出整体是否仍合法。
 */
function mergePlanPatch(existing, payload) {
  const base = existing || {}
  const patch = payload || {}
  const pick = (key) => (patch[key] !== undefined ? patch[key] : base[key])

  return {
    ok: true,
    value: {
      clientId: base.clientId,
      title: pick('title'),
      subject: pick('subject'),
      frequency: pick('frequency'),
      targetTimes: pick('targetTimes'),
      memberId: pick('memberId')
    }
  }
}

/** 级联删除的轮次上限：防止「一直删不完 → 死循环」 */
const MAX_CASCADE_ROUNDS = 20

/**
 * 分批删除的循环控制（纯逻辑，**注入删除动作**以便单测）。
 *
 * ⚠️ 为什么不能「一次删完」：云数据库单次删除有条数上限，而一个学习计划
 *    可能积累很多天的打卡。一次删不完就会留下**孤儿打卡** ——
 *    计划已经没了、打卡还在，前端靠 planId 找不到计划标题，界面上根本渲染不出来。
 *    所以按批循环，直到某一批删到 0 条为止。
 *
 * 把「删一批」作为参数注入，是为了让这段控制流能被单元测试穷举：
 * 「单批有上限时会不会继续删」「什么时候停」「达到轮次上限怎么报告」
 * 都是容易写错、又极难在真机上发现的地方。
 *
 * @param {() => Promise<number>} deleteBatch 执行一批删除，返回本批删除条数
 * @param {{ maxRounds?: number }} [options]
 * @returns {Promise<{ deleted: number, rounds: number, truncated: boolean }>}
 *          `truncated: true` 表示达到轮次上限仍未删完 —— 调用方**不应**继续删主记录，
 *          否则会留下孤儿；应当返回可重试的失败，让下次调用接着删（每轮都有进展）。
 */
async function deleteInBatches(deleteBatch, options) {
  const maxRounds = (options && options.maxRounds) || MAX_CASCADE_ROUNDS
  let deleted = 0
  let rounds = 0
  let lastCount = 0

  while (rounds < maxRounds) {
    lastCount = Number(await deleteBatch()) || 0
    deleted += lastCount
    rounds += 1
    if (lastCount === 0) break
  }

  return { deleted, rounds, truncated: lastCount > 0 }
}

/**
 * 校验并归一化一条学习打卡。
 *
 * ⚠️ 「计划是否存在且属于本家庭」**不在这里校验** —— 纯函数不碰数据库。
 *    该主从约束由 `index.js` 在写库前完成（这是本云函数必须合并
 *    studyPlan / studyCheckin 的核心原因之一）。
 */
function validateCheckinPayload(payload) {
  const data = payload || {}

  const cid = validateClientId(data.clientId)
  if (!cid.ok) return cid

  if (!isNonEmptyString(data.planId)) {
    return { ok: false, msg: '缺少所属计划' }
  }

  const dateCheck = validateDate(data.date)
  if (!dateCheck.ok) return dateCheck

  const note = normalizeNote(data.note)
  if (!note.ok) return note

  const member = normalizeOptionalId(data.memberId, '打卡成员')
  if (!member.ok) return member

  return {
    ok: true,
    value: {
      clientId: data.clientId.trim(),
      planId: data.planId,
      date: data.date,
      note: note.value,
      memberId: member.value
    }
  }
}

/** 打卡列表查询：只按具体日期查（学习打卡的读取口径就是「某一天」） */
function validateCheckinQuery(payload) {
  const data = payload || {}
  if (!isNonEmptyString(data.date)) {
    return { ok: false, msg: '缺少查询日期' }
  }
  const check = validateDate(data.date)
  if (!check.ok) return check
  return { ok: true, value: { date: data.date } }
}

/** 云端计划记录 → 前端 StudyPlan 形态 */
function toClientPlan(row) {
  const doc = row || {}
  const targetTimes = Number(doc.targetTimes)
  return {
    id: doc.clientId || doc._id || '',
    title: typeof doc.title === 'string' ? doc.title : '',
    subject: typeof doc.subject === 'string' ? doc.subject : '',
    frequency: FREQUENCIES.indexOf(doc.frequency) !== -1 ? doc.frequency : 'daily',
    targetTimes: Number.isFinite(targetTimes) && targetTimes >= TARGET_TIMES_MIN
      ? targetTimes
      : TARGET_TIMES_MIN,
    memberId: doc.memberId || undefined,
    createdAt: toIsoString(doc.createdAt)
  }
}

/** 云端打卡记录 → 前端 StudyCheckin 形态 */
function toClientCheckin(row) {
  const doc = row || {}
  return {
    id: doc.clientId || doc._id || '',
    planId: typeof doc.planId === 'string' ? doc.planId : '',
    date: doc.date || '',
    // 落空串而不是 null，理由见 normalizeNote
    note: typeof doc.note === 'string' ? doc.note : '',
    memberId: doc.memberId || undefined
  }
}

module.exports = {
  FREQUENCIES,
  CLIENT_ID_MAX,
  TITLE_MAX,
  SUBJECT_MAX,
  NOTE_MAX,
  TARGET_TIMES_MIN,
  TARGET_TIMES_MAX,
  PLAN_LIST_LIMIT,
  CHECKIN_LIST_LIMIT,
  MAX_CASCADE_ROUNDS,
  validateDate,
  validateClientId,
  toIsoString,
  normalizeNote,
  validatePlanPayload,
  mergePlanPatch,
  deleteInBatches,
  validateCheckinPayload,
  validateCheckinQuery,
  toClientPlan,
  toClientCheckin
}
