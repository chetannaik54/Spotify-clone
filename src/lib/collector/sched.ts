export type SyncEvery = 'off' | 'daily' | 'weekly';
const MS: Record<Exclude<SyncEvery, 'off'>, number> = { daily: 24 * 3600_000, weekly: 7 * 24 * 3600_000 };
/** Is an automatic sync due? Never for "off"; due when there is no previous success or the interval has elapsed. */
export function isSyncDue(every: SyncEvery, lastSyncedAt: number | null | undefined, now = Date.now()): boolean {
  if (every === 'off') return false; return !lastSyncedAt || now - lastSyncedAt >= MS[every];
}
