'use strict'

// 账本云函数
// 集合：transactions（家庭收支记录，按日期组织）
//
// 为什么只有一张表、一个云函数：账本没有从属实体，不存在「子记录要校验父存在 /
// 删父要级联删子」的关系 —— 按 M2 确立的判据（**存在主从关系才合并**），
// 它与 diet / meal 同构，与 study / travel 不同。
// 详见 docs/0.4.0-m4-requirements-and-solution.md §2.1。
//
// 安全约定（勿改）：
//   1. familyId 一律由服务端从登录态推导（checkin-shared.resolveContext），
//      绝不使用客户端传入的 familyId；
//   2. update / remove 先按 familyId + clientId 查回记录，查不到即按幂等成功处理，
//      杜绝拿别人的 clientId 跨家庭操作；
//   3. memberId 必须属于本家庭，否则置 null，防止跨家庭串数据。
//
// ⚠️ action 集合与 `meal` 完全同构（list / add / update / remove / listTombstones）
//    —— **没有**批量导入 action。老数据导入复用这里的 `add`，由客户端限并发逐条下发，
//    理由见 §2.1 决策 3（给 8 个域、6 个云函数各加一个批量接口要重传 5 个已部署的
//    云函数；复用既有写接口还能让「导入」与「正常写入」走完全同一条代码路径）。

const db = uniCloud.database()
const dbCmd = db.command
const { resolveContext, resolveMemberId, recordTombstones, listTombstones } =
  require('checkin-shared')
const {
  LIST_LIMIT,
  validateTransactionPayload,
  mergeTransactionPatch,
  validateTransactionQuery,
  buildDateWhere,
  toClientTransaction
} = require('./lib')

const TRANSACTIONS = 'transactions'

exports.main = async (event, context) => {
  const evt = event || {}

  const auth = await resolveContext(context, evt)
  if (!auth.ok) return { code: auth.code, msg: auth.msg }

  const familyId = auth.familyId

  switch (evt.action) {
    case 'list': return listTransactions(familyId, evt)
    case 'add': return addTransaction(familyId, auth.uid, evt)
    case 'update': return updateTransaction(familyId, evt)
    case 'remove': return removeTransaction(familyId, auth.uid, evt)
    case 'listTombstones': return listTransactionTombstones(familyId, evt)
    default: return { code: 400, msg: `未知操作: ${evt.action}` }
  }
}

// 按 familyId + clientId 定位记录（clientId 的幂等域限定在家庭内）
async function findTransaction(familyId, clientId) {
  if (typeof clientId !== 'string' || !clientId) return null
  const res = await db.collection(TRANSACTIONS).where({ familyId, clientId }).limit(1).get()
  return (res.data && res.data[0]) || null
}

/**
 * 列表：按**日期区间**查（账本的读取口径是「某个月」，见 lib.js 的
 * `validateTransactionQuery` 与方案文档 §3.4）。
 *
 * ⚠️ 前端 `ledger.vue` 的汇总卡（收入 / 支出 / 结余）是对当前选中月份的**全部**
 *    记录求和，所以必须按区间一次拉全 —— 只拉单日会让月汇总算出明显偏小的数字。
 */
async function listTransactions(familyId, event) {
  const query = validateTransactionQuery(event)
  if (!query.ok) return { code: 400, msg: query.msg }

  const res = await db
    .collection(TRANSACTIONS)
    .where(Object.assign({ familyId }, buildDateWhere(dbCmd, query.value)))
    .orderBy('date', 'asc')
    .orderBy('createdAt', 'asc')
    .limit(LIST_LIMIT)
    .get()

  return { code: 0, data: (res.data || []).map(toClientTransaction) }
}

async function addTransaction(familyId, uid, event) {
  const checked = validateTransactionPayload(event)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  // 幂等：同一家庭内 clientId 唯一。弱网重试 / 离线队列重投 / 老数据导入的
  // 断点续传重投都不会产生重复记录。
  const existing = await findTransaction(familyId, checked.value.clientId)
  if (existing) return { code: 0, data: { _id: existing._id, duplicated: true } }

  const now = Date.now()
  const doc = await db.collection(TRANSACTIONS).add({
    familyId,
    clientId: checked.value.clientId,
    date: checked.value.date,
    type: checked.value.type,
    amount: checked.value.amount,
    category: checked.value.category,
    memberId: await resolveMemberId(familyId, checked.value.memberId),
    note: checked.value.note,
    createdByUid: uid,
    createdAt: now,
    updatedAt: now
  })

  return { code: 0, data: { _id: doc.id } }
}

/**
 * 更新：先把 patch 合并到既有记录上得到完整形态，再用同一个全量校验复校。
 * 逐字段校验发现不了「单字段 patch 造成的整体矛盾」（例：只改金额成 0）。
 *
 * ⚠️ `date` 不参与更新（`mergeTransactionPatch` 里写死取 base.date）：
 *    前端 `TransactionPatch` 本来就不含 `date`，改了会让记录在按区间的拉取通路里
 *    凭空消失 —— 旧区间拉不到、新区间又从来没推过。
 */
async function updateTransaction(familyId, event) {
  const target = await findTransaction(familyId, event && event.clientId)
  if (!target) return { code: 404, msg: '未找到该收支记录' }

  const merged = mergeTransactionPatch(target, event)
  const checked = validateTransactionPayload(merged.value)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  await db.collection(TRANSACTIONS).doc(target._id).update({
    type: checked.value.type,
    amount: checked.value.amount,
    category: checked.value.category,
    memberId: await resolveMemberId(familyId, checked.value.memberId),
    note: checked.value.note,
    updatedAt: Date.now()
  })

  return { code: 0 }
}

/**
 * 删除收支记录并写墓碑。
 *
 * ⚠️ 两条铁律（与 diet / meal / study 完全一致）：
 * 1. **先删记录，后写墓碑** —— 反过来（墓碑已写而删除失败）会造成「记录复活」：
 *    别的设备删掉了本地记录，而这台设备下次 pull 时云端记录还在；
 * 2. **无论记录是否存在都要写墓碑** —— 墓碑写入失败时客户端会重试，
 *    重试时记录已不存在（`removed: false`），但墓碑还没写，必须能补上。
 *
 * ⚠️ 墓碑里的 `date` 必须尽量带上：前端本地存储是**按日期分区**的
 *    （`family.ledger.v1.<date>`），带上日期别的设备就能直接定位到那个分区；
 *    落空串就只能全量扫描兜底（`src/utils/tombstone.ts` 里两条路径都有）。
 */
async function removeTransaction(familyId, uid, event) {
  const evt = event || {}
  const target = await findTransaction(familyId, evt.clientId)

  if (target) {
    await db.collection(TRANSACTIONS).doc(target._id).remove()
  }

  const date = (target && target.date) || (typeof evt.date === 'string' ? evt.date : '')
  await recordTombstones({
    familyId,
    domain: 'transaction',
    entries: [{ clientId: evt.clientId, date }],
    uid,
    deletedAt: Date.now()
  })

  return { code: 0, data: { removed: !!target } }
}

/** 增量拉取本家庭的账本墓碑，供客户端删除本地残留 */
async function listTransactionTombstones(familyId, event) {
  const res = await listTombstones({
    familyId,
    domains: ['transaction'],
    since: event && event.since,
    now: Date.now()
  })
  return { code: 0, data: res }
}
