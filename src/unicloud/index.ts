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

/** member 云函数返回的成员档案 */
export interface MemberProfile {
  _id: string;
  familyId: string;
  userId: string;
  name: string;
  gender: string;
  birthDate: string;
  heightCm: number;
  currentWeightKg: number;
  targetWeightKg: number;
  role: string;
  avatarColor: string;
  createdAt: number;
  updatedAt: number;
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

/** 获取当前用户成员档案 */
export async function getMyMemberProfile(): Promise<MemberProfile | null> {
  return callMember('getMyProfile');
}

/** 保存当前用户成员档案 */
export async function saveMyMemberProfile(profile: Partial<MemberProfile>): Promise<MemberProfile> {
  return callMember('saveMyProfile', profile);
}
