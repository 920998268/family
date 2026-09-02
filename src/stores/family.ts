import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { FamilyMember } from '@/types/models';
import type { FamilyMemberDraft, FamilyMemberPatch } from '@/services/FamilyService';
import { createFamilyService } from '@/services';

export const useFamilyStore = defineStore('family', () => {
  const members = ref<FamilyMember[]>([]);
  const loaded = ref(false);

  function load(): void {
    members.value = createFamilyService().list();
    loaded.value = true;
  }

  function add(draft: FamilyMemberDraft): FamilyMember {
    const member = createFamilyService().add(draft);
    load();
    return member;
  }

  function update(id: string, patch: FamilyMemberPatch): FamilyMember {
    const member = createFamilyService().update(id, patch);
    load();
    return member;
  }

  function remove(id: string): void {
    createFamilyService().remove(id);
    load();
  }

  function nameOf(memberId: string | undefined): string {
    if (!memberId) {
      return '';
    }
    return members.value.find((member) => member.id === memberId)?.name ?? '';
  }

  return {
    members,
    loaded,
    load,
    add,
    update,
    remove,
    nameOf,
  };
});
