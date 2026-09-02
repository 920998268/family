import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { StudyCheckin, StudyPlan } from '@/types/models';
import type {
  StudyCheckinDraft,
  StudyPlanDraft,
  StudyPlanPatch,
} from '@/services/StudyService';
import { createStudyService } from '@/services';

export const useStudyStore = defineStore('study', () => {
  const plans = ref<StudyPlan[]>([]);
  const checkins = ref<StudyCheckin[]>([]);
  const loadedDate = ref<string | null>(null);

  function loadPlans(): void {
    plans.value = createStudyService().listPlans();
  }

  function loadCheckins(date: string): void {
    checkins.value = createStudyService().listCheckinsByDate(date);
    loadedDate.value = date;
  }

  function addPlan(draft: StudyPlanDraft): StudyPlan {
    const plan = createStudyService().addPlan(draft);
    loadPlans();
    return plan;
  }

  function updatePlan(id: string, patch: StudyPlanPatch): StudyPlan {
    const plan = createStudyService().updatePlan(id, patch);
    loadPlans();
    return plan;
  }

  function removePlan(id: string): void {
    createStudyService().removePlan(id);
    loadPlans();
  }

  function checkin(date: string, draft: StudyCheckinDraft): StudyCheckin {
    const checkin = createStudyService().checkin(
      date,
      draft.planId,
      draft.note,
      draft.memberId,
    );
    loadCheckins(date);
    return checkin;
  }

  function removeCheckin(date: string, id: string): void {
    createStudyService().removeCheckin(date, id);
    loadCheckins(date);
  }

  function hasChecked(planId: string): boolean {
    return checkins.value.some((checkin) => checkin.planId === planId);
  }

  return {
    plans,
    checkins,
    loadedDate,
    loadPlans,
    loadCheckins,
    addPlan,
    updatePlan,
    removePlan,
    checkin,
    removeCheckin,
    hasChecked,
  };
});
