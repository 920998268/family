'use strict'

// 饮食打卡云函数
// 集合：diets（饮食记录）、favorite_foods（常用食物，随打卡自动沉淀）
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
  validateDietPayload,
  mergeDietPatch,
  validateListQuery,
  buildDateWhere,
  escapeRegExp,
  toClientDiet,
  validateFoodCollect,
  validateFoodQuery,
  toClientFood
} = require('./lib')

const DIETS = 'diets'
const FOODS = 'favorite_foods'
const LIST_LIMIT = 500

exports.main = async (event, context) => {
  const evt = event || {}

  const auth = await resolveContext(context, evt)
  if (!auth.ok) return { code: auth.code, msg: auth.msg }

  const familyId = auth.familyId

  switch (evt.action) {
    case 'list': return listDiets(familyId, evt)
    case 'add': return addDiet(familyId, auth.uid, evt)
    case 'update': return updateDiet(familyId, evt)
    case 'remove': return removeDiet(familyId, evt)
    case 'listFoods': return listFoods(familyId, evt)
    case 'removeFood': return removeFood(familyId, evt)
    default: return { code: 400, msg: `未知操作: ${evt.action}` }
  }
}

// 按 familyId + clientId 定位记录（clientId 的幂等域限定在家庭内）
async function findDiet(familyId, clientId) {
  if (typeof clientId !== 'string' || !clientId) return null
  const res = await db.collection(DIETS).where({ familyId, clientId }).limit(1).get()
  return (res.data && res.data[0]) || null
}

async function listDiets(familyId, event) {
  const query = validateListQuery(event)
  if (!query.ok) return { code: 400, msg: query.msg }

  const res = await db
    .collection(DIETS)
    .where(Object.assign({ familyId }, buildDateWhere(dbCmd, query.value)))
    .orderBy('date', 'asc')
    .orderBy('createdAt', 'asc')
    .limit(LIST_LIMIT)
    .get()

  return { code: 0, data: (res.data || []).map(toClientDiet) }
}

async function addDiet(familyId, uid, event) {
  const checked = validateDietPayload(event)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  // 幂等：同一家庭内 clientId 唯一。弱网重试 / 离线队列重投都不会产生重复记录。
  const existing = await findDiet(familyId, checked.value.clientId)
  if (existing) return { code: 0, data: { _id: existing._id, duplicated: true } }

  const now = Date.now()
  const doc = await db.collection(DIETS).add({
    familyId,
    clientId: checked.value.clientId,
    date: checked.value.date,
    mealType: checked.value.mealType,
    foodName: checked.value.foodName,
    quantity: checked.value.quantity,
    calories: checked.value.calories,
    protein: checked.value.protein,
    carbs: checked.value.carbs,
    fat: checked.value.fat,
    memberId: await resolveMemberId(familyId, checked.value.memberId),
    createdByUid: uid,
    createdAt: now,
    updatedAt: now
  })

  // 常用食物属于附带能力，失败不能影响打卡本身
  await collectFavoriteFood(familyId, uid, checked.value)

  return { code: 0, data: { _id: doc.id } }
}

/**
 * 更新：先把 patch 合并到既有记录上得到完整形态，再用同一个全量校验复校。
 * 这样能识别「单字段 patch 造成的整体矛盾」，逐字段校验发现不了。
 */
async function updateDiet(familyId, event) {
  const target = await findDiet(familyId, event.clientId)
  if (!target) return { code: 404, msg: '未找到该饮食记录' }

  const merged = mergeDietPatch(target, event)
  const checked = validateDietPayload(merged.value)
  if (!checked.ok) return { code: 400, msg: checked.msg }

  await db.collection(DIETS).doc(target._id).update({
    date: checked.value.date,
    mealType: checked.value.mealType,
    foodName: checked.value.foodName,
    quantity: checked.value.quantity,
    calories: checked.value.calories,
    protein: checked.value.protein,
    carbs: checked.value.carbs,
    fat: checked.value.fat,
    memberId: await resolveMemberId(familyId, checked.value.memberId),
    updatedAt: Date.now()
  })

  return { code: 0 }
}

/**
 * 删除。**刻意做成幂等**：记录不存在时同样返回成功。
 * 离线队列重投一条「已经删成功」的记录时，如果返回 404 会被当成失败而无限重试；
 * 而「记录不存在」本身就等于目标已达成，返回成功更符合语义。
 */
async function removeDiet(familyId, event) {
  const target = await findDiet(familyId, event.clientId)
  if (!target) return { code: 0, data: { removed: false } }

  await db.collection(DIETS).doc(target._id).remove()
  return { code: 0, data: { removed: true } }
}

async function listFoods(familyId, event) {
  const query = validateFoodQuery(event)
  if (!query.ok) return { code: 400, msg: query.msg }

  const where = { familyId }
  if (query.value.keyword) {
    // 用 db.RegExp（uniCloud 官方 API）；先转义元字符，避免用户输入被当作正则执行
    where.name = db.RegExp({ regexp: escapeRegExp(query.value.keyword), options: 'i' })
  }

  const res = await db
    .collection(FOODS)
    .where(where)
    .orderBy('useCount', 'desc')
    .orderBy('lastUsedAt', 'desc')
    .limit(query.value.limit)
    .get()

  return { code: 0, data: (res.data || []).map(toClientFood) }
}

async function removeFood(familyId, event) {
  const name = typeof event.name === 'string' ? event.name.trim() : ''
  if (!name) return { code: 400, msg: '缺少食物名称' }

  await db.collection(FOODS).where({ familyId, name }).remove()
  return { code: 0 }
}

// 按 familyId + name 沉淀常用食物：已存在则累加使用次数并刷新营养值
async function collectFavoriteFood(familyId, uid, diet) {
  try {
    const food = validateFoodCollect(diet)
    if (!food.ok) return

    const now = Date.now()
    const res = await db.collection(FOODS).where({ familyId, name: food.value.name }).limit(1).get()
    const existing = res.data && res.data[0]

    if (existing) {
      await db.collection(FOODS).doc(existing._id).update({
        quantity: food.value.quantity || existing.quantity || '',
        calories: food.value.calories,
        protein: food.value.protein,
        carbs: food.value.carbs,
        fat: food.value.fat,
        useCount: dbCmd.inc(1),
        lastUsedAt: now,
        updatedAt: now
      })
      return
    }

    await db.collection(FOODS).add({
      familyId,
      name: food.value.name,
      quantity: food.value.quantity,
      calories: food.value.calories,
      protein: food.value.protein,
      carbs: food.value.carbs,
      fat: food.value.fat,
      useCount: 1,
      lastUsedAt: now,
      createdByUid: uid,
      createdAt: now,
      updatedAt: now
    })
  } catch (e) {
    console.warn('[diet] 常用食物收集失败（不影响打卡）:', e)
  }
}
