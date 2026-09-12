/**
 * uniCloud 调用封装
 * 统一管理云对象、云函数调用与登录态。
 */

import type { DietEntry, FavoriteFood, StudyCheckin, StudyPlan, WorkoutEntry } from '@/types/models';
import {
  mapCloudDiets,
  mapCloudFoods,
  mapCloudStudyCheckins,
  mapCloudStudyPlans,
  mapCloudWorkouts,
  toCloudDiet,
  toCloudStudyCheckin,
  toCloudStudyPlan,
  toCloudWorkout,
} from '@/utils/cloudMap';
import { parseTombstones, type Tombstone } from '@/utils/tombstone';

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
  /** 当前登录账号 uid，用于云端恢复时匹配本人档案 */
  uid?: string;
  familyId?: string;
  familyName?: string;
  role?: string;
  inviteCode?: string;
}

const UNI_ID_TOKEN_KEY = 'uni_id_token';

/**
 * 提取云函数返回的错误文案。
 * 本仓库自研云函数（family / member / register）统一返回 `{ code, msg }`，
 * 而 uni-id-co 云对象走 `errMsg`，这里统一兼容，避免业务提示被吞成通用文案。
 */
function cloudErrorText(result: any, fallback: string): string {
  const text = result?.msg || result?.message || result?.errMsg;
  return typeof text === 'string' && text ? text : fallback;
}

let uniCloudInited = false;
/** 初始化后的 uniCloud 实例（init() 返回新对象，必须用此变量引用） */
let cloudInstance: any = null;

/** 上传头像到云存储，返回永久 fileID（用于跨设备显示） */
export async function uploadAvatar(filePath: string): Promise<string> {
  const cloud = getCloud();
  const res = await cloud.uploadFile({
    filePath,
    cloudPath: `avatar/${Date.now()}-${Math.floor(Math.random() * 10000)}.png`,
  });
  if (!res || !res.fileID) {
    throw new Error('头像上传失败');
  }
  return res.fileID;
}

/**
 * 获取当前可用的 uniCloud 实例。
 *
 * ⚠️ 所有前端云能力调用都必须走这里，不要直接写裸 `uniCloud.xxx()`。
 * 原因：编译后裸 `uniCloud` 会被内联成 `@dcloudio/uni-cloud` 的**静态导出快照**，
 * 该快照在模块首次求值时就已经是「未关联服务空间」的桩对象，
 * 之后 `initUniCloud()` 替换 `globalThis.uniCloud` 也改不到它，
 * 于是运行时只会抛出「uni-app cli项目内使用uniCloud需要使用HBuilderX的运行菜单运行项目」。
 * 本函数优先返回 `initUniCloud()` 产出的实例，因此不受该快照影响。
 */
export function getCloud(): any {
  return cloudInstance || (globalThis as any).uniCloud;
}

/** 云能力是否已成功初始化（未初始化时调用云 API 会命中框架桩对象而报错） */
export function isCloudReady(): boolean {
  return !!cloudInstance;
}

/**
 * 手动初始化 uniCloud（CLI 项目需要，框架不会自动注入服务空间配置）
 * 在 App.vue onLaunch 中调用一次即可
 * @returns 是否初始化成功
 */
export function initUniCloud(): boolean {
  if (uniCloudInited) return true;
  const spaceId = import.meta.env.VITE_UNI_CLOUD_SPACE_ID as string | undefined;
  const accessKey = import.meta.env.VITE_UNI_CLOUD_ACCESS_KEY as string | undefined;
  if (!spaceId || !accessKey) {
    console.warn('[uniCloud] 缺少 VITE_UNI_CLOUD_SPACE_ID 或 VITE_UNI_CLOUD_ACCESS_KEY，云能力不可用');
    return false;
  }
  const raw = (globalThis as any).uniCloud;
  if (!raw || typeof raw.init !== 'function') {
    console.error('[uniCloud] 运行环境中未找到可用的 uniCloud，无法初始化');
    return false;
  }
  try {
    const inited = raw.init({
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
    return true;
  } catch (e) {
    console.error('[uniCloud] 初始化失败:', e);
    return false;
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
    throw new Error(cloudErrorText(result, `family 云函数 [${action}] 调用失败`));
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

/** 修改家庭名称（仅管理员） */
export async function updateFamilyName(name: string): Promise<{ familyId: string; name: string }> {
  return callFamily('updateFamilyName', { name });
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
    throw new Error(cloudErrorText(result, `member 云函数 [${action}] 调用失败`));
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

/** 云端更新成员（userId 仅在显式传入时透传，避免误清已有绑定） */
export async function updateCloudMember(id: string, data: Record<string, any>): Promise<void> {
  const payload: Record<string, any> = { _id: id, ...toCloudMember(data) };
  if (data.userId !== undefined) payload.userId = data.userId;
  return callMember('update', payload);
}

/** 云端删除成员 */
export async function removeCloudMember(id: string): Promise<void> {
  return callMember('remove', { _id: id });
}

/**
 * 调用 diet 云函数（饮食打卡 + 常用食物）
 *
 * ⚠️ 与 callFamily / callMember 一致，必须走 getCloud()，
 * 裸 `uniCloud.callFunction` 会命中框架静态快照而必然失败（见 getCloud 注释）。
 */
async function callDiet(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const res = await getCloud().callFunction({
    name: 'diet',
    data: { action, ...payload },
  });
  const result = res.result;
  if (result?.code !== 0) {
    throw new Error(cloudErrorText(result, `diet 云函数 [${action}] 调用失败`));
  }
  return result.data;
}

/** 拉取某一天的饮食记录（云端为准） */
export async function listCloudDiets(date: string): Promise<DietEntry[]> {
  return mapCloudDiets(await callDiet('list', { date }));
}

/** 拉取日期区间内的饮食记录 */
export async function listCloudDietsRange(from: string, to: string): Promise<DietEntry[]> {
  return mapCloudDiets(await callDiet('list', { from, to }));
}

/** 云端写入结果：`duplicated` 为真表示服务端已存在同 clientId 记录（幂等命中） */
export interface CloudWriteResult {
  _id: string;
  duplicated?: boolean;
}

/** 新增饮食记录（以 entry.id 作为 clientId，服务端幂等） */
export async function addCloudDiet(entry: DietEntry): Promise<CloudWriteResult> {
  return callDiet('add', toCloudDiet(entry));
}

/** 更新饮食记录（同样以 entry.id 定位） */
export async function updateCloudDiet(entry: DietEntry): Promise<void> {
  return callDiet('update', toCloudDiet(entry));
}

/**
 * 删除饮食记录（服务端幂等：记录不存在也返回成功）。
 * 返回 `removed` 便于调用方区分「删掉了」与「云端本来就没有」。
 *
 * `date` 是可选的**兜底信息**：云端会优先用记录自身的日期写墓碑，
 * 只有当记录已不存在（重试场景）时才用它。墓碑的日期用来让别的设备
 * 快速定位本地记录，不影响删除本身。
 */
export async function removeCloudDiet(
  clientId: string,
  date?: string,
): Promise<{ removed: boolean }> {
  return callDiet('remove', date ? { clientId, date } : { clientId });
}

/**
 * 增量拉取本家庭的**饮食墓碑**（删除日志），用于跨设备同步删除。
 *
 * `since` 传本地游标（已应用到的最大 deletedAt）；首次传 0 或省略即拉取全部。
 */
export async function listCloudDietTombstones(since?: number): Promise<Tombstone[]> {
  return parseTombstones(await callDiet('listTombstones', { since: since ?? 0 }));
}

/** 拉取常用食物（按使用次数降序，可按关键词模糊筛选） */
export async function listCloudFavoriteFoods(keyword?: string): Promise<FavoriteFood[]> {
  return mapCloudFoods(await callDiet('listFoods', keyword ? { keyword } : {}));
}

/** 删除常用食物（按名称，家庭内唯一） */
export async function removeCloudFavoriteFood(name: string): Promise<void> {
  return callDiet('removeFood', { name });
}

/** 调用 workout 云函数（运动打卡，力量 / 有氧共用） */
async function callWorkout(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const res = await getCloud().callFunction({
    name: 'workout',
    data: { action, ...payload },
  });
  const result = res.result;
  if (result?.code !== 0) {
    throw new Error(cloudErrorText(result, `workout 云函数 [${action}] 调用失败`));
  }
  return result.data;
}

/** 拉取某一天的运动记录 */
export async function listCloudWorkouts(date: string): Promise<WorkoutEntry[]> {
  return mapCloudWorkouts(await callWorkout('list', { date }));
}

/** 拉取日期区间内的运动记录 */
export async function listCloudWorkoutsRange(from: string, to: string): Promise<WorkoutEntry[]> {
  return mapCloudWorkouts(await callWorkout('list', { from, to }));
}

/** 新增运动记录（以 entry.id 作为 clientId，服务端幂等） */
export async function addCloudWorkout(entry: WorkoutEntry): Promise<CloudWriteResult> {
  return callWorkout('add', toCloudWorkout(entry));
}

/** 更新运动记录 */
export async function updateCloudWorkout(entry: WorkoutEntry): Promise<void> {
  return callWorkout('update', toCloudWorkout(entry));
}

/** 删除运动记录（服务端幂等，返回 `removed` 见 removeCloudDiet 说明；`date` 同为其墓碑兜底） */
export async function removeCloudWorkout(
  clientId: string,
  date?: string,
): Promise<{ removed: boolean }> {
  return callWorkout('remove', date ? { clientId, date } : { clientId });
}

/** 增量拉取本家庭的运动墓碑（语义同 `listCloudDietTombstones`） */
export async function listCloudWorkoutTombstones(since?: number): Promise<Tombstone[]> {
  return parseTombstones(await callWorkout('listTombstones', { since: since ?? 0 }));
}

/**
 * 调用 study 云函数（学习计划 + 学习打卡）
 *
 * 两者在同一个云函数里，是因为它们是主从关系（打卡从属于计划、
 * 删计划要级联删打卡）。详见 docs/0.3.3-m2b-requirements-and-solution.md §2.1。
 *
 * ⚠️ 必须走 getCloud()，裸 `uniCloud.callFunction` 会命中框架静态快照而必然失败。
 */
async function callStudy(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const res = await getCloud().callFunction({
    name: 'study',
    data: { action, ...payload },
  });
  const result = res.result;
  if (result?.code !== 0) {
    throw new Error(cloudErrorText(result, `study 云函数 [${action}] 调用失败`));
  }
  return result.data;
}

/** 拉取本家庭的全部学习计划（计划不分日期，全量拉取） */
export async function listCloudStudyPlans(): Promise<StudyPlan[]> {
  return mapCloudStudyPlans(await callStudy('listPlans'));
}

/** 新增学习计划（以 plan.id 作为 clientId，服务端幂等） */
export async function addCloudStudyPlan(plan: StudyPlan): Promise<CloudWriteResult> {
  return callStudy('addPlan', toCloudStudyPlan(plan));
}

/** 更新学习计划（同样以 plan.id 定位；创建时间由服务端保留，不接受覆盖） */
export async function updateCloudStudyPlan(plan: StudyPlan): Promise<void> {
  return callStudy('updatePlan', toCloudStudyPlan(plan));
}

/**
 * 删除学习计划。
 *
 * ⚠️ 服务端会**级联删除**该计划的全部打卡，所以返回里带 `deletedCheckins` 计数。
 * 若云端历史打卡过多、一次没删完，服务端会返回可重试的失败（计划不会被删），
 * 重试即可接着删 —— 这正是不能用「本地直接删掉」来替代的地方。
 */
export async function removeCloudStudyPlan(
  clientId: string,
): Promise<{ removed: boolean; deletedCheckins: number }> {
  return callStudy('removePlan', { clientId });
}

/** 拉取某一天的学习打卡（打卡按日期组织） */
export async function listCloudStudyCheckins(date: string): Promise<StudyCheckin[]> {
  return mapCloudStudyCheckins(await callStudy('listCheckins', { date }));
}

/** 新增学习打卡（以 checkin.id 作为 clientId；服务端保证「同一计划同一天仅一次」） */
export async function addCloudStudyCheckin(checkin: StudyCheckin): Promise<CloudWriteResult> {
  return callStudy('addCheckin', toCloudStudyCheckin(checkin));
}

/** 删除学习打卡（服务端幂等；`date` 为其墓碑兜底，语义同 removeCloudDiet） */
export async function removeCloudStudyCheckin(
  clientId: string,
  date?: string,
): Promise<{ removed: boolean }> {
  return callStudy('removeCheckin', date ? { clientId, date } : { clientId });
}

/**
 * 增量拉取本家庭的学习墓碑，**一次返回计划与打卡两类**
 * （主从同函数，一次调用拿全，避免两次往返）。
 */
export async function listCloudStudyTombstones(since?: number): Promise<Tombstone[]> {
  return parseTombstones(await callStudy('listTombstones', { since: since ?? 0 }));
}
