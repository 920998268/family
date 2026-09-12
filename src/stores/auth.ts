import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { PROFILE_KEY, FAMILY_MEMBERS_KEY } from '@/utils/storageKeys';
import {
  hasToken,
  clearToken,
  loginByWeixin,
  loginByPassword,
  register as cloudRegister,
  logout as cloudLogout,
  getMyFamilyStatus,
  createFamily,
  joinFamily,
  bindMemberByCode as cloudBindMember,
  autoBindByMobile as cloudAutoBindByMobile,
  type UniIdLoginResult,
  type MyFamilyStatus,
  type FamilyInfo,
} from '@/unicloud';

export const useAuthStore = defineStore('auth', () => {
  const uid = ref<string>('');
  const nickname = ref<string>('');
  const avatar = ref<string>('');
  const mobile = ref<string>('');
  const familyId = ref<string>('');
  const familyName = ref<string>('');
  const familyRole = ref<string>('');
  const inviteCode = ref<string>('');
  const checking = ref(false);
  const loggingIn = ref(false);

  /**
   * 是否已登录。
   *
   * ⚠️ **必须是函数，不能写成 `computed`。**
   *
   * token 由 uni-id-co 写入 uni storage，而 storage **不是响应式的**。
   * 用 `computed(() => hasToken())` 包起来，这个 computed 没有任何响应式依赖，
   * 于是**第一次求值后结果被永久缓存**：
   * 未登录时求值过一次 → 之后即使登录成功也一直返回 `false`。
   *
   * 这条路径一定会踩中：`App.vue` 的 `onShow` 会在启动时（早于任何登录动作）
   * 触发打卡云同步的前置判断，把 `false` 缓存下来；
   * 之后再登录，所有云调用都会被静默跳过 —— 现象是「打卡一切正常，
   * 但数据只存在本地、云端一条都没有，也不报错」。
   *
   * 每次调用都实时读一次 storage 才是正确语义（storage 读取是同步且廉价的）。
   */
  function isLoggedIn(): boolean {
    return hasToken();
  }
  const hasFamily = computed(() => !!familyId.value);
  const isOwner = computed(() => familyRole.value === 'owner');

  /** 从本地存储恢复登录态（仅 token 检查，用户信息需从云端拉取） */
  function restoreFromStorage(): void {
    // token 由 uniCloud SDK 自动管理，这里只重置内存状态
    uid.value = '';
    nickname.value = '';
    avatar.value = '';
    mobile.value = '';
    familyId.value = '';
    familyName.value = '';
    familyRole.value = '';
    inviteCode.value = '';
  }

  /**
   * 微信登录
   * 1. uni.login() 获取 code
   * 2. 调用 uni-id-co 云对象换取 token
   */
  async function loginWithWeixin(): Promise<UniIdLoginResult> {
    loggingIn.value = true;
    try {
      const loginRes = await uni.login({ provider: 'weixin' });
      const code = loginRes.code;
      if (!code) {
        throw new Error('获取微信登录凭证失败');
      }
      const result = await loginByWeixin(code);
      uid.value = result.uid || '';
      nickname.value = result.nickname || '';
      avatar.value = result.avatar || '';
      mobile.value = result.mobile || '';
      return result;
    } finally {
      loggingIn.value = false;
    }
  }

  /** 手机号 + 密码登录 */
  async function loginWithPassword(phone: string, password: string): Promise<UniIdLoginResult> {
    loggingIn.value = true;
    try {
      const result = await loginByPassword(phone.trim(), password);
      uid.value = result.uid || '';
      nickname.value = result.nickname || result.mobile || '';
      avatar.value = result.avatar || '';
      mobile.value = result.mobile || phone.trim();
      return result;
    } finally {
      loggingIn.value = false;
    }
  }

  /** 注册账号，注册成功后自动登录 */
  async function registerAccount(phone: string, password: string): Promise<UniIdLoginResult> {
    loggingIn.value = true;
    try {
      await cloudRegister(phone.trim(), password);
      // 注册成功后自动登录获取 token
      const result = await loginByPassword(phone.trim(), password);
      uid.value = result.uid || '';
      nickname.value = result.nickname || result.mobile || '';
      avatar.value = result.avatar || '';
      mobile.value = result.mobile || phone.trim();
      return result;
    } finally {
      loggingIn.value = false;
    }
  }

  /** 拉取当前用户的家庭状态 */
  async function fetchFamilyStatus(): Promise<MyFamilyStatus> {
    checking.value = true;
    try {
      const status = await getMyFamilyStatus();
      // 登录态由 token 维持，应用重启后 uid 需从云端回填，
      // 否则云端恢复无法按 uid 匹配本人档案（档案会一直恢复不出来）
      if (status.uid) {
        uid.value = status.uid;
      }
      if (status.hasFamily && status.familyId) {
        familyId.value = status.familyId;
        familyName.value = status.familyName || '';
        familyRole.value = status.role || '';
        inviteCode.value = status.inviteCode || '';
      } else {
        familyId.value = '';
        familyName.value = '';
        familyRole.value = '';
        inviteCode.value = '';
      }
      return status;
    } finally {
      checking.value = false;
    }
  }

  /** 创建家庭 */
  async function createNewFamily(name: string): Promise<FamilyInfo> {
    const family = await createFamily(name);
    familyId.value = family._id;
    familyName.value = family.name;
    familyRole.value = 'owner';
    inviteCode.value = family.inviteCode;
    return family;
  }

  /** 通过邀请码加入家庭 */
  async function joinExistingFamily(code: string): Promise<FamilyInfo> {
    const family = await joinFamily(code);
    familyId.value = family._id;
    familyName.value = family.name;
    familyRole.value = 'member';
    inviteCode.value = family.inviteCode;
    return family;
  }

  /** 通过绑定码绑定到已有虚拟成员 */
  async function bindToMember(bindCode: string): Promise<{ familyId: string; familyName: string; memberName: string; role: string }> {
    const result = await cloudBindMember(bindCode);
    familyId.value = result.familyId;
    familyName.value = result.familyName;
    familyRole.value = result.role;
    return result;
  }

  /** 登录后自动通过手机号匹配并绑定到预设成员 */
  async function autoBindByMobile(): Promise<{ bound: boolean; reason?: string; familyId?: string; familyName?: string; memberName?: string; role?: string }> {
    const result = await cloudAutoBindByMobile();
    if (result.bound && result.familyId) {
      familyId.value = result.familyId;
      familyName.value = result.familyName || '';
      familyRole.value = result.role || 'member';
    }
    return result;
  }

  /** 退出登录 */
  async function logout(): Promise<void> {
    await cloudLogout();
    clearToken();
    // 清除本地个人档案与家庭成员缓存（已保存到云端，重新登录后自动恢复），并清空账号记忆
    try {
      uni.removeStorageSync(PROFILE_KEY);
      uni.removeStorageSync(FAMILY_MEMBERS_KEY);
      uni.removeStorageSync('last_logged_in_uid');
    } catch (e) {
      // ignore
    }
    uid.value = '';
    nickname.value = '';
    avatar.value = '';
    mobile.value = '';
    familyId.value = '';
    familyName.value = '';
    familyRole.value = '';
    inviteCode.value = '';
  }

  return {
    uid,
    nickname,
    avatar,
    mobile,
    familyId,
    familyName,
    familyRole,
    inviteCode,
    checking,
    loggingIn,
    isLoggedIn,
    hasFamily,
    isOwner,
    restoreFromStorage,
    loginWithWeixin,
    loginWithPassword,
    registerAccount,
    fetchFamilyStatus,
    createNewFamily,
    joinExistingFamily,
    bindToMember,
    autoBindByMobile,
    logout,
  };
});
