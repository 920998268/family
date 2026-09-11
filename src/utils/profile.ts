import type { Profile } from '@/types/models';

/** 未填写姓名时的兜底展示名 */
export const UNNAMED_PROFILE = '未填写姓名';

/**
 * 生成「仅保存头像」用的个人档案草稿。
 *
 * 使用场景：用户尚未建立个人档案时，先在「我的」页更换头像。
 * 除姓名外其余字段一律按「未填写」处理（空字符串 / 0），
 * 需与 `validateProfile` 对选填字段的宽松策略保持一致，否则保存会被校验拦截。
 */
export function createAvatarOnlyProfile(name?: string, avatarUrl?: string): Profile {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return {
    name: trimmed || UNNAMED_PROFILE,
    gender: 'other',
    birthDate: '',
    heightCm: 0,
    currentWeightKg: 0,
    targetWeightKg: 0,
    avatarUrl: avatarUrl || undefined,
  };
}

/** 个人信息档案是否为「仅填了头像、身体数据尚未录入」的占位档案 */
export function isPlaceholderProfile(profile: Profile | null | undefined): boolean {
  if (!profile) return true;
  return (
    !profile.birthDate &&
    !profile.heightCm &&
    !profile.currentWeightKg &&
    !profile.targetWeightKg
  );
}
