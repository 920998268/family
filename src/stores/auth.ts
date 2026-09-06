import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
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
  const familyId = ref<string>('');
  const familyName = ref<string>('');
  const familyRole = ref<string>('');
  const inviteCode = ref<string>('');
  const checking = ref(false);
  const loggingIn = ref(false);

  const isLoggedIn = computed(() => hasToken());
  const hasFamily = computed(() => !!familyId.value);

  /** 从本地存储恢复登录态（仅 token 检查，用户信息需从云端拉取） */
  function restoreFromStorage(): void {
    // token 由 uniCloud SDK 自动管理，这里只重置内存状态
    uid.value = '';
    nickname.value = '';
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
      return result;
    } finally {
      loggingIn.value = false;
    }
  }

  /** 手机号 + 密码登录 */
  async function loginWithPassword(mobile: string, password: string): Promise<UniIdLoginResult> {
    loggingIn.value = true;
    try {
      const result = await loginByPassword(mobile.trim(), password);
      uid.value = result.uid || '';
      nickname.value = result.nickname || result.mobile || '';
      avatar.value = result.avatar || '';
      return result;
    } finally {
      loggingIn.value = false;
    }
  }

  /** 注册账号，注册成功后自动登录 */
  async function registerAccount(mobile: string, password: string): Promise<UniIdLoginResult> {
    loggingIn.value = true;
    try {
      await cloudRegister(mobile.trim(), password);
      // 注册成功后自动登录获取 token
      const result = await loginByPassword(mobile.trim(), password);
      uid.value = result.uid || '';
      nickname.value = result.nickname || result.mobile || '';
      avatar.value = result.avatar || '';
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
    uid.value = '';
    nickname.value = '';
    avatar.value = '';
    familyId.value = '';
    familyName.value = '';
    familyRole.value = '';
    inviteCode.value = '';
  }

  return {
    uid,
    nickname,
    avatar,
    familyId,
    familyName,
    familyRole,
    inviteCode,
    checking,
    loggingIn,
    isLoggedIn,
    hasFamily,
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
