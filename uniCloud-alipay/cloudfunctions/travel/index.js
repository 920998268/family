'use strict'

// 出行计划云函数
// 集合：travels（出行计划）、travel_items（行程明细）
//
// 为什么两个实体放在同一个云函数里（而不是拆成两个）：它们是**主从关系** ——
//   1. 明细必须先校验「计划存在且属于本家庭」；
//   2. 删除计划要**级联删除**其全部明细。
// 拆成两个函数的话，级联删除只能落到客户端两步调用上（先删计划、再删明细），
// 中途失败会留下孤儿明细 —— 计划已经没了、明细还在，前端靠 travelId 找不到计划，
// 界面上根本渲染不出来。判据与 study（计划 + 打卡）完全一致。
// 详见 docs/0.3.5-m3-requirements-and-solution.md §2.1 / §3.2。
//
// 安全约定（勿改）：
//   1. familyId 一律由服务端从登录态推导（checkin-shared.resolveContext），
//      绝不使用客户端传入的 familyId；
//   2. update / remove 先按 familyId + clientId 查回记录，查不到即拒绝/幂等成功，
//      杜绝拿别人的 clientId 跨家庭操作；
//   3. 明细的 travelId 必须指向**本家庭**的计划，否则拒绝。
//
// ⚠️ 本期与 M2 最本质的差异：明细是**记录级 CRUD**（不整包覆盖）。
//    `toggleItem` 只写 `done` 一个字段，所以两人同时勾选同一计划的不同明细
//    不会互相覆盖 —— 这是把 items 拆成独立集合的直接收益（方案 §3.5）。
//
// ⚠️⚠️ 墓碑 domain 用到了 `travelPlan` / `travelItem`，它们**尚未加入**
//    `checkin-shared/lib.js` 的 `TOMBSTONE_DOMAINS`（当前只有 4 个值）。
//    `buildTombstoneDocs` 对未知 domain 直接返回 `[]`（**不报错**）——
//    也就是说在补齐之前，删除会「本地成功、云端无痕、别的设备永不同步」。
//    补齐属方案 §7 第 6 步，且部署必须排在第 6 步之后。

const db = uniCloud.database()
const { resolveContext, recordTombstones, listTombstones } = require('checkin-shared')
const {
  validatePlanPayload,
  mergePlanPatch,
  validateItemPayload,
  mergeItemPatch,
  validateItemQuery,
  deleteInBatches,
  toClientPlan,
  toClientItem
} = require('./lib')

const PLANS = 'travels'
const ITEMS = 'travel_items'
/** 计划列表上限：家庭出行计划是低频数据，200 足够 */
const PLAN_LIST_LIMIT = 200
/** 明细列表上限（单次 where 查询） */
const ITEM_LIST_LIMIT = 500
const MAX_CASCADE_ROUNDS = 20

exports.main = async (event, context) => {
  const evt = event || {}

  const auth = await resolveContext(context, evt)
  if (!auth.ok) return { code: auth.code, msg: auth.msg }

  const familyId = auth.familyId

  switch (evt.action) {
    case 'listPlans': return listPlans(familyId)
    case 'addPlan': return addPlan(familyId, auth.uid, evt)
    case 'updatePlan': return updatePlan(familyId, evt)
    case 'removePlan': return removePlan(familyId, auth.uid, evt)
    case 'listItems': return listItems(familyId, evt)
    case 'addItem': return addItem(familyId, auth.uid, evt)
    case 'updateItem': return updateItem(familyId, evt)
    case 'toggleItem': return toggleItem(familyId, evt)
    case 'removeItem': return removeItem(familyId, auth.uid, evt)
    case 'listTombstones': return listTravelTombstones(familyId, evt)
    default: return { code: 400, msg: `未知操作: ${evt.action}` }
  }
}

/**
 * 判断是否为「唯一索引冲突」。
 *
 * ⚠️ 各 provider（阿里云 / 腾讯云 / 支付宝云）返回的错误码与文案都不一致，
 *    所以用宽松匹配。只匹配明确的唯一性关键词，避免把别的错误也当成重复。
 */
function isDuplicateKeyError(error) {
  const e = error || {}
  if (Number(e.code) === 11000 || Number(e.errCode) === 11000) return true
  const text = String(e.message || e.errMsg || e.errCode || e.code || '')
  return /duplicate|E11000|唯一|UNIQUE/i.test(text)
}

// 按 familyId + clientId 定位计划（clientId 的幂等域限定在家庭内）
async function findPlan(familyId, clientId) {
  if (typeof clientId !== 'string' || !clientId) return null
  const res = await db.collection(PLANS).where({ familyId, clientId }).limit(1).get()
  return (res.data && res.data[0]) || null
}

// 按 familyId + clientId 定位明细
async function findItem(familyId, clientId) {
  if (typeof clientId !== 'string' || !clientId) return null
  const res = await db.collection(ITEMS).where({ familyId, clientId }).limit(1).get()
  return (res.data && res.data[0]) || null
}

// ---------- 出行计划 ----------

/**
 * 全量返回本家庭出行计划，并把明细聚合进 `items` 供首屏直接渲染。
 *
 * ⚠️ 这里的 `items` 是**首屏渲染的便捷聚合，不是明细的权威口径**：
 *    它是「全家庭一次查、上限 500 条」，家庭明细总数超过上限时会被截断。
 *    权威口径是 `listItems(travelId)`（按计划查，天然有界）。
 *    前端**不得**拿这里的 items 做「本地有、这里没有 → 判定被删」的推断，
 *    否则明细多的家庭会出现「明细凭空消失」。
 */
async function listPlans(familyId) {
  const planRes = await db
    .collection(PLANS)
    .where({ familyId })
    .orderBy('startDate', 'desc')
    .limit(PLAN_LIST_LIMIT)
    .get()

  const plans = planRes.data || []
  if (plans.length === 0) return { code: 0, data: [] }

  const itemRes = await db
    .collection(ITEMS)
    .where({ familyId })
    .orderBy('order', 'asc')
    .limit(ITEM_LIST_LIMIT)
    .get()

  const itemsByTravel = {}
  for (const row of itemRes.data || []) {
    const travelId = row && row.travelId
    if (typeof travelId !== 'string' || !travelId) continue
    if (!itemsByTravel[travelId]) itemsByTravel[travelId] = []
    itemsByTravel[travelId].push(toClientItem(row))
  }

  return {
    code: 0,
    data: plans.map((row) => toClientPlan(row, itemsByTravel[row.clientId] || []))
  }
}

/**
 * 新增计划。
 *
 * ⚠️ **只写计划本体，不含明细**：表单提交时明细由前端 `computeItemDiff` 拆成
 *    `addItem` / `updateItem` / `removeItem` 逐条下发（方案 §3.5 第 3 点）。
 *    把 items 一起塞进来的话，就退化成「整包覆盖」—— 并发编辑会互相覆盖。
 */
async function addPlan(familyId, uid, event) {
  const checked = validatePlanPayload(event)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  // 幂等：同一家庭内 clientId 唯一。弱网重试 / 离线队列重投都不会产生重复计划。
  const existing = await findPlan(familyId, checked.value.clientId)
  if (existing) return { code: 0, data: { _id: existing._id, duplicated: true } }

  const now = Date.now()
  const doc = await db.collection(PLANS).add({
    familyId,
    clientId: checked.value.clientId,
    title: checked.value.title,
    startDate: checked.value.startDate,
    endDate: checked.value.endDate,
    destination: checked.value.destination,
    // ⚠️ members 只做形状归一（去重 / 剔除空值），**不校验成员是否还存在**：
    //    成员被移出家庭不该让出行计划消失或变形（方案 §5 风险 3）。
    //    前端渲染时按自己的成员表映射，映射不到就当作未知成员展示。
    members: checked.value.members,
    budget: checked.value.budget,
    status: checked.value.status,
    note: checked.value.note,
    createdByUid: uid,
    createdAt: now,
    updatedAt: now
  })

  return { code: 0, data: { _id: doc.id } }
}

async function updatePlan(familyId, event) {
  const target = await findPlan(familyId, event && event.clientId)
  if (!target) return { code: 404, msg: '未找到该出行计划' }

  const merged = mergePlanPatch(target, event)
  const checked = validatePlanPayload(merged.value)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  await db.collection(PLANS).doc(target._id).update({
    title: checked.value.title,
    startDate: checked.value.startDate,
    endDate: checked.value.endDate,
    destination: checked.value.destination,
    members: checked.value.members,
    budget: checked.value.budget,
    status: checked.value.status,
    note: checked.value.note,
    updatedAt: Date.now()
  })

  return { code: 0 }
}

/**
 * 收集某计划下全部明细的身份（clientId），用于写级联墓碑。
 *
 * ⚠️ 必须在删除**之前**调用：`where().remove()` 只返回删除条数，拿不到被删文档，
 *    而墓碑需要 clientId，别的设备才能定位到该删哪几条。
 *
 * ⚠️ 上限 `ITEM_LIST_LIMIT`（500）：一个出行计划的明细按天计，正常十几条，
 *    500 条已远超实际；真超了也只是墓碑不全，不会造成错误删除。
 */
async function collectItemRefs(familyId, travelId) {
  const res = await db
    .collection(ITEMS)
    .where({ familyId, travelId })
    .limit(ITEM_LIST_LIMIT)
    .get()
  // 明细的墓碑靠 clientId 定位（明细 id 全局唯一，形如 trip-<uuid>），不依赖 date；
  // 前端需在全部计划的 items 里查找该 id。
  return (res.data || []).map((doc) => ({ clientId: doc.clientId, date: '' }))
}

/**
 * 删除出行计划，**级联删除其全部明细**，并为计划与被删明细各写墓碑。
 *
 * ⚠️ 顺序不能反：必须**先删明细、再删计划**。
 *    反过来的话，一旦删明细失败，计划已经没了，就再也定位不到该删哪些明细 ——
 *    留下永久孤儿。
 *
 * ⚠️ 没删完（达到轮次上限）时**不删计划、不写任何墓碑**，返回可重试的失败。
 *    因为每轮删除都有进展，客户端重试就能接着删完；而带着未删完的明细删掉计划，
 *    才会真正留下孤儿。若先写了墓碑，别的设备会删掉本地明细，而下次 pull 时
 *    云端还有 → 记录复活。
 *
 * ⚠️ **计划墓碑写在 `if (target)` 之外**：计划记录不存在也要写。
 *    与 `removeItem` / `removeMeal` 的无条件补写口径一致，理由同样是重试：
 *    「计划已删、写墓碑失败」时客户端会重试，重试时 `findPlan` 已经找不到记录了 ——
 *    若此时早返回，这条墓碑**永远补不上**，别的设备的本地副本不会消失，
 *    还有被再次推上去复活的风险。
 *    计划不存在时不级联（服务端不会出现「有明细没计划」：`addItem` 强制校验计划归属，
 *    删计划又必然级联删明细），所以那条路径只补墓碑、不碰明细。
 *    本地明细是嵌在计划里的（`TravelPlan.items`），计划墓碑一到，
 *    该计划的明细会随之消失，所以这条路径不需要明细墓碑。
 */
async function removePlan(familyId, uid, event) {
  const evt = event || {}
  const clientId = evt.clientId
  const target = await findPlan(familyId, clientId)

  let deletedItems = 0

  if (target) {
    const itemRefs = await collectItemRefs(familyId, target.clientId)

    const cascade = await deleteInBatches(
      async () => {
        const res = await db
          .collection(ITEMS)
          .where({ familyId, travelId: target.clientId })
          .remove()
        return (res && res.deleted) || 0
      },
      { maxRounds: MAX_CASCADE_ROUNDS }
    )

    if (cascade.truncated) {
      return { code: 500, msg: '该计划的行程明细较多，本次未清理完，请稍后重试' }
    }

    deletedItems = cascade.deleted

    // 先给明细写墓碑，再删计划：两者都成功后整体才算完成。
    // 顺序反了（计划先没）会失去「该删哪些明细」的依据，留下永久孤儿。
    await recordTombstones({
      familyId,
      domain: 'travelItem',
      entries: itemRefs,
      uid,
      deletedAt: Date.now()
    })

    await db.collection(PLANS).doc(target._id).remove()
  }

  // ⚠️ 无条件写（记录不存在也写）：这条是重试补写的唯一机会，详见函数头注释
  await recordTombstones({
    familyId,
    domain: 'travelPlan',
    entries: [{ clientId, date: '' }],
    uid,
    deletedAt: Date.now()
  })

  return { code: 0, data: { removed: !!target, deletedItems } }
}

// ---------- 行程明细 ----------

/** 某个计划的全部明细（**明细的权威读取口径**，天然有界） */
async function listItems(familyId, event) {
  const query = validateItemQuery(event)
  if (!query.ok) return { code: 400, msg: query.msg }

  const res = await db
    .collection(ITEMS)
    .where({ familyId, travelId: query.value.travelId })
    .orderBy('order', 'asc')
    .limit(ITEM_LIST_LIMIT)
    .get()

  return { code: 0, data: (res.data || []).map(toClientItem) }
}

async function addItem(familyId, uid, event) {
  const checked = validateItemPayload(event)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  // 主从约束：计划必须存在，且属于本家庭。
  // 这是「行程明细从属于出行计划」这条规则的实际落地，也是两个实体
  // 必须放在同一个云函数里的原因之一。
  const plan = await findPlan(familyId, checked.value.travelId)
  if (!plan) return { code: 404, msg: '未找到该出行计划' }

  // 幂等：同一家庭内 clientId 唯一（明细 id 全局唯一，跨计划也不会撞）
  const existing = await findItem(familyId, checked.value.clientId)
  if (existing) return { code: 0, data: { _id: existing._id, duplicated: true } }

  const now = Date.now()
  const payload = {
    familyId,
    clientId: checked.value.clientId,
    travelId: checked.value.travelId,
    order: checked.value.order,
    time: checked.value.time,
    activity: checked.value.activity,
    note: checked.value.note,
    done: checked.value.done,
    createdByUid: uid,
    createdAt: now,
    updatedAt: now
  }

  try {
    const doc = await db.collection(ITEMS).add(payload)
    return { code: 0, data: { _id: doc.id } }
  } catch (e) {
    // 并发下两个请求可能同时通过上面的预检，此时由唯一索引 familyId + clientId 兜底。
    // ⚠️ 冲突要转成 duplicated（成功语义），不能把 provider 的错误码抛给前端 ——
    //    否则离线队列会把它当失败而反复重试。
    if (isDuplicateKeyError(e)) {
      return { code: 0, data: { duplicated: true } }
    }
    throw e
  }
}

/**
 * 更新明细：同样走「合并成完整形态 → 全量复校」。
 *
 * ⚠️ `travelId` 不参与更新（`mergeItemPatch` 里写死取 base.travelId）：
 *    明细换计划会让按计划拉取的两个端点都看不到它，等于凭空消失。
 */
async function updateItem(familyId, event) {
  const target = await findItem(familyId, event && event.clientId)
  if (!target) return { code: 404, msg: '未找到该行程明细' }

  const merged = mergeItemPatch(target, event)
  const checked = validateItemPayload(merged.value)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  await db.collection(ITEMS).doc(target._id).update({
    order: checked.value.order,
    time: checked.value.time,
    activity: checked.value.activity,
    note: checked.value.note,
    done: checked.value.done,
    updatedAt: Date.now()
  })

  return { code: 0 }
}

/**
 * 勾选 / 取消勾选某条明细。
 *
 * ⚠️ 这是记录级写入，**只改 `done`**（不重写整个 items 数组）。
 *    因此两人同时勾选同一计划的不同明细不会互相覆盖 ——
 *    这是把 items 拆成独立集合的核心收益，也是本地 `TravelService`
 *    的整包覆盖语义必须一起改掉的原因（否则离线补传时两套语义打架）。
 */
async function toggleItem(familyId, event) {
  const target = await findItem(familyId, event && event.clientId)
  if (!target) return { code: 404, msg: '未找到该行程明细' }

  const next = target.done !== true
  const merged = mergeItemPatch(target, { done: next })
  const checked = validateItemPayload(merged.value)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  await db.collection(ITEMS).doc(target._id).update({
    done: checked.value.done,
    updatedAt: Date.now()
  })

  return { code: 0, data: { done: checked.value.done } }
}

/**
 * 删除明细。与其它模块一致，**刻意做成幂等**：
 * 记录不存在时同样返回成功 —— 「记录不存在」本身就等于目标已达成，
 * 返回 404 会让离线队列把已删成功的记录当成失败而无限重试。
 */
async function removeItem(familyId, uid, event) {
  const evt = event || {}
  const target = await findItem(familyId, evt.clientId)

  if (target) {
    await db.collection(ITEMS).doc(target._id).remove()
  }

  await recordTombstones({
    familyId,
    domain: 'travelItem',
    entries: [{ clientId: evt.clientId, date: '' }],
    uid,
    deletedAt: Date.now()
  })

  return { code: 0, data: { removed: !!target } }
}

/** 增量拉取本家庭的出行墓碑（计划 + 明细两类，一次返回） */
async function listTravelTombstones(familyId, event) {
  const res = await listTombstones({
    familyId,
    domains: ['travelPlan', 'travelItem'],
    since: event && event.since,
    now: Date.now()
  })
  return { code: 0, data: res }
}
