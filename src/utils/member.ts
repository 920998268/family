import type { FamilyMember } from '@/types/models';

/**
 * 在当前家庭的云端成员记录中，定位某个本地成员对应的那一条。
 *
 * 匹配优先级：云端 id → 绑定账号 uid → 预设手机号 → 姓名（仅未绑定记录）。
 * 最后一级只匹配未绑定成员，避免误改其他账号已绑定的档案。
 */
export function matchCloudMember(
  list: Record<string, any>[],
  member: FamilyMember,
): Record<string, any> | undefined {
  const anyMember = member as any;

  if (anyMember.cloudId) {
    const byCloudId = list.find((item) => item._id === anyMember.cloudId);
    if (byCloudId) return byCloudId;
  }

  if (member.userId) {
    const byUser = list.find((item) => item.userId === member.userId);
    if (byUser) return byUser;
  }

  if (member.mobile) {
    const byMobile = list.find((item) => item.mobile === member.mobile);
    if (byMobile) return byMobile;
  }

  if (!member.userId) {
    return list.find((item) => item.name === member.name && !item.userId);
  }

  return undefined;
}
