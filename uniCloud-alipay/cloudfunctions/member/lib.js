'use strict'

// 成员档案云函数 —— 纯逻辑模块（可单元测试）
const GENDERS = ['male', 'female', 'other']

function validateMember(payload = {}) {
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  if (!name) return { ok: false, msg: '姓名不能为空' }
  if (name.length > 20) return { ok: false, msg: '姓名长度需在 1~20 字之间' }

  const { gender, birthday } = payload
  if (gender != null && gender !== '' && !GENDERS.includes(gender)) {
    return { ok: false, msg: '性别取值不合法（male/female/other）' }
  }
  if (birthday != null && birthday !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    return { ok: false, msg: '出生日期格式应为 YYYY-MM-DD' }
  }

  const range = [
    ['height', '身高', 250],
    ['weight', '体重', 300],
    ['targetWeight', '目标体重', 300]
  ]
  for (const [key, label, max] of range) {
    const v = payload[key]
    if (v == null || v === '') continue
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0 || n > max) return { ok: false, msg: `${label}数值不合法` }
  }
  return { ok: true }
}

module.exports = { validateMember }
