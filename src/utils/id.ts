export function createId(prefix: string): string {
  const hasCryptoUuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
  const randomPart = hasCryptoUuid
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return `${prefix}-${randomPart}`;
}

