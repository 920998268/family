import type { FamilyMember, Profile } from '@/types/models';
import { listCloudMembers } from '@/unicloud';
import { getStorageAdapter } from '@/storage';
import { ProfileRepository } from '@/repositories/ProfileRepository';
import { FamilyRepository } from '@/repositories/FamilyRepository';
import { ProfileService } from './ProfileService';

/** 云端恢复结果 */
export interface CloudRestoreResult {
  restoredProfile: boolean;
  restoredMembers: boolean;
  skipped: boolean; // true=本次被防抖跳过（短时间内已恢复过）
}

/** 云端成员记录 → 前端家庭成员（含身体数据扩展字段，供详情/编辑回填） */
export function toLocalMember(m: Record<string, any>): FamilyMember & Record<string, any> {
  const member: FamilyMember & Record<string, any> = {
    id: m._id || '',
    userId: m.userId || undefined,
    mobile: m.mobile || undefined,
    name: m.name || '',
    role: m.role || 'other',
    avatarColor: m.avatarColor || '#f97316',
    avatarUrl: m.avatarUrl || undefined,
    // 扩展字段（云端字段名 → 前端字段名）
    cloudId: m._id || '',
    gender: m.gender || '',
    birthDate: m.birthday || '',
    heightCm: m.height != null && m.height !== '' ? Number(m.height) : undefined,
    currentWeightKg: m.weight != null && m.weight !== '' ? Number(m.weight) : undefined,
    targetWeightKg: m.targetWeight != null && m.targetWeight !== '' ? Number(m.targetWeight) : undefined,
    isSelf: !!m.isSelf,
  };
  return member;
}

/** 云端成员记录 → 个人档案（仅当数据完整，profile 强校验通过才可保存） */
export function toProfileFromCloud(m: Record<string, any>): Profile | null {
  if (!m || typeof m.name !== 'string' || !m.name.trim()) return null;
  if (!['male', 'female', 'other'].includes(m.gender)) return null;
  return {
    name: m.name,
    gender: m.gender,
    birthDate: typeof m.birthday === 'string' ? m.birthday : '',
    heightCm: m.height != null && m.height !== '' ? Number(m.height) : 0,
    currentWeightKg: m.weight != null && m.weight !== '' ? Number(m.weight) : 0,
    targetWeightKg: m.targetWeight != null && m.targetWeight !== '' ? Number(m.targetWeight) : 0,
    mobile: typeof m.mobile === 'string' && m.mobile ? m.mobile : undefined,
    avatarUrl: typeof m.avatarUrl === 'string' && m.avatarUrl ? m.avatarUrl : undefined,
    role: m.role || undefined,
  };
}

let lastRestoreAt = 0;
const RESTORE_DEBOUNCE_MS = 20000;

/**
 * 从云端拉取当前家庭的成员列表与当前账号的个人档案，写入本地缓存。
 * 覆盖场景：退出登录/切换账号清空本地缓存后，重新登录（或启动）时恢复已保存数据。
 * 依赖：已登录且有家庭（member 云函数按登录态与 familyId 校验）。
 */
export async function restoreFamilyDataFromCloud(uid?: string): Promise<CloudRestoreResult> {
  const empty: CloudRestoreResult = { restoredProfile: false, restoredMembers: false, skipped: false };
  const now = Date.now();
  if (now - lastRestoreAt < RESTORE_DEBOUNCE_MS) {
    return { ...empty, skipped: true };
  }
  lastRestoreAt = now;

  try {
    const members: Record<string, any>[] = await listCloudMembers();
    const list = members || [];

    // 1. 家庭成员列表写入本地缓存
    const familyRepo = new FamilyRepository(getStorageAdapter());
    familyRepo.saveAll(list.map(toLocalMember) as FamilyMember[]);
    empty.restoredMembers = true;

    // 2. 当前账号的个人档案写入本地缓存（数据不完整时跳过，用户重新填写保存后云端自动补齐）
    if (uid) {
      const mine = list.find((m) => m.userId === uid);
      if (mine) {
        const profile = toProfileFromCloud(mine);
        if (profile) {
          try {
            new ProfileService(new ProfileRepository(getStorageAdapter())).save(profile);
            empty.restoredProfile = true;
          } catch (e) {
            console.warn('[云端恢复] 个人档案数据不完整，跳过恢复:', e);
          }
        }
      }
    }
    return empty;
  } catch (e) {
    console.warn('[云端恢复] 拉取失败（可能无家庭或网络异常）:', e);
    return empty;
  }
}
