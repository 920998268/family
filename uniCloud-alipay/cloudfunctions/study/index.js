'use strict'

// 学习打卡云函数
// 集合：study_plans（学习计划）、study_checkins（学习打卡）
//
// 为什么两个实体放在同一个云函数里（而不是拆成两个）：它们是**主从关系** ——
//   1. 打卡必须先校验「计划存在且属于本家庭」；
//   2. 删除计划要**级联删除**其全部打卡。
// 拆成两个函数的话，级联删除只能落到客户端两步调用上（先删计划、再删打卡），
// 中途失败会留下孤儿打卡，而且客户端得先把该计划散布在各日期的打卡全查出来。
// 详见 docs/0.3.3-m2b-requirements-and-solution.md §2.1。
//
// 安全约定（勿改）：
//   1. familyId 一律由服务端从登录态推导（checkin-shared.resolveContext），
//      绝不使用客户端传入的 familyId；
//   2. update / remove 先按 familyId + clientId 查回记录，查不到即拒绝，
//      杜绝拿别人的 clientId 跨家庭操作；
//   3. memberId 必须属于本家庭，否则置 null，防止跨家庭串数据；
//   4. 打卡的 planId 必须指向**本家庭**的计划，否则拒绝。

const db = uniCloud.database()
const { resolveContext, resolveMemberId, recordTombstones, listTombstones } =
  require('checkin-shared')
const {
  validatePlanPayload,
  mergePlanPatch,
  deleteInBatches,
  validateCheckinPayload,
  validateCheckinQuery,
  toClientPlan,
  toClientCheckin
} = require('./lib')

const PLANS = 'study_plans'
const CHECKINS = 'study_checkins'
const LIST_LIMIT = 500

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
    case 'listCheckins': return listCheckins(familyId, evt)
    case 'addCheckin': return addCheckin(familyId, auth.uid, evt)
    case 'removeCheckin': return removeCheckin(familyId, auth.uid, evt)
    case 'listTombstones': return listStudyTombstones(familyId, evt)
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

// 按 familyId + clientId 定位打卡
async function findCheckin(familyId, clientId) {
  if (typeof clientId !== 'string' || !clientId) return null
  const res = await db.collection(CHECKINS).where({ familyId, clientId }).limit(1).get()
  return (res.data && res.data[0]) || null
}

// ---------- 学习计划 ----------

async function listPlans(familyId) {
  const res = await db
    .collection(PLANS)
    .where({ familyId })
    .orderBy('createdAt', 'desc')
    .limit(LIST_LIMIT)
    .get()

  return { code: 0, data: (res.data || []).map(toClientPlan) }
}

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
    subject: checked.value.subject,
    frequency: checked.value.frequency,
    targetTimes: checked.value.targetTimes,
    memberId: await resolveMemberId(familyId, checked.value.memberId),
    createdByUid: uid,
    createdAt: now,
    updatedAt: now
  })

  return { code: 0, data: { _id: doc.id } }
}

/**
 * 更新计划：先把 patch 合并到既有记录上得到完整形态，再用同一个全量校验复校。
 * 逐字段校验发现不了「单字段 patch 造成的整体矛盾」。
 */
async function updatePlan(familyId, event) {
  const target = await findPlan(familyId, event && event.clientId)
  if (!target) return { code: 404, msg: '未找到该学习计划' }

  const merged = mergePlanPatch(target, event)
  const checked = validatePlanPayload(merged.value)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  await db.collection(PLANS).doc(target._id).update({
    title: checked.value.title,
    subject: checked.value.subject,
    frequency: checked.value.frequency,
    targetTimes: checked.value.targetTimes,
    memberId: await resolveMemberId(familyId, checked.value.memberId),
    updatedAt: Date.now()
  })

  return { code: 0 }
}

/**
 * 删除计划，并**级联删除该计划的全部打卡**。
 *
 * ⚠️ 顺序不能反：必须**先删打卡、再删计划**。
 *    反过来的话，一旦删打卡失败，计划已经没了，就再也定位不到该删哪些打卡 ——
 *    留下永久孤儿记录。
 *
 * ⚠️ 没删完（达到轮次上限）时**不删计划**，返回可重试的失败。
 *    因为每轮删除都有进展，客户端重试就能接着删完；
 *    而带着未删完的打卡删掉计划，才会真正留下孤儿。
 */
/**
 * 收集某计划下全部打卡的身份（clientId + date），用于写级联墓碑。
 *
 * ⚠️ 必须在删除**之前**调用：`where().remove()` 只返回删除条数，拿不到被删文档，
 *    而墓碑需要 clientId，别的设备才能定位到该删哪几条。
 *
 * ⚠️ 上限 `LIST_LIMIT`（500）：一个计划的打卡数按天计，500 条约等于一年半，
 *    实际不可能达到；真超了也只是墓碑不全，不会造成错误删除。
 */
async function collectCheckinRefs(familyId, planId) {
  const res = await db.collection(CHECKINS).where({ familyId, planId }).limit(LIST_LIMIT).get()
  return (res.data || []).map((doc) => ({ clientId: doc.clientId, date: doc.date }))
}

/**
 * 删除学习计划，**级联删除其全部打卡**，并为计划与被删打卡各写墓碑。
 *
 * ⚠️ 墓碑只在**全部删完之后**才写：`truncated`（没删完）时直接返回可重试的失败，
 *    一条墓碑都不写。
 *    理由：此时云端仍留着没删完的打卡，若先写墓碑，别的设备会删掉本地打卡，
 *    而下次 pull 时云端还有 → 记录复活。等删完再写，行为干净且可重试。
 */
async function removePlan(familyId, uid, event) {
  const planId = event && event.clientId
  const target = await findPlan(familyId, planId)
  if (!target) return { code: 0, data: { removed: false, deletedCheckins: 0 } }

  const checkinRefs = await collectCheckinRefs(familyId, target.clientId)

  const cascade = await deleteInBatches(async () => {
    const res = await db
      .collection(CHECKINS)
      .where({ familyId, planId: target.clientId })
      .remove()
    return (res && res.deleted) || 0
  })

  if (cascade.truncated) {
    return { code: 500, msg: '该计划的历史打卡较多，本次未清理完，请稍后重试' }
  }

  const now = Date.now()

  // 先给打卡写墓碑，再删计划：两者都成功后整体才算完成。
  // 顺序反了（计划先没）会失去「该删哪些打卡」的依据，留下永久孤儿。
  await recordTombstones({
    familyId,
    domain: 'studyCheckin',
    entries: checkinRefs,
    uid,
    deletedAt: now,
  })

  await db.collection(PLANS).doc(target._id).remove()

  await recordTombstones({
    familyId,
    domain: 'studyPlan',
    entries: [{ clientId: target.clientId, date: '' }],
    uid,
    deletedAt: now,
  })

  return { code: 0, data: { removed: true, deletedCheckins: cascade.deleted } }
}

/** 增量拉取本家庭的学习墓碑（计划 + 打卡两类，一次返回） */
async function listStudyTombstones(familyId, event) {
  const res = await listTombstones({
    familyId,
    domains: ['studyPlan', 'studyCheckin'],
    since: event && event.since,
    now: Date.now(),
  })
  return { code: 0, data: res }
}

// ---------- 学习打卡 ----------

async function listCheckins(familyId, event) {
  const query = validateCheckinQuery(event)
  if (!query.ok) return { code: 400, msg: query.msg }

  const res = await db
    .collection(CHECKINS)
    .where({ familyId, date: query.value.date })
    .orderBy('createdAt', 'asc')
    .limit(LIST_LIMIT)
    .get()

  return { code: 0, data: (res.data || []).map(toClientCheckin) }
}

async function addCheckin(familyId, uid, event) {
  const checked = validateCheckinPayload(event)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  // 主从约束：计划必须存在，且属于本家庭。
  // 这是「学习打卡从属于学习计划」这条规则的实际落地，也是两个实体
  // 必须放在同一个云函数里的原因之一。
  const plan = await findPlan(familyId, checked.value.planId)
  if (!plan) return { code: 404, msg: '未找到该学习计划' }

  // 幂等一：同一条打卡重复投递
  const existing = await findCheckin(familyId, checked.value.clientId)
  if (existing) return { code: 0, data: { _id: existing._id, duplicated: true } }

  // 幂等二：同一计划同一天只能打卡一次（对应本地 StudyService 的「该计划今天已打卡」）。
  // 这里是应用层预检，给出一致的语义；并发时仍靠唯一索引兜底。
  const sameDay = await db
    .collection(CHECKINS)
    .where({
      familyId,
      planId: checked.value.planId,
      date: checked.value.date
    })
    .limit(1)
    .get()
  if (sameDay.data && sameDay.data[0]) {
    return { code: 0, data: { _id: sameDay.data[0]._id, duplicated: true } }
  }

  const now = Date.now()
  const payload = {
    familyId,
    clientId: checked.value.clientId,
    planId: checked.value.planId,
    date: checked.value.date,
    note: checked.value.note,
    memberId: await resolveMemberId(familyId, checked.value.memberId),
    createdByUid: uid,
    createdAt: now,
    updatedAt: now
  }

  try {
    const doc = await db.collection(CHECKINS).add(payload)
    return { code: 0, data: { _id: doc.id } }
  } catch (e) {
    // 并发下两个请求可能同时通过上面的预检，此时由
    // 唯一索引 familyId + planId + date 兜底。
    // ⚠️ 冲突要转成 duplicated（成功语义），不能把 provider 的错误码抛给前端 ——
    //    否则离线队列会把它当失败而反复重试。
    if (isDuplicateKeyError(e)) {
      return { code: 0, data: { duplicated: true } }
    }
    throw e
  }
}

/**
 * 删除打卡。与 diet / workout 一致，**刻意做成幂等**：
 * 记录不存在时同样返回成功 —— 「记录不存在」本身就等于目标已达成，
 * 返回 404 会让离线队列把已删成功的记录当成失败而无限重试。
 */
/**
 * 删除学习打卡并写墓碑。两条铁律同 `diet` 云函数：
 * **先删记录后写墓碑**，且**无论记录是否存在都要写**（便于重试补写）。
 */
async function removeCheckin(familyId, uid, event) {
  const evt = event || {}
  const target = await findCheckin(familyId, evt.clientId)

  if (target) {
    await db.collection(CHECKINS).doc(target._id).remove()
  }

  await recordTombstones({
    familyId,
    domain: 'studyCheckin',
    entries: [{ clientId: evt.clientId, date: (target && target.date) || evt.date || '' }],
    uid,
    deletedAt: Date.now(),
  })

  return { code: 0, data: { removed: !!target } }
}
