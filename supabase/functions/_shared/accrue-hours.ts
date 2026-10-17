/** A user who has not been accrued for longer than this is credited for at most this many hours. */
export const MAX_CATCHUP_HOURS = 24;

const MS_PER_HOUR = 3_600_000;

/**
 * Hours to credit since `lastAccruedAt`, capped at MAX_CATCHUP_HOURS. Returns 0
 * for a zero or negative gap and NaN if the timestamp is unparseable.
 */
export function hoursToCredit(lastAccruedAt: string, now: Date): number {
  const lastMs = new Date(lastAccruedAt).getTime();
  if (!Number.isFinite(lastMs)) {
    return NaN;
  }
  const hours = (now.getTime() - lastMs) / MS_PER_HOUR;
  return Math.min(MAX_CATCHUP_HOURS, Math.max(0, hours));
}

/**
 * Hours to credit one plant: the user's hours, limited to the time since the
 * plant's created_at so a plant is never paid for time before it existed.
 * Returns 0 if created_at is unparseable.
 */
export function plantHoursToCredit(userHours: number, createdAt: string, now: Date): number {
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs) || !Number.isFinite(userHours)) {
    return 0;
  }
  const sinceCreated = (now.getTime() - createdMs) / MS_PER_HOUR;
  return Math.max(0, Math.min(userHours, sinceCreated));
}

// ---------------------------------------------------------------------------
// Inline tests: deno run supabase/functions/_shared/accrue-hours.ts
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const check = (name: string, actual: number, expected: number) => {
    const pass = Object.is(actual, expected) || (Number.isNaN(actual) && Number.isNaN(expected));
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}: got ${actual}, expected ${expected}`);
  };

  const now = new Date('2026-10-17T12:00:00Z');
  check('1 hour gap', hoursToCredit('2026-10-17T11:00:00Z', now), 1);
  check('90 minute gap -> 1.5', hoursToCredit('2026-10-17T10:30:00Z', now), 1.5);
  check('exactly the cap', hoursToCredit('2026-10-16T12:00:00Z', now), MAX_CATCHUP_HOURS);
  check('30 hour gap is capped', hoursToCredit('2026-10-16T06:00:00Z', now), MAX_CATCHUP_HOURS);
  check('very old timestamp is capped', hoursToCredit('2020-01-01T00:00:00Z', now), MAX_CATCHUP_HOURS);
  check('zero gap -> 0', hoursToCredit('2026-10-17T12:00:00Z', now), 0);
  check('future timestamp (negative gap) -> 0', hoursToCredit('2026-10-17T13:00:00Z', now), 0);
  check('unparseable timestamp -> NaN', hoursToCredit('nope', now), NaN);

  // Per-plant limit: min(user hours, hours since created_at).
  check('plant older than the window gets the full user hours', plantHoursToCredit(5, '2026-10-01T00:00:00Z', now), 5);
  check('plant created 2h ago, user hours 5 -> 2', plantHoursToCredit(5, '2026-10-17T10:00:00Z', now), 2);
  check('plant created 30 min ago -> 0.5', plantHoursToCredit(24, '2026-10-17T11:30:00Z', now), 0.5);
  check('plant created in the future -> 0', plantHoursToCredit(5, '2026-10-17T13:00:00Z', now), 0);
  check('plant created exactly now -> 0', plantHoursToCredit(5, '2026-10-17T12:00:00Z', now), 0);
  check('unparseable created_at -> 0', plantHoursToCredit(5, 'nope', now), 0);
}
