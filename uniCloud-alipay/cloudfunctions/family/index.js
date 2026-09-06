'use strict'
// 家庭空间云函数：创建 / 加入 / 查询 / 邀请码管理 / 移除成员
// 依赖公共模块 uni-id-common（导入 uni-id-pages 插件后自动提供）
const db = uniCloud.database()
const dbCmd = db.command
const { generateInviteCode, validateCreateFamily, validateJoinFamily } = require('./lib')

const USERS = 'uni-id-users'
const FAMILIES = 'families'
const MEMBERS = 'family_members'

// 校验登录态，返回 uid
async function getUid(context, event) {
  const uniID = require('uni-id-common').createInstance({ context })
  const res = await uniID.checkToken(event.uniIdToken)
  if (res.errCode !== 0 || !res.uid) return { code: 401, msg: '登录态无效或已过期' }
  return { code: 0, uid: res.uid }
}

// 从用户信息中提取显示名称
function getDisplayName(user) {
  if (!user) return '家庭成员'
  if (user.nickname) return user.nickname
  if (user.username) return user.username
  if (user.mobile) return user.mobile
  return '家庭成员'
}

exports.main = async (event, context) => {
  const auth = await getUid(context, event)
  if (auth.code !== 0) return auth
  const uid = auth.uid
  switch (event.action) {
    case 'createFamily': return createFamily(uid, event)
    case 'joinFamily': return joinFamily(uid, event)
    case 'getMyStatus': return getMyStatus(uid)
    case 'getFamilyInfo': return getFamilyInfo(uid)
    case 'regenerateInviteCode': return regenerateInviteCode(uid)
    case 'removeMember': return removeMember(uid, event)
    default: return { code: 400, msg: `未知操作: ${event.action}` }
  }
}

async function createFamily(uid, event) {
  const v = validateCreateFamily(event)
  if (!v.ok) return { code: 400, msg: v.msg }
  const user = (await db.collection(USERS).doc(uid).get()).data[0]
  if (user && user.familyId) return { code: 400, msg: '你已加入家庭，无法重复创建' }
  let inviteCode = generateInviteCode()
  for (let i = 0; i < 3; i++) {
    const exist = await db.collection(FAMILIES).where({ inviteCode }).count()
    if (exist.total === 0) break
    inviteCode = generateInviteCode()
  }
  const now = Date.now()
  const familyRes = await db.collection(FAMILIES).add({
    name: v.value.name,
    ownerUid: uid,
    inviteCode,
    memberCount: 1,
    createdAt: now
  })
  await db.collection(USERS).doc(uid).update({ familyId: familyRes.id, familyRole: 'owner' })
  // 自动创建家庭成员记录，关联当前登录账号
  await db.collection(MEMBERS).add({
    familyId: familyRes.id,
    userId: uid,
    name: getDisplayName(user),
    role: 'other',
    gender: user.gender || '',
    birthday: user.birthday || '',
    avatarColor: '#f97316',
    avatarUrl: user.avatar_file ? (user.avatar_file.url || '') : '',
    isSelf: true,
    createdAt: now,
    updatedAt: now
  })
  return {
    code: 0,
    data: {
      _id: familyRes.id,
      name: v.value.name,
      inviteCode,
      ownerId: uid,
      memberCount: 1,
      createdAt: now
    }
  }
}

async function joinFamily(uid, event) {
  const v = validateJoinFamily(event)
  if (!v.ok) return { code: 400, msg: v.msg }
  const user = (await db.collection(USERS).doc(uid).get()).data[0]
  if (user && user.familyId) return { code: 400, msg: '你已加入家庭' }
  const family = (await db.collection(FAMILIES).where({ inviteCode: v.value.inviteCode }).limit(1).get()).data[0]
  if (!family) return { code: 404, msg: '邀请码无效' }
  await db.collection(USERS).doc(uid).update({ familyId: family._id, familyRole: 'member' })
  await db.collection(FAMILIES).doc(family._id).update({ memberCount: dbCmd.inc(1) })
  // 自动创建家庭成员记录，关联当前登录账号
  const now = Date.now()
  await db.collection(MEMBERS).add({
    familyId: family._id,
    userId: uid,
    name: getDisplayName(user),
    role: 'other',
    gender: user.gender || '',
    birthday: user.birthday || '',
    avatarColor: '#0ea5e9',
    avatarUrl: user.avatar_file ? (user.avatar_file.url || '') : '',
    isSelf: true,
    createdAt: now,
    updatedAt: now
  })
  return {
    code: 0,
    data: {
      _id: family._id,
      name: family.name,
      inviteCode: family.inviteCode,
      ownerId: family.ownerUid,
      memberCount: family.memberCount + 1,
      createdAt: family.createdAt
    }
  }
}

async function getMyStatus(uid) {
  const user = (await db.collection(USERS).doc(uid).get()).data[0]
  if (!user) return { code: 401, msg: '用户不存在' }
  if (!user.familyId) {
    return { code: 0, data: { hasFamily: false, familyId: '', familyName: '', role: '', inviteCode: '' } }
  }
  const family = (await db.collection(FAMILIES).doc(user.familyId).get()).data[0]
  return {
    code: 0,
    data: {
      hasFamily: true,
      familyId: user.familyId,
      familyName: family ? family.name : '',
      role: user.familyRole || '',
      inviteCode: family ? family.inviteCode : ''
    }
  }
}

async function getFamilyInfo(uid) {
  const user = (await db.collection(USERS).doc(uid).get()).data[0]
  if (!user || !user.familyId) return { code: 400, msg: '尚未加入家庭' }
  const family = (await db.collection(FAMILIES).doc(user.familyId).get()).data[0]
  const members = (await db.collection(MEMBERS).where({ familyId: user.familyId }).get()).data
  return { code: 0, data: { family: family || null, members: members || [] } }
}

async function regenerateInviteCode(uid) {
  const user = (await db.collection(USERS).doc(uid).get()).data[0]
  if (!user || !user.familyId) return { code: 400, msg: '尚未加入家庭' }
  if (user.familyRole !== 'owner') return { code: 403, msg: '仅家庭管理员可操作' }
  let inviteCode = generateInviteCode()
  for (let i = 0; i < 3; i++) {
    const exist = await db.collection(FAMILIES).where({ inviteCode }).count()
    if (exist.total === 0) break
    inviteCode = generateInviteCode()
  }
  await db.collection(FAMILIES).doc(user.familyId).update({ inviteCode })
  return { code: 0, data: { inviteCode } }
}

async function removeMember(uid, event) {
  const memberId = event.memberId
  if (!memberId) return { code: 400, msg: '缺少 memberId' }
  const user = (await db.collection(USERS).doc(uid).get()).data[0]
  if (!user || !user.familyId) return { code: 400, msg: '尚未加入家庭' }
  if (user.familyRole !== 'owner') return { code: 403, msg: '仅家庭管理员可操作' }
  const target = (await db.collection(MEMBERS).doc(memberId).get()).data[0]
  if (!target || target.familyId !== user.familyId) return { code: 403, msg: '无权操作该成员' }
  // 如果成员已绑定登录账号，移除时同时解除用户的家庭关联
  if (target.userId) {
    await db.collection(USERS).doc(target.userId).update({ familyId: '', familyRole: '' })
  }
  await db.collection(MEMBERS).doc(memberId).remove()
  await db.collection(FAMILIES).doc(user.familyId).update({ memberCount: dbCmd.inc(-1) })
  return { code: 0 }
}
