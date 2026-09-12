const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());

  return `${year}-${month}-${day}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function parseDateKey(value: string): Date | null {
  if (!DATE_KEY_PATTERN.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function isValidDateKey(value: string): boolean {
  return parseDateKey(value) !== null;
}

export function formatDateKey(value: string): string {
  const date = parseDateKey(value);
  if (!date) {
    return value;
  }

  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = weekdays[date.getDay()];

  return `${month}月${day}日 周${weekday}`;
}

/**
 * 「ISO 字符串 或 毫秒时间戳」→ 毫秒时间戳。
 *
 * 用途：云端统一用毫秒时间戳存 `createdAt`，而前端模型用 ISO 字符串
 * （典型是 `StudyPlan.createdAt`），映射层两个方向都要换算。
 * 这里做成**双向容错**的一对，读取时即使拿到的已经是 ISO 字符串也能处理，
 * 不必在调用处判类型。
 *
 * @returns 毫秒；无法解析时返回 `null`
 */
export function toMillis(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || !value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 「ISO 字符串 或 毫秒时间戳」→ ISO 字符串。
 *
 * ⚠️ 解析失败时返回**空串**，而不是抛错、也不是硬凑一个值。理由：
 * 空串会被 `validateStudyPlan` 以「创建时间不合法」明确拦下，属于**显式丢弃**；
 * 若返回一个看着像日期、实际错误的字符串，计划会通过校验，
 * 但按 `createdAt` 排序时会**静默错序** —— 那才是真正难查的问题。
 */
export function toIsoString(value: unknown): string {
  const ms = toMillis(value);
  if (ms === null) {
    return '';
  }
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

