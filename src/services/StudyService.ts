import type { StudyCheckin, StudyPlan, StudyFrequency } from '@/types/models';
import { STUDY_FREQUENCIES } from '@/types/models';
import { createId } from '@/utils/id';
import { validateStudyCheckin, validateStudyPlan } from '@/utils/validation';
import { StudyPlanRepository } from '@/repositories/StudyPlanRepository';
import { StudyCheckinRepository } from '@/repositories/StudyCheckinRepository';

export type StudyPlanDraft = Omit<StudyPlan, 'id' | 'createdAt'>;
export type StudyPlanPatch = Partial<Omit<StudyPlan, 'id' | 'createdAt'>>;
export type StudyCheckinDraft = Omit<StudyCheckin, 'id' | 'date'>;

const FREQUENCY_ORDER: ReadonlyMap<StudyFrequency, number> = new Map(
  STUDY_FREQUENCIES.map((item, index) => [item.value, index] as const),
);

function sortPlans(plans: StudyPlan[]): StudyPlan[] {
  return [...plans].sort((a, b) => {
    const orderDiff =
      (FREQUENCY_ORDER.get(a.frequency) ?? 0) -
      (FREQUENCY_ORDER.get(b.frequency) ?? 0);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export class StudyService {
  constructor(
    private readonly planRepository: StudyPlanRepository,
    private readonly checkinRepository: StudyCheckinRepository,
  ) {}

  listPlans(): StudyPlan[] {
    return sortPlans(this.planRepository.getAll());
  }

  addPlan(draft: StudyPlanDraft): StudyPlan {
    const plan: StudyPlan = {
      ...draft,
      id: createId('study'),
      createdAt: new Date().toISOString(),
    };
    const result = validateStudyPlan(plan);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    const plans = this.planRepository.getAll();
    plans.push(plan);
    this.planRepository.saveAll(plans);
    return plan;
  }

  updatePlan(id: string, patch: StudyPlanPatch): StudyPlan {
    const plans = this.planRepository.getAll();
    const index = plans.findIndex((plan) => plan.id === id);
    if (index === -1) {
      throw new Error('未找到要编辑的学习计划');
    }

    const nextPlan: StudyPlan = { ...plans[index], ...patch, id };
    const result = validateStudyPlan(nextPlan);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    plans[index] = nextPlan;
    this.planRepository.saveAll(plans);
    return nextPlan;
  }

  removePlan(id: string): void {
    const plans = this.planRepository.getAll();
    const nextPlans = plans.filter((plan) => plan.id !== id);
    if (nextPlans.length === plans.length) {
      throw new Error('未找到要删除的学习计划');
    }
    this.planRepository.saveAll(nextPlans);

    const checkins = this.checkinRepository
      .getAll()
      .filter((checkin) => checkin.planId !== id);
    this.clearCheckins();
    for (const checkin of checkins) {
      this.checkinRepository.saveByDate(checkin.date, [
        ...this.checkinRepository.getByDate(checkin.date),
        checkin,
      ]);
    }
  }

  listCheckinsByDate(date: string): StudyCheckin[] {
    return this.checkinRepository.getByDate(date);
  }

  listAllCheckins(): StudyCheckin[] {
    return this.checkinRepository.getAll();
  }

  checkin(date: string, planId: string, note: string, memberId?: string): StudyCheckin {
    const checkin: StudyCheckin = {
      id: createId('checkin'),
      planId,
      date,
      note,
      memberId,
    };
    const result = validateStudyCheckin(checkin);
    if (!result.valid) {
      throw new Error(result.errors.join('；'));
    }

    const checkins = this.checkinRepository.getByDate(date);
    if (checkins.some((item) => item.planId === planId)) {
      throw new Error('该计划今天已打卡');
    }

    checkins.push(checkin);
    this.checkinRepository.saveByDate(date, checkins);
    return checkin;
  }

  removeCheckin(date: string, id: string): void {
    const checkins = this.checkinRepository.getByDate(date);
    const nextCheckins = checkins.filter((checkin) => checkin.id !== id);
    if (nextCheckins.length === checkins.length) {
      throw new Error('未找到要删除的打卡记录');
    }
    this.checkinRepository.saveByDate(date, nextCheckins);
  }

  private clearCheckins(): void {
    for (const date of new Set(this.checkinRepository.getAll().map((item) => item.date))) {
      this.checkinRepository.saveByDate(date, []);
    }
  }
}
