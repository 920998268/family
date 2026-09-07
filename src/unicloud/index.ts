/**
 * uniCloud 调用封装
 * 统一管理云对象、云函数调用与登录态。
 */

/** uni-id-co 云对象返回的登录结果 */
export interface UniIdLoginResult {
  token: string;
  uid: string;
  username?: string;
  nickname?: string;
  avatar?: string;
  mobile?: string;
  email?: string;
  role?: string[];
  [key: string]: unknown;
}

/** family 云函数返回的家庭信息 */
export interface FamilyInfo {
  _id: string;
  name: string;
  inviteCode: string;
  ownerId: string;
  memberCount: number;
  createdAt: number;
  [key: string]: unknown;
}

/** family 云函数返回的当前用户家庭状态 */
export interface MyFamilyStatus {
  hasFamily: boolean;
  familyId?: string;
  familyName?: string;
  role?: string;
  inviteCode?: string;
}

const UNI_ID_TOKEN_KEY = 'uni_id_token';

let uniCloudInited = false;
/** 初始化后的 uniCloud 实例（init() 返回新对象，必须用此变量引用） */
let cloudInstance: any = null;

/** 获取当前可用的 uniCloud 实例 */
function getCloud(): any {
  return cloudInstance || (globalThis as any).uniCloud;
}

/**
 * 手动初始化 uniCloud（CLI 项目需要，框架不会自动注入服务空间配置）
 * 在 App.vue onLaunch 中调用一次即可
 */
export function initUniCloud(): void {
  if (uniCloudInited) return;
  const spaceId = import.meta.env.VITE_UNI_CLOUD_SPACE_ID as string | undefined;
  const accessKey = import.meta.env.VITE_UNI_CLOUD_ACCESS_KEY as string | undefined;
  if (!spaceId || !accessKey) {
    console.warn('[uniCloud] 缺少 VITE_UNI_CLOUD_SPACE_ID 或 VITE_UNI_CLOUD_ACCESS_KEY，云函数调用将不可用');
    return;
  }
  try {
    const inited = (globalThis as any).uniCloud.init({
      spaceId,
      spaceAppId: (import.meta.env.VITE_UNI_CLOUD_SPACE_APP_ID as string) || '',
      provider: 'alipay',
      accessKey,
      secretKey: import.meta.env.VITE_UNI_CLOUD_SECRET_KEY as string,
    });
    cloudInstance = inited;
    (globalThis as any).uniCloud = inited;
    uniCloudInited = true;
    console.log('[uniCloud] 初始化成功，spaceId:', spaceId);
  } catch (e) {
    console.error('[uniCloud] 初始化失败:', e);
  }
}

/** 检查是否已登录（token 存在） */
export function hasToken(): boolean {
  return !!uni.getStorageSync(UNI_ID_TOKEN_KEY);
}

/** 清除登录态 */
export function clearToken(): void {
  uni.removeStorageSync(UNI_ID_TOKEN_KEY);
}

/**
 * 调用 uni-id-co 云对象的微信登录
 * @param code uni.login() 返回的 code
 */
export async function loginByWeixin(code: string): Promise<UniIdLoginResult> {
  const uniIdCo = getCloud().importObject('uni-id-co');
  const res = await uniIdCo.loginByWeixin({ code });
  if (res.errCode !== 0) {
    throw new Error(res.errMsg || '微信登录失败');
  }
  return res as UniIdLoginResult;
}

/** 手机号 + 密码登录 */
export async function loginByPassword(mobile: string, password: string): Promise<UniIdLoginResult> {
  const uniIdCo = getCloud().importObject('uni-id-co');
  const res = await uniIdCo.login({ mobile, password });
  if (res.errCode !== 0) {
    throw new Error(res.errMsg || '登录失败，请检查手机号和密码');
  }
  return res as UniIdLoginResult;
}

/** 注册账号（手机号 + 密码），调用自定义 register 云函数 */
export async function register(mobile: string, password: string): Promise<{ uid: string; mobile: string }> {
  const res = await getCloud().callFunction({
    name: 'register',
    data: { mobile, password },
  });
  const result = res.result;
  if (result.errCode !== 0) {
    throw new Error(result.errMsg || '注册失败，该手机号可能已被注册');
  }
  return { uid: result.uid, mobile: result.mobile };
}

/** 退出登录 */
export async function logout(): Promise<void> {
  try {
    const uniIdCo = getCloud().importObject('uni-id-co');
    await uniIdCo.logout();
  } catch {
    // 退出登录即使云对象调用失败也清除本地 token
  }
  clearToken();
}

/**
 * 调用 family 云函数
 */
async function callFamily(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const res = await getCloud().callFunction({
    name: 'family',
    data: { action, ...payload },
  });
  const result = res.result;
  if (result?.code !== 0) {
    throw new Error(result?.message || `family 云函数 [${action}] 调用失败`);
  }
  return result.data;
}

/** 创建家庭 */
export async function createFamily(name: string): Promise<FamilyInfo> {
  return callFamily('createFamily', { name });
}

/** 通过邀请码加入家庭 */
export async function joinFamily(inviteCode: string): Promise<FamilyInfo> {
  return callFamily('joinFamily', { inviteCode });
}

/** 获取当前用户家庭状态 */
export async function getMyFamilyStatus(): Promise<MyFamilyStatus> {
  return callFamily('getMyStatus');
}

/** 获取家庭详情 */
export async function getFamilyInfo(familyId: string): Promise<FamilyInfo> {
  return callFamily('getFamilyInfo', { familyId });
}

/** 重置邀请码 */
export async function regenerateInviteCode(familyId: string): Promise<{ inviteCode: string }> {
  return callFamily('regenerateInviteCode', { familyId });
}

/** 为虚拟成员生成绑定码（仅家庭管理员），如果云端不存在该成员则自动创建 */
export async function generateMemberBindCode(
  memberId: string,
  memberData?: { name: string; role?: string; gender?: string; birthday?: string; avatarColor?: string; avatarUrl?: string },
): Promise<{ bindCode: string; expiresAt: number; memberName: string; memberId: string }> {
  return callFamily('generateBindCode', { memberId, memberData });
}

/** 通过绑定码绑定到已有虚拟成员 */
export async function bindMemberByCode(bindCode: string): Promise<{ familyId: string; familyName: string; memberName: string; role: string }> {
  return callFamily('bindMember', { bindCode });
}

/** 登录后自动通过手机号匹配并绑定到预设成员 */
export async function autoBindByMobile(): Promise<{ bound: boolean; reason?: string; familyId?: string; familyName?: string; memberName?: string; role?: string }> {
  return callFamily('autoBindByMobile');
}

/**
 * 调用 member 云函数
 */
async function callMember(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const res = await getCloud().callFunction({
    name: 'member',
    data: { action, ...payload },
  });
  const result = res.result;
  if (result?.code !== 0) {
    throw new Error(result?.message || `member 云函数 [${action}] 调用失败`);
  }
  return result.data;
}

/** 成员字段映射：前端 FamilyMember 字段 → 云端字段 */
function toCloudMember(data: Record<string, any>): Record<string, any> {
  const mapped: Record<string, any> = {};
  if (data.name !== undefined) mapped.name = data.name;
  if (data.gender !== undefined) mapped.gender = data.gender;
  if (data.role !== undefined) mapped.role = data.role;
  if (data.mobile !== undefined) mapped.mobile = data.mobile;
  if (data.avatarColor !== undefined) mapped.avatarColor = data.avatarColor;
  if (data.avatarUrl !== undefined) mapped.avatarUrl = data.avatarUrl;
  if (data.birthDate !== undefined) mapped.birthday = data.birthDate;
  if (data.birthday !== undefined) mapped.birthday = data.birthday;
  if (data.heightCm !== undefined) mapped.height = data.heightCm;
  if (data.height !== undefined) mapped.height = data.height;
  if (data.currentWeightKg !== undefined) mapped.weight = data.currentWeightKg;
  if (data.weight !== undefined) mapped.weight = data.weight;
  if (data.targetWeightKg !== undefined) mapped.targetWeight = data.targetWeightKg;
  if (data.targetWeight !== undefined) mapped.targetWeight = data.targetWeight;
  if (data.isSelf !== undefined) mapped.isSelf = data.isSelf;
  return mapped;
}

/** 获取家庭成员列表 */
export async function listCloudMembers(): Promise<any[]> {
  return callMember('list');
}

/** 云端新增成员（登录用户档案保存时传 userId 关联账号） */
export async function addCloudMember(data: Record<string, any> & { userId?: string }): Promise<{ _id: string }> {
  return callMember('add', { ...toCloudMember(data), userId: data.userId ?? null });
}

/** 云端更新成员 */
export async function updateCloudMember(id: string, data: Record<string, any>): Promise<void> {
  return callMember('update', { _id: id, ...toCloudMember(data) });
}

/** 云端删除成员 */
export async function removeCloudMember(id: string): Promise<void> {
  return callMember('remove', { _id: id });
}
