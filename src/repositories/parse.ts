export function parseStoredArray<T>(
  raw: string | null,
  isValid: (value: unknown) => boolean,
): T[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isValid) as T[];
  } catch {
    return [];
  }
}
