const windows = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 60_000;
const MAX_WRITES_PER_WINDOW = 60;

export function rateLimitWrite(actorKey: string): boolean {
  const now = Date.now();
  const row = windows.get(actorKey);
  if (!row || row.resetAt <= now) {
    windows.set(actorKey, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (row.count >= MAX_WRITES_PER_WINDOW) return false;
  row.count += 1;
  return true;
}