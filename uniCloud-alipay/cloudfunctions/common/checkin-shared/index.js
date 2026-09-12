'use strict'

// 打卡类云函数（diet / workout）公共模块
// 职责：校验登录态 → 由 uid 推导家庭归属。业务纯逻辑一律放各函数自己的 lib.js。
//
// ⚠️ 本模块依赖 uniCloud.database() 与 uni-id-common，**不参与单元测试**。
//    请勿把可测的纯逻辑挪进来，否则会丢掉测试覆盖。

const USERS = 'uni-id-users'
const MEMBERS = 'family_members'

const {
  TOMBSTONES,
  TOMBSTONE_LIMIT,
  isTombstoneDomain,
  buildTombstoneDocs,
  tombstoneWindowStart,
  validateTombstoneCursor,
  toClientTombstone,
} = require('./lib')

/**
 * 校验登录态。
 * uni-id-common 对「token 过期 / 校验失败」会以返回值形式给出 errCode，
 * 但对其它异常仍可能抛出，这里统一兜住，避免把栈信息透给客户端。
 *
 * @returns {{ ok: true, uid: string } | { ok: false, code: number, msg: string }}
 */
async function getUid(context, event) {
  let res
  try {
    const uniID = require('uni-id-common').createInstance({ context })
    res = await uniID.checkToken(event && event.uniIdToken)
  } catch (e) {
    return { ok: false, code: 401, msg: '登录态无效或已过期' }
  }
  if (!res || res.errCode !== 0 || !res.uid) {
    return { ok: false, code: 401, msg: '登录态无效或已过期' }
  }
  return { ok: true, uid: res.uid }
}

/**
 * 由 uid 推导家庭归属。
 * @returns {{ familyId: string, role: string } | null}
 */
async function getUserFamily(uid) {
  const db = uniCloud.database()
  const res = await db.collection(USERS).doc(uid).get()
  const user = res.data && res.data[0]
  if (!user || !user.familyId) return null
  return { familyId: user.familyId, role: user.familyRole || 'member' }
}

/**
 * 一次拿到 uid 与 familyId。
 *
 * ⚠️ familyId **只从这里取**，任何情况下都不要使用客户端传入的 familyId，
 *    否则用户可以伪造 familyId 越权读写别的家庭数据。
 *
 * @returns {{ ok: true, uid: string, familyId: string, role: string }
 *          | { ok: false, code: number, msg: string }}
 */
async function resolveContext(context, event) {
  const auth = await getUid(context, event)
  if (!auth.ok) return auth

  const family = await getUserFamily(auth.uid)
  if (!family) return { ok: false, code: 400, msg: '尚未加入家庭' }

  return { ok: true, uid: auth.uid, familyId: family.familyId, role: family.role }
}

/**
 * 校验打卡成员是否属于该家庭。
 * 不属于（含成员已被删除、或伪造了别家的 memberId）一律返回 null，
 * 由调用方以 null 落库，避免跨家庭串数据。
 *
 * @returns {Promise<string|null>} 合法的 memberId，或 null
 */
async function resolveMemberId(familyId, memberId) {
  if (!memberId) return null
  const db = uniCloud.database()
  const res = await db.collection(MEMBERS).doc(memberId).get()
  const member = res.data && res.data[0]
  if (!member || member.familyId !== familyId) return null
  return memberId
}

/**
 * 记录删除日志（墓碑），让**别的设备**知道这条记录被删了。
 *
 * ⚠️ 调用顺序必须是「先删记录、后写墓碑」，且**无论记录是否存在都要写**
 * （见方案文档 §3.2）。反过来（先写墓碑后删记录）在删除失败时会造成
 * **记录复活** —— 别的设备已删、而这台设备下次 pull 时云端记录还在。
 *
 * @param {{ familyId: string, domain: string, entries: Array<{clientId: string, date?: string}>,
 *           uid?: string, deletedAt: number }} options
 * @returns {Promise<{ recorded: number }>}
 */
async function recordTombstones(options) {
  const opts = options || {}
  const docs = buildTombstoneDocs({
    familyId: opts.familyId,
    domain: opts.domain,
    entries: opts.entries,
    deletedAt: opts.deletedAt,
    uid: opts.uid,
  })
  if (docs.length === 0) return { recorded: 0 }

  const db = uniCloud.database()
  await db.collection(TOMBSTONES).add(docs)
  return { recorded: docs.length }
}

/**
 * 增量读取本家庭的墓碑。
 *
 * 只返回「游标之后」且「仍在保留窗口内」的墓碑，按 deletedAt 升序。
 * 客户端拿去删本地记录后，把游标推进到本批最大的 deletedAt。
 *
 * @param {{ familyId: string, domains: string[], since?: number, now?: number }} options
 * @returns {Promise<{ items: Array<{domain: string, clientId: string, date: string, deletedAt: number}> }>}
 */
async function listTombstones(options) {
  const opts = options || {}
  const familyId = opts.familyId
  if (!familyId) return { items: [] }

  const domains = (Array.isArray(opts.domains) ? opts.domains : []).filter(isTombstoneDomain)
  if (domains.length === 0) return { items: [] }

  const since = validateTombstoneCursor(opts.since)
  const from = Math.max(since, tombstoneWindowStart(opts.now))

  const db = uniCloud.database()
  const dbCmd = db.command
  const res = await db
    .collection(TOMBSTONES)
    .where({
      familyId,
      domain: dbCmd.in(domains),
      deletedAt: dbCmd.gt(from),
    })
    .orderBy('deletedAt', 'asc')
    .limit(TOMBSTONE_LIMIT)
    .get()

  const items = ((res && res.data) || []).map(toClientTombstone).filter(Boolean)
  return { items }
}

module.exports = {
  getUid,
  getUserFamily,
  resolveContext,
  resolveMemberId,
  recordTombstones,
  listTombstones,
}
