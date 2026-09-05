'use strict'
// 成员档案云函数：家庭成员档案 CRUD（归属校验：仅本家庭可读写）
// 依赖公共模块 uni-id-common（导入 uni-id-pages 插件后自动提供）
const db = uniCloud.database()
const { validateMember } = require('./lib')

const USERS = 'uni-id-users'
const MEMBERS = 'family_members'

async function getUid(context, event) {
  const uniID = require('uni-id-common').createInstance({ context })
  const res = await uniID.checkToken(event.uniIdToken)
  if (res.errCode !== 0 || !res.uid) return { code: 401, msg: '登录态无效或已过期' }
  return { code: 0, uid: res.uid }
}

async function getFamilyId(uid) {
  const user = (await db.collection(USERS).doc(uid).get()).data[0]
  return user && user.familyId ? user.familyId : null
}

exports.main = async (event, context) => {
  const auth = await getUid(context, event)
  if (auth.code !== 0) return auth
  const familyId = await getFamilyId(auth.uid)
  if (!familyId) return { code: 400, msg: '尚未加入家庭' }
  switch (event.action) {
    case 'list': return listMembers(familyId)
    case 'add': return addMember(familyId, event)
    case 'update': return updateMember(familyId, event)
    case 'remove': return removeMember(familyId, event)
    default: return { code: 400, msg: `未知操作: ${event.action}` }
  }
}

async function listMembers(familyId) {
  const res = await db.collection(MEMBERS).where({ familyId }).get()
  return { code: 0, data: res.data }
}

async function addMember(familyId, event) {
  const v = validateMember(event)
  if (!v.ok) return { code: 400, msg: v.msg }
  const now = Date.now()
  const { name, gender, birthday, avatarColor, isSelf } = event
  const doc = await db.collection(MEMBERS).add({
    familyId,
    name: name.trim(),
    gender: gender || '',
    birthday: birthday || '',
    height: event.height != null && event.height !== '' ? Number(event.height) : null,
    weight: event.weight != null && event.weight !== '' ? Number(event.weight) : null,
    targetWeight: event.targetWeight != null && event.targetWeight !== '' ? Number(event.targetWeight) : null,
    avatarColor: avatarColor || '#f97316',
    isSelf: !!isSelf,
    createdAt: now,
    updatedAt: now
  })
  return { code: 0, data: { _id: doc.id } }
}

async function updateMember(familyId, event) {
  const id = event._id
  if (!id) return { code: 400, msg: '缺少 _id' }
  const target = (await db.collection(MEMBERS).doc(id).get()).data[0]
  if (!target || target.familyId !== familyId) return { code: 403, msg: '无权操作该成员' }
  const v = validateMember(event)
  if (!v.ok) return { code: 400, msg: v.msg }
  const upd = { updatedAt: Date.now() }
  for (const k of ['name', 'gender', 'birthday', 'avatarColor', 'isSelf']) {
    if (event[k] !== undefined) upd[k] = event[k]
  }
  for (const k of ['height', 'weight', 'targetWeight']) {
    if (event[k] !== undefined && event[k] !== null && event[k] !== '') upd[k] = Number(event[k])
  }
  await db.collection(MEMBERS).doc(id).update(upd)
  return { code: 0 }
}

async function removeMember(familyId, event) {
  const id = event._id
  if (!id) return { code: 400, msg: '缺少 _id' }
  const target = (await db.collection(MEMBERS).doc(id).get()).data[0]
  if (!target || target.familyId !== familyId) return { code: 403, msg: '无权操作该成员' }
  await db.collection(MEMBERS).doc(id).remove()
  return { code: 0 }
}
