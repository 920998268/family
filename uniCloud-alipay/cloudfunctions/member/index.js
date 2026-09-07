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

async function getUserFamily(uid) {
  const user = (await db.collection(USERS).doc(uid).get()).data[0]
  if (!user || !user.familyId) return null
  return { familyId: user.familyId, role: user.familyRole || 'member' }
}

exports.main = async (event, context) => {
  const auth = await getUid(context, event)
  if (auth.code !== 0) return auth
  const family = await getUserFamily(auth.uid)
  if (!family) return { code: 400, msg: '尚未加入家庭' }
  const familyId = family.familyId
  switch (event.action) {
    case 'list': return listMembers(familyId)
    case 'add': return addMember(familyId, event)
    case 'update': return updateMember(familyId, event)
    case 'remove': return removeMember(familyId, family.role, event)
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
  const { name, gender, birthday, avatarColor, avatarUrl, role, isSelf, mobile } = event
  // 登录用户保存个人档案时传 userId，自动关联登录账号；手动添加的成员为虚拟成员
  const userId = event.userId && typeof event.userId === 'string' ? event.userId.trim() : null
  const doc = await db.collection(MEMBERS).add({
    familyId,
    userId,
    mobile: mobile ? mobile.trim() : null,
    name: name.trim(),
    role: role || 'other',
    gender: gender || '',
    birthday: birthday || '',
    height: event.height != null && event.height !== '' ? Number(event.height) : null,
    weight: event.weight != null && event.weight !== '' ? Number(event.weight) : null,
    targetWeight: event.targetWeight != null && event.targetWeight !== '' ? Number(event.targetWeight) : null,
    avatarColor: avatarColor || '#f97316',
    avatarUrl: avatarUrl || '',
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
  // 部分更新：仅校验本次显式传入的字段，不要求全量必填（如仅绑定账号时只传 userId/mobile）
  const upd = { updatedAt: Date.now() }
  const GENDERS = ['male', 'female', 'other']
  for (const k of ['name', 'gender', 'birthday', 'avatarColor', 'avatarUrl', 'role', 'isSelf', 'mobile', 'userId']) {
    if (event[k] === undefined) continue
    if (k === 'name' && (typeof event[k] !== 'string' || !event[k].trim())) {
      return { code: 400, msg: '姓名不能为空' }
    }
    if (k === 'gender' && event[k] !== '' && !GENDERS.includes(event[k])) {
      return { code: 400, msg: '性别取值不合法（male/female/other）' }
    }
    if (k === 'birthday' && event[k] !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(event[k])) {
      return { code: 400, msg: '出生日期格式应为 YYYY-MM-DD' }
    }
    upd[k] = event[k]
  }
  for (const k of ['height', 'weight', 'targetWeight']) {
    if (event[k] !== undefined && event[k] !== null && event[k] !== '') {
      const n = Number(event[k])
      if (!Number.isFinite(n) || n <= 0) return { code: 400, msg: `${k}数值不合法` }
      upd[k] = n
    }
  }
  await db.collection(MEMBERS).doc(id).update(upd)
  return { code: 0 }
}

async function removeMember(familyId, role, event) {
  const id = event._id
  if (!id) return { code: 400, msg: '缺少 _id' }
  const target = (await db.collection(MEMBERS).doc(id).get()).data[0]
  if (!target || target.familyId !== familyId) return { code: 403, msg: '无权操作该成员' }
  if (role !== 'owner') return { code: 403, msg: '仅家庭管理员可删除成员' }
  // 如果成员已绑定登录账号，移除时同时解除用户的家庭关联
  if (target.userId) {
    await db.collection(USERS).doc(target.userId).update({ familyId: '', familyRole: '' })
  }
  await db.collection(MEMBERS).doc(id).remove()
  return { code: 0 }
}
