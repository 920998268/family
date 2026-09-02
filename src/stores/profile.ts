import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Profile } from '@/types/models';
import { createProfileService } from '@/services';

export const useProfileStore = defineStore('profile', () => {
  const profile = ref<Profile | null>(null);
  const loaded = ref(false);

  function load(): void {
    profile.value = createProfileService().get();
    loaded.value = true;
  }

  function save(value: Profile): Profile {
    const saved = createProfileService().save(value);
    profile.value = saved;
    loaded.value = true;
    return saved;
  }

  function hasProfile(): boolean {
    return profile.value !== null;
  }

  return {
    profile,
    loaded,
    load,
    save,
    hasProfile,
  };
});

