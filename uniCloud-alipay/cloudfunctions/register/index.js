'use strict';
const crypto = require('crypto');

/**
 * 自定义注册云函数
 * 支持手机号 + 密码注册，无需图形验证码
 * 密码加密格式与 uni-id hmac-sha256 保持一致
 */
exports.main = async (event, context) => {
  const { mobile, password } = event;

  // 参数校验
  if (!mobile || !password) {
    return { errCode: 1, errMsg: '手机号和密码不能为空' };
  }
  if (!/^1[3-9]\d{9}$/.test(mobile)) {
    return { errCode: 1, errMsg: '手机号格式不正确' };
  }
  if (password.length < 6) {
    return { errCode: 1, errMsg: '密码长度至少6位' };
  }

  const db = uniCloud.database();

  // 检查手机号是否已注册
  const { data: existing } = await db.collection('uni-id-users').where({ mobile }).get();
  if (existing.length > 0) {
    return { errCode: 1, errMsg: '该手机号已被注册' };
  }

  // 检查用户名是否已占用（用手机号作为用户名）
  const { data: existingUsername } = await db.collection('uni-id-users').where({ username: mobile }).get();
  if (existingUsername.length > 0) {
    return { errCode: 1, errMsg: '该手机号已被注册' };
  }

  // 与 uni-id hmac-sha256 相同的加密逻辑
  // 格式: $UNI_ID_HMAC_SHA256$<saltLength>$<salt><hash>
  const salt = crypto.randomBytes(10).toString('hex');
  const sha256Hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
  const passwordHash = `$UNI_ID_HMAC_SHA256$${salt.length}$${salt}${sha256Hash}`;

  const now = Date.now();

  // 创建用户记录
  // dcloud_appid 必须包含当前应用的 DCloud appid，否则登录时会提示"此账号未在该应用注册"
  const result = await db.collection('uni-id-users').add({
    username: mobile,
    mobile,
    mobile_confirmed: 1,
    password: passwordHash,
    password_secret_version: 0,
    dcloud_appid: ['__UNI__D440BC0'],
    role: [],
    status: 0,
    register_date: now,
    last_login_date: now,
  });

  return {
    errCode: 0,
    errMsg: '',
    uid: result.id,
    mobile,
  };
};
