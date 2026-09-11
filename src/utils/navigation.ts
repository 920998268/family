export const ME_TAB_PATH = '/pages/me/me';

/** 「我的家庭」设置页（家庭空间 / 邀请码 / 成员管理），成员入口统一指向此页 */
export const FAMILY_SETUP_PATH = '/pages/family-setup/family-setup';

export function openMeTab(): void {
  uni.switchTab({ url: ME_TAB_PATH });
}

export function openFamilySetup(): void {
  uni.navigateTo({ url: FAMILY_SETUP_PATH });
}
