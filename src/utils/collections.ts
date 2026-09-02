export function groupByDate<T extends { date: string }>(
  entries: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const entry of entries) {
    const group = groups.get(entry.date) ?? [];
    group.push(entry);
    groups.set(entry.date, group);
  }

  return groups;
}
