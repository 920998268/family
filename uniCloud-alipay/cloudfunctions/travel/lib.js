'use strict'

// 出行计划云函数 —— 纯逻辑模块（可单元测试，不依赖 uniCloud）
//
// 含「出行计划」与「行程明细」两块。两者是**主从关系**（明细从属于计划：
// 明细要校验计划存在、删计划要级联删明细），所以合并在同一个云函数里 ——
// 判据与 `study`（计划 + 打卡）完全一致。
// 详见 docs/0.3.5-m3-requirements-and-solution.md §2.1 / §3.2。
//
// ⚠️ 本模块自包含（不 require 任何其它模块），才能被单元测试直接加载。
//    与 diet / workout / study 的 lib.js 保持同样的取舍：少量工具函数各自复制一份，
//    换取「纯逻辑 100% 可测」。
//
// ⚠️ 本文件的长度上限与前端 `src/utils/limits.ts` 的 `TRAVEL_LIMITS` 必须一致，
//    由 `tests/ui-limits.test.ts` 逐项守卫。
//
// ⚠️ 两处与 M2 的实质差异（照抄 study 会写错）：
//    1. 明细有 `order` —— 拆进独立集合 `travel_items` 后数组位置不再存在，
//       顺序只能由字段承载；且它**必须允许缺省**（老数据没有）。
//    2. `members` 是**数组**字段 —— M2 的所有集合都是标量字段，
//       数组要去重、剔除空值、限长。

const TRAVEL_STATUSES = ['planned', 'ongoing', 'done', 'cancelled']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CLIENT_ID_RE = /^[A-Za-z0-9_-]+$/
const CLIENT_ID_MAX = 64
const TITLE_MAX = 40
const DESTINATION_MAX = 40
const NOTE_MAX = 200
const ITEM_TIME_MAX = 20
const ITEM_ACTIVITY_MAX = 40
const ITEM_NOTE_MAX = 100
const BUDGET_MIN = 0
const BUDGET_MAX = 100000000
/** 参与成员的防御性上限：家庭规模在个位数，正常永远触发不到 */
const MEMBERS_MAX = 50
const PLAN_LIST_LIMIT = 200
const ITEM_LIST_LIMIT = 500
/** 级联删除的轮次上限：防止「一直删不完 → 死循环」 */
const MAX_CASCADE_ROUNDS = 20

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
 * 可选文本字段（目的地 / 备注 / 明细时间）：允许缺省、空串、null，统一落成字符串。
 *
 * ⚠️ 必须落成 `''` 而**不能落 `null`**：前端 `validateTravelPlan` 要求
 *    `destination` / `note` / `item.time` / `item.note` 都是**字符串**。
 *    落 null 会让整条出行计划在前端被判非法、被 `TravelRepository`
 *    **静默丢弃**（本地写入却是成功的，极难对照发现）。
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
 * 参与成员归一化：去重 + 剔除空值/非字符串，**保持原顺序**。
 *
 * 行为与前端 `src/utils/travel.ts` 的 `normalizeTravelMembers` **必须一致**
 *（`tests/travel-lib.test.ts` 有守卫）—— 两端归一化结果不同的话，
 * 同一份数据在本地与云端会长得不一样，后续合并会反复「发现变化」而白白推送。
 *
 * ⚠️ 刻意**不因「成员不存在」而剔除**：成员被移出家庭不该让出行计划消失或变形，
 *    这里只做形状归一，成员是否存在属于展示层的问题（方案文档 §5 风险 3）。
 * ⚠️ 非数组 → `[]` 而不是报错：老数据 / 脏数据不该让整条计划被判非法后丢弃。
 */
function normalizeMembers(value) {
  if (!Array.isArray(value)) return { ok: true, value: [] }

  const seen = {}
  const members = []
  for (let i = 0; i < value.length; i++) {
    const item = value[i]
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || seen[id]) continue
    if (id.length > CLIENT_ID_MAX) {
      return { ok: false, msg: `参与成员标识长度不能超过 ${CLIENT_ID_MAX}` }
    }
    seen[id] = true
    members.push(id)
    if (members.length > MEMBERS_MAX) {
      return { ok: false, msg: `参与成员不能超过 ${MEMBERS_MAX} 人` }
    }
  }
  return { ok: true, value: members }
}

/** 预算：缺省 / 空值 → 0（不是 null，前端要求 `numberError` 通过） */
function normalizeBudget(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: BUDGET_MIN }
  const n = Number(value)
  if (!Number.isFinite(n) || n < BUDGET_MIN || n > BUDGET_MAX) {
    return { ok: false, msg: `预算需在 ${BUDGET_MIN}~${BUDGET_MAX} 之间` }
  }
  return { ok: true, value: n }
}

/**
 * 展示顺序：缺省 / 空值 → 0，其余必须是 ≥ 0 的有限数（向下取整）。
 *
 * ⚠️ 缺省不报错：`order` 是 M3 才引入的字段，缺省只有两种来源 ——
 *    老数据、或调用方漏传。两者都不该让整条明细被丢弃（静默丢数据）。
 *    顺序冲突（两条都是 0）由前端的 `sortTravelItems` 稳定排序兜底，
 *    所以 `travel_items` 刻意**不加** `familyId + travelId + order` 唯一索引。
 */
function normalizeOrder(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: 0 }
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return { ok: false, msg: '顺序不合法' }
  return { ok: true, value: Math.floor(n) }
}

// ---------- 出行计划 ----------

/**
 * 校验并归一化一个出行计划（新增 / 更新后复校共用）。
 * 返回的 value 即最终要落库的字段（不含 familyId / createdAt 等由服务端补齐的部分）。
 */
function validatePlanPayload(payload) {
  const data = payload || {}

  const cid = validateClientId(data.clientId)
  if (!cid.ok) return cid

  const title = validateText(data.title, '计划标题', TITLE_MAX)
  if (!title.ok) return title

  const startCheck = validateDate(data.startDate, '开始日期')
  if (!startCheck.ok) return startCheck
  const endCheck = validateDate(data.endDate, '结束日期')
  if (!endCheck.ok) return endCheck
  // 日期是 YYYY-MM-DD 定长字符串，字典序即时间序，无需转 Date
  if (data.startDate > data.endDate) {
    return { ok: false, msg: '开始日期不能晚于结束日期' }
  }

  const destination = normalizeOptionalText(data.destination, '目的地', DESTINATION_MAX)
  if (!destination.ok) return destination

  const members = normalizeMembers(data.members)
  if (!members.ok) return members

  const budget = normalizeBudget(data.budget)
  if (!budget.ok) return budget

  if (TRAVEL_STATUSES.indexOf(data.status) === -1) {
    return { ok: false, msg: '计划状态不合法（planned/ongoing/done/cancelled）' }
  }

  const note = normalizeOptionalText(data.note, '备注', NOTE_MAX)
  if (!note.ok) return note

  return {
    ok: true,
    value: {
      clientId: data.clientId.trim(),
      title: title.value,
      startDate: data.startDate,
      endDate: data.endDate,
      destination: destination.value,
      members: members.value,
      budget: budget.value,
      status: data.status,
      note: note.value
    }
  }
}

/**
 * 把局部更新合并到既有计划上，得到一份「完整形态」入参，再交给
 * `validatePlanPayload` 复校 —— 保证库里任何一条计划都始终是合法且自洽的。
 *
 * ⚠️ `clientId` 不随 patch 改变（幂等键不可由客户端篡改）。
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
      startDate: pick('startDate'),
      endDate: pick('endDate'),
      destination: pick('destination'),
      members: pick('members'),
      budget: pick('budget'),
      status: pick('status'),
      note: pick('note')
    }
  }
}

// ---------- 行程明细 ----------

/**
 * 校验并归一化一条行程明细（新增 / 更新后复校共用）。
 *
 * ⚠️ 「计划是否存在且属于本家庭」**不在这里校验** —— 纯函数不碰数据库。
 *    该主从约束由 `index.js` 在写库前完成（这是本云函数必须合并
 *    travelPlan / travelItem 的核心原因之一，同 study）。
 */
function validateItemPayload(payload) {
  const data = payload || {}

  const cid = validateClientId(data.clientId)
  if (!cid.ok) return cid

  if (!isNonEmptyString(data.travelId)) {
    return { ok: false, msg: '缺少所属出行计划' }
  }

  const order = normalizeOrder(data.order)
  if (!order.ok) return order

  const time = normalizeOptionalText(data.time, '时间', ITEM_TIME_MAX)
  if (!time.ok) return time

  const activity = validateText(data.activity, '活动', ITEM_ACTIVITY_MAX)
  if (!activity.ok) return activity

  const note = normalizeOptionalText(data.note, '备注', ITEM_NOTE_MAX)
  if (!note.ok) return note

  return {
    ok: true,
    value: {
      clientId: data.clientId.trim(),
      travelId: data.travelId,
      order: order.value,
      time: time.value,
      activity: activity.value,
      note: note.value,
      done: data.done === true
    }
  }
}

/**
 * 把局部更新合并到既有明细上。
 *
 * ⚠️ `travelId` **不可由 patch 修改**：明细换计划之后，
 *    「按计划拉取」（`pullTravelItems(travelId)`）的两个端点都会看不到它 ——
 *    旧计划那边以为被删了、新计划那边从未拉过，等于明细凭空消失。
 *    前端也从不做这件事（表单里的归属由所在计划决定）。
 */
function mergeItemPatch(existing, payload) {
  const base = existing || {}
  const patch = payload || {}
  const pick = (key) => (patch[key] !== undefined ? patch[key] : base[key])

  return {
    ok: true,
    value: {
      clientId: base.clientId,
      travelId: base.travelId,
      order: pick('order'),
      time: pick('time'),
      activity: pick('activity'),
      note: pick('note'),
      done: pick('done')
    }
  }
}

/**
 * 明细列表查询：必须给出所属计划（明细的读取口径就是「某个计划的全部明细」）。
 */
function validateItemQuery(payload) {
  const data = payload || {}
  if (!isNonEmptyString(data.travelId)) {
    return { ok: false, msg: '缺少所属出行计划' }
  }
  return { ok: true, value: { travelId: data.travelId } }
}

/**
 * 分批删除的循环控制（纯逻辑，**注入删除动作**以便单测）。
 *
 * ⚠️ 为什么不能「一次删完」：云数据库单次删除有条数上限，而一个出行计划
 *    可能积累很多条明细。一次删不完就会留下**孤儿明细** ——
 *    计划已经没了、明细还在，前端靠 travelId 找不到计划，界面上根本渲染不出来。
 *    所以按批循环，直到某一批删到 0 条为止。
 *
 * 把「删一批」作为参数注入，是为了让这段控制流能被单元测试穷举：
 * 「单批有上限时会不会继续删」「什么时候停」「达到轮次上限怎么报告」
 * 都是容易写错、又极难在真机上发现的地方。
 *
 * ⚠️ 本函数与 `study/lib.js` 的同名函数是**逐字一致的两份拷贝**
 *    （自包含约束不允许跨模块引用），`tests/travel-lib.test.ts` 有
 *    「两份拷贝在穷举序列上行为一致」的漂移守卫 —— 改一处务必改另一处。
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

// ---------- 云端记录 → 前端形态 ----------

/**
 * 云端计划记录 → 前端 `TravelPlan` 形态。
 *
 * ⚠️ `items` 在云端是**独立集合**，这里由调用方（`index.js` 的 `listPlans`）
 *    把聚合好的明细传进来；缺省时给 `[]` ——
 *    前端 `validateTravelPlan` 要求 `Array.isArray(plan.items)`，
 *    落 `undefined` 会让整条计划被判非法后丢弃。
 */
function toClientPlan(row, items) {
  const doc = row || {}
  const budget = Number(doc.budget)
  return {
    id: doc.clientId || doc._id || '',
    title: typeof doc.title === 'string' ? doc.title : '',
    startDate: doc.startDate || '',
    endDate: doc.endDate || '',
    destination: typeof doc.destination === 'string' ? doc.destination : '',
    // 只保留字符串成员；成员是否存在由展示层兜底（与 normalizeMembers 同口径）
    members: Array.isArray(doc.members)
      ? doc.members.filter((member) => typeof member === 'string')
      : [],
    budget: Number.isFinite(budget) && budget >= BUDGET_MIN ? budget : BUDGET_MIN,
    // 脏数据（状态被改成非法值）兜底为 planned，而不是整条计划被前端丢弃
    status: TRAVEL_STATUSES.indexOf(doc.status) !== -1 ? doc.status : 'planned',
    note: typeof doc.note === 'string' ? doc.note : '',
    items: Array.isArray(items) ? items : []
  }
}

/**
 * 云端明细记录 → 前端 `TravelItem` 形态。
 *
 * `order` 无论云端有没有，都**显式给出一个有限数**（缺省 0）：
 * 前端 `sortTravelItems` 对缺失 `order` 的老数据按下标参与排序，
 * 而云端返回顺序不保证稳定 —— 显式给值才能让两端顺序一致。
 */
function toClientItem(row) {
  const doc = row || {}
  const order = Number(doc.order)
  return {
    id: doc.clientId || doc._id || '',
    order: Number.isFinite(order) && order >= 0 ? Math.floor(order) : 0,
    time: typeof doc.time === 'string' ? doc.time : '',
    activity: typeof doc.activity === 'string' ? doc.activity : '',
    note: typeof doc.note === 'string' ? doc.note : '',
    done: doc.done === true
  }
}

module.exports = {
  TRAVEL_STATUSES,
  CLIENT_ID_MAX,
  TITLE_MAX,
  DESTINATION_MAX,
  NOTE_MAX,
  ITEM_TIME_MAX,
  ITEM_ACTIVITY_MAX,
  ITEM_NOTE_MAX,
  BUDGET_MIN,
  BUDGET_MAX,
  MEMBERS_MAX,
  PLAN_LIST_LIMIT,
  ITEM_LIST_LIMIT,
  MAX_CASCADE_ROUNDS,
  validateDate,
  validateClientId,
  normalizeOptionalText,
  normalizeMembers,
  normalizeBudget,
  normalizeOrder,
  validatePlanPayload,
  mergePlanPatch,
  validateItemPayload,
  mergeItemPatch,
  validateItemQuery,
  deleteInBatches,
  toClientPlan,
  toClientItem
}
