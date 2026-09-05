'use strict'

// 家庭空间云函数 —— 纯逻辑模块（可单元测试）
// 生成 6 位家庭邀请码（大写字母 + 数字，去掉易混淆字符 O/0/I/1）
function generateInviteCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < len; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// 校验「创建家庭」入参
function validateCreateFamily(payload = {}) {
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  if (!name) return { ok: false, msg: '家庭名称不能为空' }
  if (name.length > 20) return { ok: false, msg: '家庭名称长度需在 1~20 字之间' }
  return { ok: true, value: { name } }
}

// 校验「加入家庭」入参
function validateJoinFamily(payload = {}) {
  const code = typeof payload.inviteCode === 'string' ? payload.inviteCode.trim().toUpperCase() : ''
  if (!code) return { ok: false, msg: '邀请码不能为空' }
  if (!/^[A-Z0-9]{6}$/.test(code)) return { ok: false, msg: '邀请码格式不正确（应为 6 位字母/数字）' }
  return { ok: true, value: { inviteCode: code } }
}

module.exports = { generateInviteCode, validateCreateFamily, validateJoinFamily }
