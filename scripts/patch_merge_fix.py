# -*- coding: utf-8 -*-
"""云函数合并逻辑修复：字段合并保留档案 + memberCount 修正"""
import io

def patch(path, pairs, label):
    with io.open(path, "r", encoding="utf-8") as f:
        c = f.read()
    for old, new in pairs:
        assert old in c, f"{label}: 未匹配 -> {old[:80]!r}"
        c = c.replace(old, new)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print(f"{label} 修改完成")

# ========== 1. member/index.js ==========
patch(r"D:\Family\family\uniCloud-alipay\cloudfunctions\member\index.js", [
    # 顶部常量
    ("""const USERS = 'uni-id-users'
const MEMBERS = 'family_members'""",
     """const USERS = 'uni-id-users'
const MEMBERS = 'family_members'
const FAMILIES = 'families'
const dbCmd = db.command"""),
    # update 合并改为调用公共函数
    ("""  await db.collection(MEMBERS).doc(id).update(upd)
  // 绑定账号后合并：删除同家庭下其他 userId=uid 的成员记录（账号自动创建记录与绑定记录合并）
  if (upd.userId) {
    const dup = (await db.collection(MEMBERS).where({ familyId, userId: upd.userId }).get()).data
    for (const rec of dup) {
      if (rec._id !== id) {
        await db.collection(MEMBERS).doc(rec._id).remove()
      }
    }
  }
  return { code: 0 }
}""",
     """  await db.collection(MEMBERS).doc(id).update(upd)
  // 绑定账号后合并：账号自动创建记录与绑定记录合并为一条（字段合并保留完整档案）
  if (upd.userId) {
    await mergeUserMembers(familyId, upd.userId, id)
  }
  return { code: 0 }
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
  // keepId 记录本身可能已不存在（keep 选择了其他记录时）
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
}"""),
], "member 云函数")

# ========== 2. family/index.js ==========
patch(r"D:\Family\family\uniCloud-alipay\cloudfunctions\family\index.js", [
    # bindMember 去掉重复 inc
    ("""  await db.collection(USERS).doc(uid).update({
    familyId: member.familyId,
    familyRole: 'member'
  })
  await db.collection(FAMILIES).doc(member.familyId).update({ memberCount: dbCmd.inc(1) })
  await mergeUserMembers(member.familyId, uid, member._id)
  const family = (await db.collection(FAMILIES).doc(member.familyId).get()).data[0]
  return {
    code: 0,
    data: {
      familyId: member.familyId,
      familyName: family ? family.name : '',""",
     """  await db.collection(USERS).doc(uid).update({
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
      familyName: family ? family.name : '',"""),
    # autoBindByMobile 去掉重复 inc
    ("""  await db.collection(USERS).doc(uid).update({
    familyId: member.familyId,
    familyRole: 'member'
  })
  await db.collection(FAMILIES).doc(member.familyId).update({ memberCount: dbCmd.inc(1) })
  await mergeUserMembers(member.familyId, uid, member._id)
  const family = (await db.collection(FAMILIES).doc(member.familyId).get()).data[0]
  return {
    code: 0,
    data: {
      bound: true,""",
     """  await db.collection(USERS).doc(uid).update({
    familyId: member.familyId,
    familyRole: 'member'
  })
  // 虚拟成员已在添加时计入 memberCount，绑定不重复计数；合并多余记录时扣减
  await mergeUserMembers(member.familyId, uid, member._id)
  const family = (await db.collection(FAMILIES).doc(member.familyId).get()).data[0]
  return {
    code: 0,
    data: {
      bound: true,"""),
    # mergeUserMembers 升级为字段合并版本
    ("""// 合并同一账号在家庭下的重复成员记录，保留 keepId
async function mergeUserMembers(familyId, uid, keepId) {
  const dup = (await db.collection(MEMBERS).where({ familyId, userId: uid }).get()).data
  for (const rec of dup) {
    if (rec._id !== keepId) {
      await db.collection(MEMBERS).doc(rec._id).remove()
    }
  }
}""",
     """// 合并同一账号在家庭下的重复成员记录：
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
}"""),
], "family 云函数")

print("云函数修复完成")
