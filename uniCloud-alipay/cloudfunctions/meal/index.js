'use strict'

// 食谱云函数
// 集合：meal_plans（家庭食谱记录，按日期组织）
//
// 为什么只有一张表、一个云函数：食谱没有从属实体，不存在「子记录要校验父存在 /
// 删父要级联删子」的关系 —— 按 M2 确立的判据（**存在主从关系才合并**），
// 它与 diet 同构，与 study / travel 不同。
// 详见 docs/0.3.5-m3-requirements-and-solution.md §2.1。
//
// 安全约定（勿改）：
//   1. familyId 一律由服务端从登录态推导（checkin-shared.resolveContext），
//      绝不使用客户端传入的 familyId；
//   2. update / remove 先按 familyId + clientId 查回记录，查不到即按幂等成功处理，
//      杜绝拿别人的 clientId 跨家庭操作。
//
// ⚠️ 无 memberId：前端 `MealPlan` 模型里没有这个字段（「掌勺人」`cook` 是可自由填写的
//    文本，不是家庭成员 id）。所以本函数**不需要** resolveMemberId。

const db = uniCloud.database()
const { resolveContext, recordTombstones, listTombstones } = require('checkin-shared')
const {
  validateMealPayload,
  mergeMealPatch,
  validateMealQuery,
  toClientMeal
} = require('./lib')

const MEALS = 'meal_plans'
const LIST_LIMIT = 500

exports.main = async (event, context) => {
  const evt = event || {}

  const auth = await resolveContext(context, evt)
  if (!auth.ok) return { code: auth.code, msg: auth.msg }

  const familyId = auth.familyId

  switch (evt.action) {
    case 'list': return listMeals(familyId, evt)
    case 'add': return addMeal(familyId, auth.uid, evt)
    case 'update': return updateMeal(familyId, evt)
    case 'remove': return removeMeal(familyId, auth.uid, evt)
    case 'listTombstones': return listMealTombstones(familyId, evt)
    default: return { code: 400, msg: `未知操作: ${evt.action}` }
  }
}

// 按 familyId + clientId 定位记录（clientId 的幂等域限定在家庭内）
async function findMeal(familyId, clientId) {
  if (typeof clientId !== 'string' || !clientId) return null
  const res = await db.collection(MEALS).where({ familyId, clientId }).limit(1).get()
  return (res.data && res.data[0]) || null
}

/** 列表：只按具体日期查（食谱的读取口径就是「某一天」） */
async function listMeals(familyId, event) {
  const query = validateMealQuery(event)
  if (!query.ok) return { code: 400, msg: query.msg }

  const res = await db
    .collection(MEALS)
    .where({ familyId, date: query.value.date })
    .orderBy('createdAt', 'asc')
    .limit(LIST_LIMIT)
    .get()

  return { code: 0, data: (res.data || []).map(toClientMeal) }
}

async function addMeal(familyId, uid, event) {
  const checked = validateMealPayload(event)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  // 幂等：同一家庭内 clientId 唯一。弱网重试 / 离线队列重投都不会产生重复记录。
  const existing = await findMeal(familyId, checked.value.clientId)
  if (existing) return { code: 0, data: { _id: existing._id, duplicated: true } }

  const now = Date.now()
  const doc = await db.collection(MEALS).add({
    familyId,
    clientId: checked.value.clientId,
    date: checked.value.date,
    slot: checked.value.slot,
    dishName: checked.value.dishName,
    ingredients: checked.value.ingredients,
    cook: checked.value.cook,
    done: checked.value.done,
    note: checked.value.note,
    createdByUid: uid,
    createdAt: now,
    updatedAt: now
  })

  return { code: 0, data: { _id: doc.id } }
}

/**
 * 更新：先把 patch 合并到既有记录上得到完整形态，再用同一个全量校验复校。
 * 逐字段校验发现不了「单字段 patch 造成的整体矛盾」。
 *
 * ⚠️ `date` 不参与更新（`mergeMealPatch` 里写死取 base.date）：
 *    前端 `MealPlanPatch` 本来就不含 `date`，改了会让记录在按日期的拉取通路里凭空消失。
 */
async function updateMeal(familyId, event) {
  const target = await findMeal(familyId, event && event.clientId)
  if (!target) return { code: 404, msg: '未找到该食谱记录' }

  const merged = mergeMealPatch(target, event)
  const checked = validateMealPayload(merged.value)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  await db.collection(MEALS).doc(target._id).update({
    slot: checked.value.slot,
    dishName: checked.value.dishName,
    ingredients: checked.value.ingredients,
    cook: checked.value.cook,
    done: checked.value.done,
    note: checked.value.note,
    updatedAt: Date.now()
  })

  return { code: 0 }
}

/**
 * 删除食谱记录并写墓碑。
 *
 * ⚠️ 两条铁律（与 diet / study 完全一致）：
 * 1. **先删记录，后写墓碑** —— 反过来（墓碑已写而删除失败）会造成「记录复活」：
 *    别的设备删掉了本地记录，而这台设备下次 pull 时云端记录还在；
 * 2. **无论记录是否存在都要写墓碑** —— 墓碑写入失败时客户端会重试，
 *    重试时记录已不存在（`removed: false`），但墓碑还没写，必须能补上。
 *
 * ⚠️ 墓碑里的 `date` 必须尽量带上：前端本地存储是**按日期分区**的
 *    （`family.meal.v1.<date>`），带上日期别的设备就能直接定位到那个分区；
 *    落空串就只能全量扫描兜底（`src/utils/tombstone.ts` 里两条路径都有）。
 */
async function removeMeal(familyId, uid, event) {
  const evt = event || {}
  const target = await findMeal(familyId, evt.clientId)

  if (target) {
    await db.collection(MEALS).doc(target._id).remove()
  }

  const date = (target && target.date) || (typeof evt.date === 'string' ? evt.date : '')
  await recordTombstones({
    familyId,
    domain: 'mealPlan',
    entries: [{ clientId: evt.clientId, date }],
    uid,
    deletedAt: Date.now()
  })

  return { code: 0, data: { removed: !!target } }
}

/** 增量拉取本家庭的食谱墓碑，供客户端删除本地残留 */
async function listMealTombstones(familyId, event) {
  const res = await listTombstones({
    familyId,
    domains: ['mealPlan'],
    since: event && event.since,
    now: Date.now()
  })
  return { code: 0, data: res }
}
