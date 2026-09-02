import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryStorageAdapter } from '@/storage/InMemoryStorageAdapter';
import { FamilyRepository } from '@/repositories/FamilyRepository';
import { StudyPlanRepository } from '@/repositories/StudyPlanRepository';
import { StudyCheckinRepository } from '@/repositories/StudyCheckinRepository';
import { MealPlanRepository } from '@/repositories/MealPlanRepository';
import { TravelRepository } from '@/repositories/TravelRepository';
import { LedgerRepository } from '@/repositories/LedgerRepository';
import { FamilyService } from '@/services/FamilyService';
import { StudyService } from '@/services/StudyService';
import { MealService } from '@/services/MealService';
import { TravelService } from '@/services/TravelService';
import { LedgerService, summarize } from '@/services/LedgerService';
import { BackupService } from '@/services/BackupService';
import {
  validateFamilyMember,
  validateMealPlan,
  validateStudyCheckin,
  validateStudyPlan,
  validateTransaction,
  validateTravelPlan,
} from '@/utils/validation';
import { formatMoney, travelDateRange, travelStatusLabel } from '@/utils/format';
import type {
  FamilyMember,
  MealPlan,
  StudyCheckin,
  StudyPlan,
  Transaction,
  TravelPlan,
} from '@/types/models';

function makeMember(): FamilyMember {
  return { id: 'member-1', name: '爸爸', role: 'parent', avatarColor: '#f97316' };
}

function makeStudyPlan(): StudyPlan {
  return {
    id: 'study-1',
    title: '每天背单词',
    subject: '英语',
    frequency: 'daily',
    targetTimes: 1,
    createdAt: new Date().toISOString(),
  };
}

function makeMealPlan(): MealPlan {
  return {
    id: 'meal-1',
    date: '2026-09-02',
    slot: 'lunch',
    dishName: '西红柿炒蛋',
    ingredients: '西红柿2个、鸡蛋3个',
    cook: '妈妈',
    done: false,
    note: '',
  };
}

function makeTravelPlan(): TravelPlan {
  return {
    id: 'travel-1',
    title: '国庆出游',
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    destination: '云南大理',
    members: [],
    budget: 5000,
    status: 'planned',
    note: '',
    items: [{ id: 'trip-item-1', time: '上午', activity: '游览洱海', note: '', done: false }],
  };
}

function makeTransaction(): Transaction {
  return {
    id: 'txn-1',
    type: 'expense',
    amount: 58.5,
    category: '餐饮',
    date: '2026-09-02',
    note: '买菜',
  };
}

describe('family domain validation', () => {
  it('accepts valid new-domain models', () => {
    expect(validateFamilyMember(makeMember()).valid).toBe(true);
    expect(validateStudyPlan(makeStudyPlan()).valid).toBe(true);
    expect(validateMealPlan(makeMealPlan()).valid).toBe(true);
    expect(validateTravelPlan(makeTravelPlan()).valid).toBe(true);
    expect(validateTransaction(makeTransaction()).valid).toBe(true);

    const checkin: StudyCheckin = {
      id: 'checkin-1',
      planId: 'study-1',
      date: '2026-09-02',
      note: '',
    };
    expect(validateStudyCheckin(checkin).valid).toBe(true);
  });

  it('rejects invalid travel date ranges and malformed items', () => {
    const badRange = validateTravelPlan({
      ...makeTravelPlan(),
      startDate: '2026-10-05',
    });
    expect(badRange.valid).toBe(false);

    const badItems = validateTravelPlan({
      ...makeTravelPlan(),
      items: [{ id: 'x', time: '', activity: '', note: '', done: false }],
    });
    expect(badItems.valid).toBe(false);
  });

  it('rejects invalid transactions and members', () => {
    expect(validateTransaction({ ...makeTransaction(), amount: -1 }).valid).toBe(false);
    expect(validateFamilyMember({ ...makeMember(), name: '' }).valid).toBe(false);
  });
});

describe('family domain repositories', () => {
  let storage: InMemoryStorageAdapter;
  let familyRepository: FamilyRepository;
  let studyPlanRepository: StudyPlanRepository;
  let checkinRepository: StudyCheckinRepository;
  let mealRepository: MealPlanRepository;
  let travelRepository: TravelRepository;
  let ledgerRepository: LedgerRepository;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    familyRepository = new FamilyRepository(storage);
    studyPlanRepository = new StudyPlanRepository(storage);
    checkinRepository = new StudyCheckinRepository(storage);
    mealRepository = new MealPlanRepository(storage);
    travelRepository = new TravelRepository(storage);
    ledgerRepository = new LedgerRepository(storage);
  });

  it('persists family members and study plans as collections', () => {
    familyRepository.saveAll([makeMember()]);
    expect(familyRepository.getAll()).toHaveLength(1);
    familyRepository.saveAll([]);
    expect(familyRepository.getAll()).toHaveLength(0);

    studyPlanRepository.saveAll([makeStudyPlan()]);
    expect(studyPlanRepository.getAll()).toHaveLength(1);
  });

  it('persists study check-ins, meal plans, and transactions by date', () => {
    const checkin: StudyCheckin = { id: 'c1', planId: 'study-1', date: '2026-09-02', note: '' };
    checkinRepository.saveByDate('2026-09-02', [checkin]);
    expect(checkinRepository.getByDate('2026-09-02')).toHaveLength(1);

    mealRepository.saveByDate('2026-09-02', [makeMealPlan()]);
    expect(mealRepository.getByDate('2026-09-02')).toHaveLength(1);

    ledgerRepository.saveByDate('2026-09-02', [makeTransaction()]);
    expect(ledgerRepository.getByDate('2026-09-02')).toHaveLength(1);
    expect(ledgerRepository.getAll()).toHaveLength(1);
  });

  it('persists travel plans as a collection', () => {
    travelRepository.saveAll([makeTravelPlan()]);
    expect(travelRepository.getAll()).toHaveLength(1);
  });
});

describe('family domain services', () => {
  let storage: InMemoryStorageAdapter;
  let familyService: FamilyService;
  let studyService: StudyService;
  let mealService: MealService;
  let travelService: TravelService;
  let ledgerService: LedgerService;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    familyService = new FamilyService(new FamilyRepository(storage));
    studyService = new StudyService(
      new StudyPlanRepository(storage),
      new StudyCheckinRepository(storage),
    );
    mealService = new MealService(new MealPlanRepository(storage));
    travelService = new TravelService(new TravelRepository(storage));
    ledgerService = new LedgerService(new LedgerRepository(storage));
  });

  it('adds, updates, and removes family members', () => {
    const added = familyService.add({ name: '妈妈', role: 'parent', avatarColor: '#0ea5e9' });
    expect(familyService.list()).toHaveLength(1);

    familyService.update(added.id, { name: '老妈' });
    expect(familyService.list()[0].name).toBe('老妈');

    familyService.remove(added.id);
    expect(familyService.list()).toHaveLength(0);
  });

  it('adds study plans and checks in once per plan per day', () => {
    const plan = studyService.addPlan({
      title: '每天背单词',
      subject: '英语',
      frequency: 'daily',
      targetTimes: 1,
    });
    expect(studyService.listPlans()).toHaveLength(1);

    studyService.checkin('2026-09-02', plan.id, '', 'member-1');
    expect(studyService.listCheckinsByDate('2026-09-02')).toHaveLength(1);
    expect(() => studyService.checkin('2026-09-02', plan.id, '', undefined)).toThrow();

    studyService.removeCheckin('2026-09-02', studyService.listCheckinsByDate('2026-09-02')[0].id);
    expect(studyService.listCheckinsByDate('2026-09-02')).toHaveLength(0);
  });

  it('removing a study plan also removes its check-ins', () => {
    const plan = studyService.addPlan({
      title: '阅读',
      subject: '语文',
      frequency: 'weekly',
      targetTimes: 2,
    });
    studyService.checkin('2026-09-02', plan.id, '', undefined);
    expect(studyService.listAllCheckins()).toHaveLength(1);

    studyService.removePlan(plan.id);
    expect(studyService.listPlans()).toHaveLength(0);
    expect(studyService.listAllCheckins()).toHaveLength(0);
  });

  it('adds, executes, and removes meal plans', () => {
    const added = mealService.add('2026-09-02', {
      slot: 'dinner',
      dishName: '红烧排骨',
      ingredients: '排骨500g',
      cook: '爸爸',
      done: false,
      note: '',
    });
    expect(mealService.listByDate('2026-09-02')).toHaveLength(1);

    mealService.update('2026-09-02', added.id, { done: true });
    expect(mealService.listByDate('2026-09-02')[0].done).toBe(true);

    mealService.remove('2026-09-02', added.id);
    expect(mealService.listByDate('2026-09-02')).toHaveLength(0);
  });

  it('adds, updates status, toggles items, and removes travel plans', () => {
    const added = travelService.add({
      title: '周末露营',
      startDate: '2026-09-05',
      endDate: '2026-09-06',
      destination: '郊外',
      members: [],
      budget: 800,
      status: 'planned',
      note: '',
      items: [{ time: '周六', activity: '搭帐篷', note: '', done: false }],
    });
    expect(added.items[0].id).toBeTruthy();

    travelService.setStatus(added.id, 'ongoing');
    expect(travelService.list()[0].status).toBe('ongoing');

    travelService.toggleItem(added.id, added.items[0].id);
    expect(travelService.list()[0].items[0].done).toBe(true);

    travelService.remove(added.id);
    expect(travelService.list()).toHaveLength(0);
  });

  it('adds, summarizes, and removes ledger entries', () => {
    ledgerService.add('2026-09-02', {
      type: 'expense',
      amount: 58.5,
      category: '餐饮',
      note: '',
    });
    ledgerService.add('2026-09-02', {
      type: 'income',
      amount: 1000,
      category: '工资',
      note: '',
    });

    const summary = ledgerService.summary(ledgerService.listByDate('2026-09-02'));
    expect(summary).toEqual({ income: 1000, expense: 58.5, balance: 941.5 });
    expect(summarize([])).toEqual({ income: 0, expense: 0, balance: 0 });

    ledgerService.remove('2026-09-02', ledgerService.listByDate('2026-09-02')[0].id);
    expect(ledgerService.listByDate('2026-09-02')).toHaveLength(1);
  });

  it('filters ledger entries by month', () => {
    ledgerService.add('2026-09-02', {
      type: 'expense',
      amount: 10,
      category: '交通',
      note: '',
    });
    ledgerService.add('2026-08-02', {
      type: 'expense',
      amount: 20,
      category: '交通',
      note: '',
    });

    expect(ledgerService.listByMonth('2026-09')).toHaveLength(1);
    expect(ledgerService.listByMonth('2026-08')).toHaveLength(1);
  });
});

describe('family domain formatting', () => {
  it('formats money and travel date ranges', () => {
    expect(formatMoney(1234.5)).toBe('¥1,234.50');
    expect(formatMoney(0)).toBe('¥0.00');
    expect(travelDateRange({ ...makeTravelPlan(), startDate: '2026-10-01', endDate: '2026-10-01' })).toContain('10月1日');
    expect(travelDateRange(makeTravelPlan())).toContain('至');
    expect(travelStatusLabel(makeTravelPlan())).toBe('计划中');
  });
});

describe('family backup round trip', () => {
  it('exports and imports all family domains', () => {
    const storage = new InMemoryStorageAdapter();
    const familyService = new FamilyService(new FamilyRepository(storage));
    const studyService = new StudyService(
      new StudyPlanRepository(storage),
      new StudyCheckinRepository(storage),
    );
    const mealService = new MealService(new MealPlanRepository(storage));
    const travelService = new TravelService(new TravelRepository(storage));
    const ledgerService = new LedgerService(new LedgerRepository(storage));

    familyService.add({ name: '爸爸', role: 'parent', avatarColor: '#f97316' });
    const plan = studyService.addPlan({
      title: '每天背单词',
      subject: '英语',
      frequency: 'daily',
      targetTimes: 1,
    });
    studyService.checkin('2026-09-02', plan.id, '', undefined);
    mealService.add('2026-09-02', {
      slot: 'breakfast',
      dishName: '牛奶燕麦',
      ingredients: '牛奶1杯、燕麦50g',
      cook: '爸爸',
      done: true,
      note: '',
    });
    travelService.add({
      title: '周末出游',
      startDate: '2026-09-05',
      endDate: '2026-09-06',
      destination: '海边',
      members: [],
      budget: 1000,
      status: 'planned',
      note: '',
      items: [],
    });
    ledgerService.add('2026-09-02', {
      type: 'expense',
      amount: 66,
      category: '餐饮',
      note: '',
    });

    const backupService = new BackupService(storage);
    const exported = backupService.export();
    expect(exported.familyMembers).toHaveLength(1);
    expect(exported.studyPlans).toHaveLength(1);
    expect(exported.studyCheckins).toHaveLength(1);
    expect(exported.mealPlans).toHaveLength(1);
    expect(exported.travelPlans).toHaveLength(1);
    expect(exported.transactions).toHaveLength(1);

    const freshStorage = new InMemoryStorageAdapter();
    new BackupService(freshStorage).import(exported);

    expect(new FamilyRepository(freshStorage).getAll()).toHaveLength(1);
    expect(new StudyPlanRepository(freshStorage).getAll()).toHaveLength(1);
    expect(new StudyCheckinRepository(freshStorage).getAll()).toHaveLength(1);
    expect(new MealPlanRepository(freshStorage).getAll()).toHaveLength(1);
    expect(new TravelRepository(freshStorage).getAll()).toHaveLength(1);
    expect(new LedgerRepository(freshStorage).getAll()).toHaveLength(1);
  });
});
