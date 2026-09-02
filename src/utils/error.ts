export function errorMessage(
  error: unknown,
  fallback = '请稍后重试',
): string {
  return error instanceof Error ? error.message : fallback;
}
