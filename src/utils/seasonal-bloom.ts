// Clamped raised-cosine bloom season. 1 at the peak day, 0 at the season
// edges (with a flat landing), and 0 through winter. Multiplies pollen output.

const YEAR_DAYS = 365;
/** Mid-May. */
const BLOOM_PEAK_DAY = 135;
/** March 1. */
const BLOOM_START_DAY = 60;
/** December 1. */
const BLOOM_END_DAY = 335;

const PEAK = BLOOM_PEAK_DAY / YEAR_DAYS;
const H_SPRING = (BLOOM_PEAK_DAY - BLOOM_START_DAY) / YEAR_DAYS;
const H_FALL = (BLOOM_END_DAY - BLOOM_PEAK_DAY) / YEAR_DAYS;

function raisedCosine(offset: number, halfWidth: number) {
  const y = (1 + Math.cos((Math.PI * offset) / halfWidth)) / 2;
  if (y <= 0) return 0;
  if (y >= 1) return 1;
  return y;
}

/** Day of year in UTC, 1–366. */
export function utcDayOfYear(now: Date) {
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (today - start) / 86_400_000 + 1;
}

/**
 * Pollen multiplier for a day of the year (1 = Jan 1). Peaks at 1 on day 135,
 * reaches 0 on day 60 and day 335, and stays 0 outside that window.
 */
export function seasonalBloomMultiplierForDay(dayOfYear: number) {
  if (!Number.isFinite(dayOfYear)) {
    return 0;
  }
  const x = dayOfYear / YEAR_DAYS;
  if (x >= PEAK - H_SPRING && x <= PEAK) {
    return raisedCosine(x - PEAK, H_SPRING);
  }
  if (x > PEAK && x <= PEAK + H_FALL) {
    return raisedCosine(x - PEAK, H_FALL);
  }
  return 0;
}

export function seasonalBloomMultiplier(now: Date) {
  return seasonalBloomMultiplierForDay(utcDayOfYear(now));
}
