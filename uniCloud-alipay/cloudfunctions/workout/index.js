'use strict'

// 运动打卡云函数
// 集合：workouts（力量 + 有氧共用一张表，靠 category 区分）
//
// 安全约定（勿改）：
//   1. familyId 一律由服务端从登录态推导（checkin-shared.resolveContext），
//      绝不使用客户端传入的 familyId；
//   2. update / remove 先按 familyId + clientId 查回记录，查不到即拒绝，
//      杜绝拿别人的 clientId 跨家庭操作；
//   3. memberId 必须属于本家庭，否则置 null，防止跨家庭串数据。

const db = uniCloud.database()
const dbCmd = db.command
const { resolveContext, resolveMemberId } = require('checkin-shared')
const {
  validateWorkoutPayload,
  mergeWorkoutPatch,
  validateListQuery,
  buildDateWhere,
  toClientWorkout
} = require('./lib')

const WORKOUTS = 'workouts'
const LIST_LIMIT = 500

exports.main = async (event, context) => {
  const evt = event || {}

  const auth = await resolveContext(context, evt)
  if (!auth.ok) return { code: auth.code, msg: auth.msg }

  const familyId = auth.familyId

  switch (evt.action) {
    case 'list': return listWorkouts(familyId, evt)
    case 'add': return addWorkout(familyId, auth.uid, evt)
    case 'update': return updateWorkout(familyId, evt)
    case 'remove': return removeWorkout(familyId, evt)
    default: return { code: 400, msg: `未知操作: ${evt.action}` }
  }
}

async function findWorkout(familyId, clientId) {
  if (typeof clientId !== 'string' || !clientId) return null
  const res = await db.collection(WORKOUTS).where({ familyId, clientId }).limit(1).get()
  return (res.data && res.data[0]) || null
}

async function listWorkouts(familyId, event) {
  const query = validateListQuery(event)
  if (!query.ok) return { code: 400, msg: query.msg }

  const res = await db
    .collection(WORKOUTS)
    .where(Object.assign({ familyId }, buildDateWhere(dbCmd, query.value)))
    .orderBy('date', 'asc')
    .orderBy('createdAt', 'asc')
    .limit(LIST_LIMIT)
    .get()

  return { code: 0, data: (res.data || []).map(toClientWorkout) }
}

async function addWorkout(familyId, uid, event) {
  const checked = validateWorkoutPayload(event)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  // 幂等：同一家庭内 clientId 唯一
  const existing = await findWorkout(familyId, checked.value.clientId)
  if (existing) return { code: 0, data: { _id: existing._id, duplicated: true } }

  const now = Date.now()
  const doc = await db.collection(WORKOUTS).add({
    familyId,
    clientId: checked.value.clientId,
    date: checked.value.date,
    category: checked.value.category,
    exerciseName: checked.value.exerciseName,
    sets: checked.value.sets,
    durationMin: checked.value.durationMin,
    distanceKm: checked.value.distanceKm,
    calories: checked.value.calories,
    memberId: await resolveMemberId(familyId, checked.value.memberId),
    createdByUid: uid,
    createdAt: now,
    updatedAt: now
  })

  return { code: 0, data: { _id: doc.id } }
}

/**
 * 更新：先把 patch 合并到既有记录上得到完整形态，再用同一个全量校验复校。
 * 典型场景：只把 category 从 strength 改成 cardio —— 全量复校能发现
 * 「记录里还留着力量组明细、又没填时长」这种矛盾，逐字段校验发现不了。
 */
async function updateWorkout(familyId, event) {
  const target = await findWorkout(familyId, event.clientId)
  if (!target) return { code: 404, msg: '未找到该训练记录' }

  const merged = mergeWorkoutPatch(target, event)
  const checked = validateWorkoutPayload(merged.value)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  await db.collection(WORKOUTS).doc(target._id).update({
    date: checked.value.date,
    category: checked.value.category,
    exerciseName: checked.value.exerciseName,
    sets: checked.value.sets,
    durationMin: checked.value.durationMin,
    distanceKm: checked.value.distanceKm,
    calories: checked.value.calories,
    memberId: await resolveMemberId(familyId, checked.value.memberId),
    updatedAt: Date.now()
  })

  return { code: 0 }
}

/**
 * 删除。**刻意做成幂等**：记录不存在时同样返回成功。
 * 离线队列重投一条「已经删成功」的记录时，若返回 404 会被当成失败而无限重试；
 * 而「记录不存在」本身即等于目标已达成。
 */
async function removeWorkout(familyId, event) {
  const target = await findWorkout(familyId, event.clientId)
  if (!target) return { code: 0, data: { removed: false } }

  await db.collection(WORKOUTS).doc(target._id).remove()
  return { code: 0, data: { removed: true } }
}
