import type { FamilyMember } from '@/types/models';
import { createId } from '@/utils/id';
import { validateFamilyMember } from '@/utils/validation';
import { FamilyRepository } from '@/repositories/FamilyRepository';

export type FamilyMemberDraft = Omit<FamilyMember, 'id'>;
export type FamilyMemberPatch = Partial<Omit<FamilyMember, 'id'>>;

export class FamilyService {
  constructor(private readonly repository: FamilyRepository) {}

  list(): FamilyMember[] {
    return this.repository.getAll();
  }

  add(draft: FamilyMemberDraft): FamilyMember {
    const member: FamilyMember = {
      ...draft,
      id: createId('member'),
    };
    const result = validateFamilyMember(member);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    const members = this.repository.getAll();
    members.push(member);
    this.repository.saveAll(members);
    return member;
  }

  update(id: string, patch: FamilyMemberPatch): FamilyMember {
    const members = this.repository.getAll();
    const index = members.findIndex((member) => member.id === id);
    if (index === -1) {
      throw new Error('未找到要编辑的家庭成员');
    }

    const nextMember: FamilyMember = { ...members[index], ...patch, id };
    const result = validateFamilyMember(nextMember);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    members[index] = nextMember;
    this.repository.saveAll(members);
    return nextMember;
  }

  remove(id: string): void {
    const members = this.repository.getAll();
    const nextMembers = members.filter((member) => member.id !== id);
    if (nextMembers.length === members.length) {
      throw new Error('未找到要删除的家庭成员');
    }
    this.repository.saveAll(nextMembers);
  }
}
