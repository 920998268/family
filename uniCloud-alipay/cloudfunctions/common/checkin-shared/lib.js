'use strict'

// 跨设备删除同步：墓碑（删除日志）的纯逻辑。
//
// ⚠️ 与同目录 index.js 的分工：本文件**不碰数据库**，可被单元测试直接 require；
//    涉及 uniCloud.database() 的动作一律放 index.js（那里不参与单测）。
//    请勿把 db 调用挪进来，否则会丢掉测试覆盖。

const TOMBSTONES = 'checkin_tombstones'

/**
 * 合法领域白名单（M3 第 6 步由 4 扩到 7，M4 第 6 步由 7 扩到 8）。
 *
 * ⚠️ 这份白名单是**双刃**的：它同时管着写入（`buildTombstoneDocs` 对未知 domain
 *    返回 `[]`）与读取（`listTombstones` 用 `isTombstoneDomain` 过滤 `domains`）。
 *    漏加一个 domain 不会报错，而是「删成功、墓碑不写、拉也拉不到」——
 *    全程静默，别的设备永远不同步这次删除。见方案文档 §3.4。
 *
 * ⚠️ 与前端 `src/utils/pendingSync.ts` 的 `SYNC_DOMAINS` **必须逐字一致**，
 *    由 `tests/tombstone-cloud.test.ts` 与 `tests/tombstone-shared.test.ts` 双向互锁。
 *    新增 domain 必须三处同改：本数组、`SYNC_DOMAINS`、`SyncDomain` 类型。
 *
 * 顺序即「打卡三件套 → 学习两件套 → M3 食谱 / 出行 → M4 账本」，
 * 纯粹为了可读性，无功能含义。
 */
const TOMBSTONE_DOMAINS = [
  'diet',
  'workout',
  'studyPlan',
  'studyCheckin',
  'mealPlan',
  'travelPlan',
  'travelItem',
  'transaction',
]

/** 墓碑保留窗口（天）：早于该窗口的墓碑不再返回给客户端 */
const TOMBSTONE_MAX_DAYS = 180
/** 单次返回上限，防止异常数据把响应撑爆 */
const TOMBSTONE_LIMIT = 500

const DAY_MS = 24 * 60 * 60 * 1000

function isTombstoneDomain(value) {
  return TOMBSTONE_DOMAINS.indexOf(value) !== -1
}

/** 日期归一：非字符串一律空串（学习计划没有日期，就是空串） */
function normalizeTombstoneDate(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * 由「被删记录」构造待写入的墓碑文档。
 *
 * 两处清洗：
 * - 过滤非法条目（缺 clientId、空对象）；
 * - **批内按 clientId 去重** —— 级联删除时同一打卡可能被收集多次，
 *   写两条同 id 墓碑没有意义，客户端也只是删一次。
 *
 * ⚠️ `deletedAt` 非法时落 0 而不是丢弃整批：调用方（index.js）保证传 `Date.now()`，
 *    这里静默丢数据比落 0 更危险（墓碑缺失＝删除不同步且无痕）。
 */
function buildTombstoneDocs(options) {
  const opts = options || {}
  const familyId = opts.familyId
  const domain = opts.domain
  if (!familyId || !isTombstoneDomain(domain)) return []

  const deletedAt = typeof opts.deletedAt === 'number' && isFinite(opts.deletedAt) ? opts.deletedAt : 0
  const uid = typeof opts.uid === 'string' ? opts.uid : ''

  const seen = Object.create(null)
  const docs = []
  const entries = Array.isArray(opts.entries) ? opts.entries : []

  for (const entry of entries) {
    if (!entry) continue
    const clientId = typeof entry.clientId === 'string' ? entry.clientId : ''
    if (!clientId || seen[clientId]) continue
    seen[clientId] = true
    docs.push({
      familyId,
      domain,
      clientId,
      date: normalizeTombstoneDate(entry.date),
      deletedAt,
      createdByUid: uid,
    })
  }
  return docs
}

/** 墓碑保留窗口的起点：早于它的墓碑不再返回 */
function tombstoneWindowStart(now, maxDays) {
  const days = typeof maxDays === 'number' && maxDays > 0 ? maxDays : TOMBSTONE_MAX_DAYS
  const time = typeof now === 'number' && isFinite(now) ? now : 0
  return time - days * DAY_MS
}

/**
 * 解析客户端传来的游标（已应用到的最大 deletedAt）。
 * 非法值（负数 / NaN / 非数字）一律当 0 —— 即「从头拉一遍」，
 * 比抛错好：重复应用墓碑是无害的（本地已经删过的记录再删一次没有副作用）。
 */
function validateTombstoneCursor(value) {
  if (typeof value === 'number' && isFinite(value) && value > 0) return value
  return 0
}

/** 服务端文档 → 客户端结构：只暴露必要字段，不带 _id / familyId */
function toClientTombstone(doc) {
  if (!doc) return null
  return {
    domain: doc.domain,
    clientId: doc.clientId,
    date: normalizeTombstoneDate(doc.date),
    deletedAt: doc.deletedAt,
  }
}

module.exports = {
  TOMBSTONES,
  TOMBSTONE_DOMAINS,
  TOMBSTONE_MAX_DAYS,
  TOMBSTONE_LIMIT,
  DAY_MS,
  isTombstoneDomain,
  normalizeTombstoneDate,
  buildTombstoneDocs,
  tombstoneWindowStart,
  validateTombstoneCursor,
  toClientTombstone,
}
