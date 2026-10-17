// "Photo freshness" multiplier for oxygen and pollen production: output is
// full while a plant's photo is recent, then declines linearly to a floor.

/** Days after the last photo during which production is unaffected. */
export const FRESH_DAYS = 7;

/** Days over which the multiplier falls from 1 to MIN_FRESHNESS once FRESH_DAYS has passed. */
export const DECLINE_DAYS = 7;

/** Lowest multiplier; production never drops below this fraction. */
export const MIN_FRESHNESS = 0.25;

const MS_PER_DAY = 86_400_000;

/**
 * Production multiplier (MIN_FRESHNESS-1) for a plant whose last photo was
 * taken at `lastPhotoDate`. Returns 1 if the date is missing, unparseable, or
 * in the future. Never throws.
 */
export function photoFreshnessMultiplier(lastPhotoDate: string | Date | null | undefined, now: Date): number {
  if (lastPhotoDate == null) {
    return 1;
  }
  const daysSince = (now.getTime() - new Date(lastPhotoDate).getTime()) / MS_PER_DAY;
  if (!Number.isFinite(daysSince) || daysSince < 0) {
    return 1;
  }
  if (daysSince <= FRESH_DAYS) {
    return 1;
  }
  const declined = Math.min(1, (daysSince - FRESH_DAYS) / DECLINE_DAYS);
  return 1 - declined * (1 - MIN_FRESHNESS);
}

/**
 * Multiplier from a plant's most recent real photo observation (a
 * plant_health_info row with a non-null estimated_fullness_pct; baseline rows
 * don't count), falling back to the plant's created_at if it has none.
 */
export function plantPhotoFreshness(lastPhotoObservedAt: string | null | undefined, createdAt: string, now: Date): number {
  return photoFreshnessMultiplier(lastPhotoObservedAt ?? createdAt, now);
}

// ---------------------------------------------------------------------------
// Inline tests: deno run supabase/functions/_shared/observation-freshness.ts
// ---------------------------------------------------------------------------

if (import.meta.main) {
  let failed = 0;
  const check = (name: string, actual: number, expected: number) => {
    const pass = Math.abs(actual - expected) <= 1e-9;
    if (!pass) failed += 1;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}: got ${actual}, expected ${expected}`);
  };

  const now = new Date('2026-10-20T00:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * MS_PER_DAY);

  check('day 0', photoFreshnessMultiplier(daysAgo(0), now), 1);
  check('exactly 7 days', photoFreshnessMultiplier(daysAgo(7), now), 1);
  check('10.5 days (halfway down)', photoFreshnessMultiplier(daysAgo(10.5), now), 0.625);
  check('14 days', photoFreshnessMultiplier(daysAgo(14), now), MIN_FRESHNESS);
  check('30 days', photoFreshnessMultiplier(daysAgo(30), now), MIN_FRESHNESS);
  check('future date', photoFreshnessMultiplier(daysAgo(-3), now), 1);
  check('invalid date string', photoFreshnessMultiplier('not a date', now), 1);
  check('null date', photoFreshnessMultiplier(null, now), 1);
  check('ISO string input', photoFreshnessMultiplier(daysAgo(10.5).toISOString(), now), 0.625);
  check('no photo -> created_at (14d old)', plantPhotoFreshness(null, daysAgo(14).toISOString(), now), MIN_FRESHNESS);
  check('photo wins over created_at', plantPhotoFreshness(daysAgo(1).toISOString(), daysAgo(40).toISOString(), now), 1);

  if (failed > 0) {
    console.error(`${failed} test(s) failed`);
    Deno.exit(1);
  }
}
