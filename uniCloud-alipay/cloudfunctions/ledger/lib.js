'use strict'

// 账本云函数 —— 纯逻辑模块（可单元测试，不依赖 uniCloud）
//
// 集合只有一张（`transactions`），没有主从关系，所以这里是「一块」而不是两块。
// 判据见 docs/0.4.0-m4-requirements-and-solution.md §2.1：
// **只有存在主从关系（子记录要校验父存在、删父要级联删子）才合并云函数。**
// 这一点与 `meal` 相同，与 `study`（计划 + 打卡）、`travel`（计划 + 明细）不同。
//
// ⚠️ 本模块自包含（不 require 任何其它模块），才能被单元测试直接加载。
//    与 diet / workout / meal / travel 的 lib.js 保持同样的取舍：
//    少量工具函数各自复制一份，换取「纯逻辑 100% 可测」。
//
// ⚠️ 本文件的长度 / 数值上限必须与前端 `src/utils/limits.ts` 的 `LEDGER_LIMITS`
//    以及 `src/utils/validation.ts` 的 `validateTransaction` 一致，由
//    `tests/ui-limits.test.ts` 与 `tests/ledger-schema.test.ts` 守卫。
//    不一致会造成最隐蔽的一类数据丢失：本地写入成功 → 推云端 400 →
//    重试 5 次后丢弃待同步标记 → 记录永久留在本地。

const TRANSACTION_TYPES = ['income', 'expense']

/**
 * 脏数据（`type` 被改成非法值）的兜底值。
 *
 * ⚠️ 这里**不用** `TRANSACTION_TYPES[0]`（= income），与 `travel` 兜底 `TRAVEL_STATUSES[0]`
 *    的写法刻意不同：`income` 会让「收入」和「结余」凭空变大，
 *    把「这条数据坏了」伪装成「多了一笔收入」，用户完全无从察觉。
 *    兜底成 `expense` 则表现为结余偏小 —— 异常方向与数据损坏方向一致，更容易被发现。
 */
const TRANSACTION_FALLBACK_TYPE = 'expense'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CLIENT_ID_RE = /^[A-Za-z0-9_-]+$/
const CLIENT_ID_MAX = 64
const CATEGORY_MAX = 20
const NOTE_MAX = 100

// 与前端 `numberError(entry.amount, '金额', 0.01, 100000000)` 的边界逐项一致
const AMOUNT_MIN = 0.01
const AMOUNT_MAX = 100000000

/** 单次拉取上限（防御性）。见 validateTransactionQuery 的注释。 */
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

/**
 * 可空 id 字段（`memberId`）：**不适用「可空文本落 `''`」规则**。
 *
 * 前端 `optionalIdError` 的判据是 `value === undefined || value === null` → 合法，
 * 落 `''` 反而会被判成「记账成员不合法」（`typeof '' === 'string'` 但 `!value`）。
 * 所以这里必须落 `null`，由映射层负责 `null` ↔ `undefined` 换算。
 * 与 `diet/lib.js` 的 `normalizeOptionalId` 完全一致。
 */
function normalizeOptionalId(value, label) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string' || value.length > CLIENT_ID_MAX) {
    return { ok: false, msg: `${label}不合法` }
  }
  return { ok: true, value }
}

// 金额：必须是有限数且在 [AMOUNT_MIN, AMOUNT_MAX] 内。
// 注意不做四舍五入 —— 前端 `Transaction.amount` 就是自由小数，四舍五入会凭空改数。
function validateAmount(value) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return { ok: false, msg: '金额必须是数字' }
  if (n < AMOUNT_MIN || n > AMOUNT_MAX) {
    return { ok: false, msg: `金额需要在 ${AMOUNT_MIN} 到 ${AMOUNT_MAX} 之间` }
  }
  return { ok: true, value: n }
}

function validateText(value, label, max) {
  if (!isNonEmptyString(value)) return { ok: false, msg: `${label}不能为空` }
  const trimmed = value.trim()
  if (trimmed.length > max) return { ok: false, msg: `${label}长度需在 1~${max} 字之间` }
  return { ok: true, value: trimmed }
}

/**
 * 可选文本字段（备注）：允许缺省、空串、null，统一落成字符串。
 *
 * ⚠️ 必须落成 `''` 而**不能落 `null`**：前端 `validateTransaction` 要求
 *    `typeof entry.note === 'string'`。落 `null` 会让整条记录在前端被判非法，
 *    被 `LedgerRepository.readByKey` **静默丢弃** —— 本地/云上却明明写成功了。
 *    与 `meal/lib.js` 的 `normalizeOptionalText`、`study/lib.js` 的 `normalizeNote` 一致。
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
 * 校验并归一化一条收支记录（新增 / 更新后复校共用）。
 * 返回的 value 即最终要落库的字段（不含 familyId / createdAt 等由服务端补齐的部分）。
 */
function validateTransactionPayload(payload) {
  const data = payload || {}

  const cid = validateClientId(data.clientId)
  if (!cid.ok) return cid

  const dateCheck = validateDate(data.date)
  if (!dateCheck.ok) return dateCheck

  if (TRANSACTION_TYPES.indexOf(data.type) === -1) {
    return { ok: false, msg: '收支类型取值不合法（income/expense）' }
  }

  const amount = validateAmount(data.amount)
  if (!amount.ok) return amount

  // ⚠️ `category` 刻意**不做白名单枚举**。
  //    前端分类是常量表（`EXPENSE_CATEGORIES` 8 项 / `INCOME_CATEGORIES` 6 项），
  //    而历史数据里的分类可能不在当前表内（用户改过分类常量就会发生）。
  //    加了白名单，这些记录会**导入失败**——而它们正是本期「老数据认领」要搬上云的东西。
  //    只校验「非空字符串 + 长度上限」（与前端 `category` 的判据一致）。
  const category = validateText(data.category, '分类', CATEGORY_MAX)
  if (!category.ok) return category

  const member = normalizeOptionalId(data.memberId, '记账成员')
  if (!member.ok) return member

  const note = normalizeOptionalText(data.note, '备注', NOTE_MAX)
  if (!note.ok) return note

  return {
    ok: true,
    value: {
      clientId: data.clientId.trim(),
      date: data.date,
      type: data.type,
      amount: amount.value,
      category: category.value,
      memberId: member.value,
      note: note.value
    }
  }
}

/**
 * 把局部更新合并到既有记录上，得到一份「完整形态」入参，
 * 再交给 `validateTransactionPayload` 复校 —— 这样即使 patch 只改了备注，
 * 也能校验出整体是否仍合法。逐字段校验发现不了「单字段 patch 造成的整体矛盾」。
 *
 * ⚠️ `date` **不可由 patch 修改**（与 `clientId` 同等对待）：
 *    前端 `TransactionPatch = Partial<Omit<Transaction, 'id' | 'date'>>` 本来就不含 `date`，
 *    本地 `LedgerService.update(date, id, patch)` 也把 `date` 写死。
 *    云端若允许改 `date`，记录的所属日期就会与本地分叉 ——
 *    而拉取通路 `pullTransactions(from, to)` 是按日期区间查的，
 *    改了日期的记录会在旧区间下凭空消失、又在新区间里突然出现。
 */
function mergeTransactionPatch(existing, payload) {
  const base = existing || {}
  const patch = payload || {}
  const pick = (key) => (patch[key] !== undefined ? patch[key] : base[key])

  return {
    ok: true,
    value: {
      clientId: base.clientId,
      date: base.date,
      type: pick('type'),
      amount: pick('amount'),
      category: pick('category'),
      memberId: pick('memberId'),
      note: pick('note')
    }
  }
}

/**
 * 列表查询：**只支持日期区间**，且 `from` / `to` 都必须给。
 *
 * 为什么不做「全量拉」：账本没有「所有月份一屏看」的页面，全量拉只会把无界的数据量
 * 搬到每次进页面时。为什么不做「按单日拉」：`ledger.vue` 的汇总卡
 * （收入 / 支出 / 结余）是对**当前选中月份**的全部记录求和，只拉当天会让
 * 月汇总基于残缺数据算出**明显偏小的数字**，用户立刻会察觉账目不对。
 * 详见 docs/0.4.0-m4-requirements-and-solution.md §3.4。
 *
 * ⚠️ `from` / `to` **两个都要给**（不是「至少一个」）：只给一端就是一次无界查询，
 *    正是上面明确否掉的那件事。强制两端齐全，让「忘了传区间」变成**显性报错**，
 *    而不是一次静默的全表扫描。
 *
 * `LIST_LIMIT` 是防御性上限：按月拉取时，一个家庭要连续 31 天每天记 16 笔以上
 * 才会触到 500 —— 真触到说明用法已经异常，此时截断会让汇总偏小（不比静默返回错误数据更坏）。
 */
function validateTransactionQuery(payload) {
  const data = payload || {}

  const from = data.from
  const to = data.to
  if (!isNonEmptyString(from) || !isNonEmptyString(to)) {
    return { ok: false, msg: '缺少查询区间（from / to 均必填）' }
  }

  const fromCheck = validateDate(from, '起始日期')
  if (!fromCheck.ok) return fromCheck
  const toCheck = validateDate(to, '结束日期')
  if (!toCheck.ok) return toCheck

  if (from > to) return { ok: false, msg: '起始日期不能晚于结束日期' }

  return { ok: true, value: { from, to } }
}

/**
 * 把 `validateTransactionQuery` 的结果转成云数据库的 where 片段。
 * 传入 `dbCmd` 而非直接引用 uniCloud，保证本函数可单元测试。
 */
function buildDateWhere(dbCmd, query) {
  const q = query || {}
  return { date: dbCmd.gte(q.from).and(dbCmd.lte(q.to)) }
}

/**
 * 云端记录 → 前端 `Transaction` 形态。
 *
 * ⚠️ 输出必须能被前端 `validateTransaction` 接受（`tests/ledger-lib.test.ts` 有守卫）：
 *    `id` 非空、`type` 合法、`amount` 是 [0.01, 1e8] 内的有限数、
 *    `category` 非空、`date` 合法、`note` 是字符串。
 *    数值兜底取边界值（而非 `0` / 直接透传），是为了让脏数据**留下**而不是
 *    被前端仓储静默丢弃 —— 与 `travel/lib.js` 的 `budget → BUDGET_MIN`、
 *    `order → 0` 同一取舍。
 */
function toClientTransaction(row) {
  const doc = row || {}
  const amount = Number(doc.amount)
  return {
    id: doc.clientId || doc._id || '',
    // 脏数据（type 被改成非法值）兜底为 expense，而不是整条记录被前端丢弃
    type: TRANSACTION_TYPES.indexOf(doc.type) !== -1 ? doc.type : TRANSACTION_FALLBACK_TYPE,
    amount: Number.isFinite(amount) && amount >= AMOUNT_MIN && amount <= AMOUNT_MAX ? amount : AMOUNT_MIN,
    category: typeof doc.category === 'string' ? doc.category : '',
    date: doc.date || '',
    // `memberId` 是 id 型可选字段：缺省落 `undefined`（前端 `optionalIdError`
    // 对 `undefined` / `null` 都判合法，但映射层统一约定用 `undefined` 表示「无」）
    memberId: doc.memberId === undefined || doc.memberId === null || doc.memberId === '' ? undefined : doc.memberId,
    note: typeof doc.note === 'string' ? doc.note : ''
  }
}

module.exports = {
  TRANSACTION_TYPES,
  TRANSACTION_FALLBACK_TYPE,
  CLIENT_ID_MAX,
  CATEGORY_MAX,
  NOTE_MAX,
  AMOUNT_MIN,
  AMOUNT_MAX,
  LIST_LIMIT,
  validateDate,
  validateClientId,
  normalizeOptionalId,
  validateAmount,
  normalizeOptionalText,
  validateTransactionPayload,
  mergeTransactionPatch,
  validateTransactionQuery,
  buildDateWhere,
  toClientTransaction
}
