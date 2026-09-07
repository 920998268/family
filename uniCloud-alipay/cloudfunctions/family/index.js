'use strict'
// 家庭空间云函数：创建 / 加入 / 查询 / 邀请码管理 / 移除成员 / 成员绑定
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

// 生成6位绑定码（大写字母+数字，排除易混淆字符）
function generateBindCodeStr() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
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
    case 'generateBindCode': return generateBindCode(uid, event)
    case 'bindMember': return bindMember(uid, event)
    case 'autoBindByMobile': return autoBindByMobile(uid)
    case 'updateFamilyName': return updateFamilyName(uid, event)
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

// 家庭管理员为虚拟成员生成绑定码
async function generateBindCode(uid, event) {
  const memberId = event.memberId
  const memberData = event.memberData || {}
  if (!memberId) return { code: 400, msg: '缺少 memberId' }
  const user = (await db.collection(USERS).doc(uid).get()).data[0]
  if (!user || !user.familyId) return { code: 400, msg: '尚未加入家庭' }
  if (user.familyRole !== 'owner') return { code: 403, msg: '仅家庭管理员可操作' }

  // 查找云端成员记录
  let member = (await db.collection(MEMBERS).doc(memberId).get()).data[0]

  // 如果云端不存在，且传入了成员数据，则自动创建
  if ((!member || member.familyId !== user.familyId) && memberData.name) {
    // 先按姓名查找是否已存在
    const existing = (await db.collection(MEMBERS).where({
      familyId: user.familyId,
      name: memberData.name
    }).limit(1).get()).data[0]
    if (existing) {
      member = existing
    } else {
      const now = Date.now()
      const addRes = await db.collection(MEMBERS).add({
        familyId: user.familyId,
        userId: null,
        name: memberData.name,
        role: memberData.role || 'other',
        gender: memberData.gender || '',
        birthday: memberData.birthday || '',
        avatarColor: memberData.avatarColor || '#f97316',
        avatarUrl: memberData.avatarUrl || '',
        isSelf: false,
        createdAt: now,
        updatedAt: now
      })
      member = (await db.collection(MEMBERS).doc(addRes.id).get()).data[0]
    }
  }

  if (!member || member.familyId !== user.familyId) return { code: 403, msg: '无权操作该成员' }
  if (member.userId) return { code: 400, msg: '该成员已绑定登录账号' }

  // 生成唯一绑定码
  let bindCode = generateBindCodeStr()
  for (let i = 0; i < 5; i++) {
    const exist = await db.collection(MEMBERS).where({ bindCode }).count()
    if (exist.total === 0) break
    bindCode = generateBindCodeStr()
  }
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000 // 24小时有效
  await db.collection(MEMBERS).doc(member._id).update({
    bindCode,
    bindCodeExpiresAt: expiresAt,
    updatedAt: Date.now()
  })
  return { code: 0, data: { bindCode, expiresAt, memberName: member.name, memberId: member._id } }
}

// 用户通过绑定码绑定到已有虚拟成员
async function bindMember(uid, event) {
  const bindCode = (event.bindCode || '').toUpperCase().trim()
  if (!bindCode || bindCode.length !== 6) return { code: 400, msg: '请输入6位绑定码' }
  const user = (await db.collection(USERS).doc(uid).get()).data[0]
  if (!user) return { code: 401, msg: '用户不存在' }
  if (user.familyId) return { code: 400, msg: '你已加入家庭，无法绑定' }
  // 查找绑定码对应的成员
  const member = (await db.collection(MEMBERS).where({ bindCode }).limit(1).get()).data[0]
  if (!member) return { code: 404, msg: '绑定码无效' }
  if (member.userId) return { code: 400, msg: '该成员已被绑定' }
  if (member.bindCodeExpiresAt && member.bindCodeExpiresAt < Date.now()) {
    return { code: 400, msg: '绑定码已过期，请重新生成' }
  }
  const now = Date.now()
  // 绑定：更新成员的 userId，更新用户的 familyId
  await db.collection(MEMBERS).doc(member._id).update({
    userId: uid,
    bindCode: null,
    bindCodeExpiresAt: null,
    isSelf: true,
    updatedAt: now
  })
  await db.collection(USERS).doc(uid).update({
    familyId: member.familyId,
    familyRole: 'member'
  })
  // 虚拟成员已在添加时计入 memberCount，绑定不重复计数；合并多余记录时扣减
  await mergeUserMembers(member.familyId, uid, member._id)
  const family = (await db.collection(FAMILIES).doc(member.familyId).get()).data[0]
  return {
    code: 0,
    data: {
      familyId: member.familyId,
      familyName: family ? family.name : '',
      memberName: member.name,
      role: 'member'
    }
  }
}

// 合并同一账号在家庭下的重复成员记录：
// 保留 keepId 记录，把其他记录的非空字段填补进 keep（保留完整档案），删除多余记录并修正 memberCount
async function mergeUserMembers(familyId, uid, keepId) {
  const dup = (await db.collection(MEMBERS).where({ familyId, userId: uid }).get()).data
  if (dup.length <= 1) return
  let keep = dup.find((r) => r._id === keepId) || dup[0]
  const FIELDS = ['name', 'gender', 'role', 'birthday', 'height', 'weight', 'targetWeight', 'avatarColor', 'avatarUrl', 'mobile']
  let removed = 0
  for (const rec of dup) {
    if (rec._id === keep._id) continue
    for (const f of FIELDS) {
      const v = rec[f]
      if (v !== undefined && v !== null && v !== '' && (keep[f] === undefined || keep[f] === null || keep[f] === '')) {
        keep[f] = v
      }
    }
    await db.collection(MEMBERS).doc(rec._id).remove()
    removed++
  }
  if (keep._id !== keepId) {
    const k = (await db.collection(MEMBERS).doc(keepId).get()).data[0]
    if (k) {
      await db.collection(MEMBERS).doc(keepId).remove()
      removed++
    }
  }
  if (removed > 0) {
    const upd = { updatedAt: Date.now() }
    for (const f of FIELDS) {
      if (keep[f] !== undefined) upd[f] = keep[f]
    }
    await db.collection(MEMBERS).doc(keep._id).update(upd)
    await db.collection(FAMILIES).doc(familyId).update({ memberCount: dbCmd.inc(-removed) })
  }
}

// 登录后自动通过手机号匹配并绑定到预设成员
async function autoBindByMobile(uid) {
  const user = (await db.collection(USERS).doc(uid).get()).data[0]
  if (!user) return { code: 401, msg: '用户不存在' }
  if (user.familyId) return { code: 0, data: { bound: false, reason: 'already_has_family' } }
  const mobile = user.mobile || ''
  if (!mobile) return { code: 0, data: { bound: false, reason: 'no_mobile' } }
  // 查找匹配手机号且未绑定的成员
  const member = (await db.collection(MEMBERS).where({
    mobile,
    userId: null
  }).limit(1).get()).data[0]
  if (!member) return { code: 0, data: { bound: false, reason: 'no_match' } }
  const now = Date.now()
  await db.collection(MEMBERS).doc(member._id).update({
    userId: uid,
    isSelf: true,
    updatedAt: now
  })
  await db.collection(USERS).doc(uid).update({
    familyId: member.familyId,
    familyRole: 'member'
  })
  // 虚拟成员已在添加时计入 memberCount，绑定不重复计数；合并多余记录时扣减
  await mergeUserMembers(member.familyId, uid, member._id)
  const family = (await db.collection(FAMILIES).doc(member.familyId).get()).data[0]
  return {
    code: 0,
    data: {
      bound: true,
      familyId: member.familyId,
      familyName: family ? family.name : '',
      memberName: member.name,
      role: 'member'
    }
  }
}

// 修改家庭名称（仅家庭管理员）
async function updateFamilyName(uid, event) {
  const name = (event.name || '').trim()
  if (!name) return { code: 400, msg: '家庭名称不能为空' }
  if (name.length > 20) return { code: 400, msg: '家庭名称不能超过20字' }
  const user = (await db.collection(USERS).doc(uid).get()).data[0]
  if (!user || !user.familyId) return { code: 400, msg: '尚未加入家庭' }
  if (user.familyRole !== 'owner') return { code: 403, msg: '仅家庭管理员可操作' }
  await db.collection(FAMILIES).doc(user.familyId).update({
    name,
    updatedAt: Date.now()
  })
  return { code: 0, data: { familyId: user.familyId, name } }
}
