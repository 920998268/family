import type {
  DietEntry,
  FavoriteFood,
  MealPlan,
  MealType,
  StudyCheckin,
  StudyFrequency,
  StudyPlan,
  TravelItem,
  TravelPlan,
  TravelStatus,
  WorkoutEntry,
  WorkoutSet,
} from '@/types/models';
import { isMealType, isStudyFrequency, isTravelStatus, isWorkoutCategory } from '@/utils/storageKeys';
import { normalizeWorkoutCategory } from '@/utils/workout';
import { toIsoString } from '@/utils/date';
import { normalizeStudyNote } from '@/utils/study';
import { normalizeTravelMembers } from '@/utils/travel';
import {
  validateDietEntry,
  validateFavoriteFood,
  validateMealPlan,
  validateStudyCheckin,
  validateStudyPlan,
  validateTravelItem,
  validateTravelPlan,
  validateWorkoutEntry,
} from '@/utils/validation';

/**
 * 前端模型 ↔ 云函数记录 的双向映射（纯函数，可单元测试）。
 *
 * 为什么必须单独一层：
 * 1. **改名**：前端用 `id` 标识记录，云端幂等键叫 `clientId`，换名集中在此，避免散落各处；
 * 2. **`null` ↔ `undefined`**：云端把「未填写」统一存成 `null`，而前端校验器
 *    （`numberError`）把 `null` 判为非法数值 —— 下行时若不还原成 `undefined`，
 *    云端回来的记录会被本地 Repository 静默丢弃；
 * 3. **序列化丢键**：`callFunction` 走 JSON，`undefined` 键会被丢掉，
 *    上行时必须显式写 `null` 才能表达「用户清空了这个字段」。
 */

/**
 * 上行：前端记录 → `diet` 云函数入参（`clientId` 即前端 `id`）。
 *
 * ⚠️ 必须用 `type` 而不是 `interface`：TypeScript 只为对象**类型别名**推导隐式索引签名，
 * 而 `callDiet(action, payload: Record<string, unknown>)` 要求可索引。换成 `interface` 会报 TS2345。
 */
export type CloudDietPayload = {
  clientId: string;
  date: string;
  mealType: MealType;
  foodName: string;
  quantity: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  memberId: string | null;
};

/** 上行：前端记录 → `workout` 云函数入参（同样必须用 `type`，原因见上） */
export type CloudWorkoutPayload = {
  clientId: string;
  date: string;
  category: string;
  exerciseName: string;
  sets: WorkoutSet[];
  durationMin: number | null;
  distanceKm: number | null;
  calories: number | null;
  memberId: string | null;
};

/** 上行：前端学习计划 → `study` 云函数入参（同样必须用 `type`，原因见上） */
export type CloudStudyPlanPayload = {
  clientId: string;
  title: string;
  subject: string;
  frequency: StudyFrequency;
  targetTimes: number;
  memberId: string | null;
};

/** 上行：前端学习打卡 → `study` 云函数入参 */
export type CloudStudyCheckinPayload = {
  clientId: string;
  planId: string;
  date: string;
  note: string;
  memberId: string | null;
};

/**
 * 上行：前端食谱记录 → `meal` 云函数入参（M3）。
 *
 * ⚠️ 同样必须用 `type` 而不是 `interface`，原因见 `CloudDietPayload` 注释。
 */
export type CloudMealPayload = {
  clientId: string;
  date: string;
  slot: MealType;
  dishName: string;
  ingredients: string;
  cook: string;
  done: boolean;
  note: string;
};

/**
 * 上行：前端出行计划 → `travel` 云函数入参（M3）。
 *
 * ⚠️ **不含 `items`**：明细是独立集合，由 `computeItemDiff` 拆成
 * 记录级的 `addItem` / `updateItem` / `removeItem` 逐条下发（方案 §3.5）。
 * 把 items 塞进来就退化成「整包覆盖」，两人同时编辑会互相覆盖。
 */
export type CloudTravelPlanPayload = {
  clientId: string;
  title: string;
  startDate: string;
  endDate: string;
  destination: string;
  members: string[];
  budget: number;
  status: TravelStatus;
  note: string;
};

/** 上行：前端行程明细 → `travel` 云函数入参（同样不含父计划以外的结构） */
export type CloudTravelItemPayload = {
  clientId: string;
  travelId: string;
  order: number;
  time: string;
  activity: string;
  note: string;
  done: boolean;
};

/** 可选数值：`undefined` / `null` / 空串一律上行为 null（显式清空） */
function upNumber(value: number | undefined): number | null {
  return value === undefined || value === null ? null : value;
}

/** 可选字符串：空值上行为 null（云端 `normalizeOptionalId` 同样归一到 null） */
function upId(value: string | undefined): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** 安全取字符串（下行容错：类型不对一律当空串，绝不抛出） */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 下行可选数值：`null` / 空串 / 非数字 → `undefined`。
 *
 * ⚠️ 这里必须返回 `undefined` 而不是 `null`：前端 `validateDietEntry` 只在
 * `fieldValue !== undefined` 时才校验数值，传 `null` 会直接判为「必须是数字」而丢失整条记录。
 */
function downNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/** 逐行映射并丢弃非法行（重复前端 Repository 的同一套校验，防止脏数据写入本地缓存） */
function mapRows<T>(
  rows: unknown,
  mapOne: (row: Record<string, unknown>) => T,
  isValid: (value: unknown) => boolean,
  label: string,
): T[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  const out: T[] = [];
  let dropped = 0;

  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      dropped += 1;
      continue;
    }
    const mapped = mapOne(row as Record<string, unknown>);
    if (isValid(mapped)) {
      out.push(mapped);
    } else {
      dropped += 1;
    }
  }

  if (dropped > 0) {
    console.warn(`[cloudMap] ${label}：丢弃 ${dropped} 条不合法记录`);
  }

  return out;
}

/** 前端饮食记录 → `diet` 云函数入参 */
export function toCloudDiet(entry: DietEntry): CloudDietPayload {
  return {
    clientId: entry.id,
    date: entry.date,
    mealType: entry.mealType,
    foodName: entry.foodName,
    quantity: entry.quantity,
    calories: upNumber(entry.calories),
    protein: upNumber(entry.protein),
    carbs: upNumber(entry.carbs),
    fat: upNumber(entry.fat),
    memberId: upId(entry.memberId),
  };
}

/**
 * 前端运动记录 → `workout` 云函数入参。
 *
 * `category` 经 `normalizeWorkoutCategory` 归一：老记录（无 `category`）在本地
 * 也可能被更新后重传，归一后云端能拿到明确类型，不会退化成回推。
 * `sets` 恒为数组：有氧上传空数组（云端以「数组非空」判定形态矛盾）。
 */
export function toCloudWorkout(entry: WorkoutEntry): CloudWorkoutPayload {
  const sets = Array.isArray(entry.sets) ? entry.sets : [];
  return {
    clientId: entry.id,
    date: entry.date,
    category: normalizeWorkoutCategory({ category: entry.category, sets }),
    exerciseName: entry.exerciseName,
    sets,
    durationMin: upNumber(entry.durationMin),
    distanceKm: upNumber(entry.distanceKm),
    calories: upNumber(entry.calories),
    memberId: upId(entry.memberId),
  };
}

/**
 * 前端学习计划 → `study` 云函数入参。
 *
 * ⚠️ **不上行 `createdAt`**：创建时间由服务端 `Date.now()` 决定。
 * 上行的话，客户端的时钟偏差会污染计划排序（列表按 createdAt 排），
 * 而且更新时还可能被误改。
 */
export function toCloudStudyPlan(plan: StudyPlan): CloudStudyPlanPayload {
  return {
    clientId: plan.id,
    title: plan.title,
    subject: plan.subject,
    frequency: plan.frequency,
    targetTimes: plan.targetTimes,
    memberId: upId(plan.memberId),
  };
}

/**
 * 前端学习打卡 → `study` 云函数入参。
 *
 * `note` 恒为字符串（可为空串）：云端 `normalizeNote` 也把空值落成空串，
 * 两端一致，不会出现「本地空串 / 云端 null」这种往返不一致。
 */
export function toCloudStudyCheckin(checkin: StudyCheckin): CloudStudyCheckinPayload {
  return {
    clientId: checkin.id,
    planId: checkin.planId,
    date: checkin.date,
    note: normalizeStudyNote(checkin.note),
    memberId: upId(checkin.memberId),
  };
}

// ---------- M3：食谱 / 出行 ----------

/**
 * 前端食谱记录 → `meal` 云函数入参。
 *
 * ⚠️ **不上行 `createdAt` / `updatedAt`**：创建时间由服务端 `Date.now()` 决定
 *（同 `toCloudStudyPlan`，理由见其注释：客户端时钟偏差会污染服务端排序）。
 * `ingredients` / `cook` / `note` 恒为字符串（可为空串）：云端
 * `normalizeOptionalText` 也把空值落成 `''`，两端一致，
 * 不会出现「本地空串 / 云端 null」这种往返不一致。
 */
export function toCloudMeal(plan: MealPlan): CloudMealPayload {
  return {
    clientId: plan.id,
    date: plan.date,
    slot: plan.slot,
    dishName: plan.dishName,
    ingredients: asString(plan.ingredients),
    cook: asString(plan.cook),
    done: plan.done === true,
    note: asString(plan.note),
  };
}

/**
 * 前端出行计划 → `travel` 云函数入参。
 *
 * `members` 经 `normalizeTravelMembers` 归一（去重 + 剔除空值 + 保持顺序），
 * 与云端 `normalizeMembers` **同口径**：两端不一致的话，同一份计划在本地与云端
 * 会长得不一样，后续合并会反复「发现变化」而白白推送（`tests/travel-lib.test.ts` 有守卫）。
 *
 * `budget` 上传前收敛成有限数：云端只接受 0~1e8，`undefined` 会让整条计划被拒
 *（云端 `normalizeBudget` 把缺省当 0，但前端模型里 `budget` 本就是必填数字）。
 */
export function toCloudTravelPlan(plan: TravelPlan): CloudTravelPlanPayload {
  return {
    clientId: plan.id,
    title: plan.title,
    startDate: plan.startDate,
    endDate: plan.endDate,
    destination: asString(plan.destination),
    members: normalizeTravelMembers(plan.members),
    budget: Number.isFinite(plan.budget) ? plan.budget : 0,
    status: plan.status,
    note: asString(plan.note),
  };
}

/**
 * 前端行程明细 → `travel` 云函数入参。
 *
 * ⚠️ `travelId` 由调用方（同步层）显式传入，**不从明细对象上取**：
 *    拆表之后明细自己不知道自己属于谁，归属只存在于「计划 → 它的 items」这一层。
 *
 * `fallbackOrder` 用于老数据（`order` 缺失）：与 `sortTravelItems` 的兜底口径一致
 *（缺失时按数组下标理解），否则两端看到的顺序会不同。
 */
export function toCloudTravelItem(
  travelId: string,
  item: TravelItem,
  fallbackOrder = 0,
): CloudTravelItemPayload {
  const order =
    typeof item.order === 'number' && Number.isFinite(item.order) && item.order >= 0
      ? Math.floor(item.order)
      : fallbackOrder;

  return {
    clientId: item.id,
    travelId,
    order,
    time: asString(item.time),
    activity: asString(item.activity),
    note: asString(item.note),
    done: item.done === true,
  };
}

/**
 * 云端计划记录 → 前端 `StudyPlan`。
 *
 * ⚠️ `createdAt` 需要**跨端换算**：云端存毫秒时间戳，前端模型是 ISO 字符串。
 * `toIsoString` 同时接受毫秒与 ISO（服务端 `toClientPlan` 已转过一次也幂等），
 * 解析失败返回空串 —— 会被 `validateStudyPlan` 明确拦下（显式丢弃），
 * 而不是塞一个看似合法的值让计划列表排序静默错乱。
 */
export function fromCloudStudyPlan(row: unknown): StudyPlan {
  const doc = (row || {}) as Record<string, unknown>;

  return {
    id: asString(doc.id) || asString(doc.clientId) || asString(doc._id),
    title: asString(doc.title),
    subject: asString(doc.subject),
    frequency: isStudyFrequency(doc.frequency) ? doc.frequency : 'daily',
    targetTimes: downNumber(doc.targetTimes) ?? 0,
    memberId: asString(doc.memberId) || undefined,
    createdAt: toIsoString(doc.createdAt),
  };
}

/**
 * 云端打卡记录 → 前端 `StudyCheckin`。
 *
 * ⚠️ `note` 必须经 `normalizeStudyNote` 归一：云端空备注是 `null`，
 * 而 `validateStudyCheckin` 要求它是字符串 —— 不归一化整条打卡会被
 * `StudyCheckinRepository` **静默丢弃**。
 */
export function fromCloudStudyCheckin(row: unknown): StudyCheckin {
  const doc = (row || {}) as Record<string, unknown>;

  return {
    id: asString(doc.id) || asString(doc.clientId) || asString(doc._id),
    planId: asString(doc.planId),
    date: asString(doc.date),
    note: normalizeStudyNote(doc.note),
    memberId: asString(doc.memberId) || undefined,
  };
}

/** 云端记录 → 前端 `DietEntry`（同时兼容服务端 `toClientDiet` 形态与裸库文档） */
export function fromCloudDiet(row: unknown): DietEntry {
  const doc = (row || {}) as Record<string, unknown>;

  return {
    id: asString(doc.id) || asString(doc.clientId) || asString(doc._id),
    date: asString(doc.date),
    mealType: isMealType(doc.mealType) ? doc.mealType : 'breakfast',
    foodName: asString(doc.foodName),
    quantity: asString(doc.quantity),
    calories: downNumber(doc.calories),
    protein: downNumber(doc.protein),
    carbs: downNumber(doc.carbs),
    fat: downNumber(doc.fat),
    memberId: asString(doc.memberId) || undefined,
  };
}

/**
 * 云端记录 → 前端 `WorkoutEntry`。
 *
 * `order` 一律按数组下标重排（不信任线上传来的顺序，也不信任 `order` 字段本身），
 * 这样产出物才满足前端 `validateWorkoutEntry` 的「序号必须连续」约束。
 */
export function fromCloudWorkout(row: unknown): WorkoutEntry {
  const doc = (row || {}) as Record<string, unknown>;
  const rawSets = Array.isArray(doc.sets) ? doc.sets : [];

  const sets: WorkoutSet[] = rawSets.map((item, index) => {
    const set = (item || {}) as Record<string, unknown>;
    return {
      id: asString(set.id) || `set-${index + 1}`,
      order: index + 1,
      reps: downNumber(set.reps) ?? 0,
      weightKg: downNumber(set.weightKg) ?? 0,
    };
  });

  // 老记录（0.3.2 之前）没有 category：按「有组明细 = 力量」推断，绝不判为非法
  const category = isWorkoutCategory(doc.category)
    ? doc.category
    : normalizeWorkoutCategory({ sets });

  return {
    id: asString(doc.id) || asString(doc.clientId) || asString(doc._id),
    date: asString(doc.date),
    category,
    exerciseName: asString(doc.exerciseName),
    sets,
    durationMin: downNumber(doc.durationMin),
    distanceKm: downNumber(doc.distanceKm),
    calories: downNumber(doc.calories),
    memberId: asString(doc.memberId) || undefined,
  };
}

/**
 * 云端记录 → 前端 `FavoriteFood`。
 *
 * 注意：`quantity` 为空的记录会被 `validateFavoriteFood` 拦下（前端要求数量非空）——
 * 这是刻意的：常用食物的一键带出必须包含数量，没有数量的条目没有使用价值。
 */
export function fromCloudFood(row: unknown): FavoriteFood {
  const doc = (row || {}) as Record<string, unknown>;

  return {
    id: asString(doc.id) || asString(doc._id) || asString(doc.name),
    name: asString(doc.name),
    quantity: asString(doc.quantity),
    calories: downNumber(doc.calories),
    protein: downNumber(doc.protein),
    carbs: downNumber(doc.carbs),
    fat: downNumber(doc.fat),
    useCount: downNumber(doc.useCount) ?? 0,
    lastUsedAt: downNumber(doc.lastUsedAt),
  };
}

/** 云端饮食列表 → 前端数组（非数组入参返回空数组） */
export function mapCloudDiets(rows: unknown): DietEntry[] {
  return mapRows(rows, fromCloudDiet, (v) => validateDietEntry(v).valid, 'diets');
}

/** 云端运动列表 → 前端数组 */
export function mapCloudWorkouts(rows: unknown): WorkoutEntry[] {
  return mapRows(rows, fromCloudWorkout, (v) => validateWorkoutEntry(v).valid, 'workouts');
}

/** 云端常用食物列表 → 前端数组 */
export function mapCloudFoods(rows: unknown): FavoriteFood[] {
  return mapRows(rows, fromCloudFood, (v) => validateFavoriteFood(v).valid, 'favorite_foods');
}

/** 云端学习计划列表 → 前端数组 */
export function mapCloudStudyPlans(rows: unknown): StudyPlan[] {
  return mapRows(rows, fromCloudStudyPlan, (v) => validateStudyPlan(v).valid, 'study_plans');
}

/** 云端学习打卡列表 → 前端数组 */
export function mapCloudStudyCheckins(rows: unknown): StudyCheckin[] {
  return mapRows(
    rows,
    fromCloudStudyCheckin,
    (v) => validateStudyCheckin(v).valid,
    'study_checkins',
  );
}

// ---------- M3：食谱 / 出行（下行） ----------

/**
 * 云端食谱记录 → 前端 `MealPlan`。
 *
 * 服务端 `toClientMeal` 已经把可空文本收敛成 `''`、`done` 收敛成布尔、
 * 非法餐次兜底为 `breakfast`；这里再做一次同口径收敛，是因为映射层也吃**裸库文档**：
 * 任何一处落 `null` 都会被 `validateMealPlan` 判非法 → `MealPlanRepository` 静默丢弃。
 */
export function fromCloudMeal(row: unknown): MealPlan {
  const doc = (row || {}) as Record<string, unknown>;

  return {
    id: asString(doc.id) || asString(doc.clientId) || asString(doc._id),
    date: asString(doc.date),
    slot: isMealType(doc.slot) ? doc.slot : 'breakfast',
    dishName: asString(doc.dishName),
    ingredients: asString(doc.ingredients),
    cook: asString(doc.cook),
    done: doc.done === true,
    note: asString(doc.note),
  };
}

/**
 * 云端出行计划 → 前端 `TravelPlan`。
 *
 * ⚠️ **`items` 一律置空**（这条是有意为之，不是漏写）：
 *    `listPlans` 返回的 `items` 只是首屏渲染的便捷聚合 —— 它「全家庭一次查、上限 500 条」，
 *    明细多的家庭会被截断（见 `travel/index.js` 的 `listPlans` 注释）。
 *    若在这里保留，同步层很容易把它当成「本地有、云端没有 ⇒ 判定被删」的依据，
 *    造成明细**凭空消失**。明细只有一条权威通路：`listItems(travelId)`。
 *    置空是刻意让「忘了拉明细」表现为「明细为空」这种显性错误，而不是静默删数据。
 */
export function fromCloudTravelPlan(row: unknown): TravelPlan {
  const doc = (row || {}) as Record<string, unknown>;

  return {
    id: asString(doc.id) || asString(doc.clientId) || asString(doc._id),
    title: asString(doc.title),
    startDate: asString(doc.startDate),
    endDate: asString(doc.endDate),
    destination: asString(doc.destination),
    members: normalizeTravelMembers(doc.members),
    budget: downNumber(doc.budget) ?? 0,
    status: isTravelStatus(doc.status) ? doc.status : 'planned',
    note: asString(doc.note),
    items: [],
  };
}

/**
 * 云端行程明细 → 前端 `TravelItem`。
 *
 * `order` 无论云端有没有都给一个**有限且 ≥ 0** 的数（缺省 0）：
 * `sortTravelItems` 对缺失 `order` 的老数据按数组下标参与排序，
 * 而云端返回顺序不保证稳定 —— 显式给值才能让两端顺序一致
 *（与云端 `toClientItem` 同口径；负数 / NaN 会被 `validateTravelItem` 判非法而丢记录，
 *  所以这里先收敛掉）。
 */
export function fromCloudTravelItem(row: unknown): TravelItem {
  const doc = (row || {}) as Record<string, unknown>;
  const order = downNumber(doc.order);

  return {
    id: asString(doc.id) || asString(doc.clientId) || asString(doc._id),
    order: order !== undefined && order >= 0 ? Math.floor(order) : 0,
    time: asString(doc.time),
    activity: asString(doc.activity),
    note: asString(doc.note),
    done: doc.done === true,
  };
}

/** 云端食谱列表 → 前端数组（按日期拉取的通路） */
export function mapCloudMealPlans(rows: unknown): MealPlan[] {
  return mapRows(rows, fromCloudMeal, (v) => validateMealPlan(v).valid, 'meal_plans');
}

/** 云端出行计划列表 → 前端数组（`items` 恒为空，见 `fromCloudTravelPlan`） */
export function mapCloudTravelPlans(rows: unknown): TravelPlan[] {
  return mapRows(rows, fromCloudTravelPlan, (v) => validateTravelPlan(v).valid, 'travels');
}

/** 云端行程明细列表 → 前端数组（`listItems(travelId)` 的权威通路） */
export function mapCloudTravelItems(rows: unknown): TravelItem[] {
  return mapRows(rows, fromCloudTravelItem, (v) => validateTravelItem(v).valid, 'travel_items');
}
