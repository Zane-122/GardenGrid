// Oxygen-output model for estimating how much O2 a plant produces per hour.
//
// oxygenMl = leafAreaCm2 · lightFactor · healthMultiplier · PC_ML_PER_MIN_PER_CM2 · 60

/**
 * ESTIMATE TO TUNE. Milliliters of oxygen per minute per cm² of leaf at full
 * light and perfect health, averaged over a whole day. Derived from about
 * 12 g O2 per m² per day, at 25 °C and 1 atm where 1 mole of gas is 24.45 L.
 */
export const PC_ML_PER_MIN_PER_CM2 = 6.4e-4;

/** ESTIMATE TO TUNE. Health (0-100) at or below this value counts as 0 output. */
export const HEALTH_FLOOR = 30;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Oxygen produced in one hour, in MILLILITERS (mL). Not rounded.
 *
 * @param leafAreaCm2 Leaf area in cm².
 * @param healthScore Plant health, 0-100. At or below HEALTH_FLOOR counts as 0.
 * @param lightFactor Light level, clamped to 0-1 (1 = full light).
 * @returns oxygenMl — mL of oxygen for one hour.
 *
 * Never throws: returns 0 if any input is not a finite number, or if the
 * leaf area is zero or negative.
 */
export function calculateHourlyOxygen(leafAreaCm2: number, healthScore: number, lightFactor: number): number {
  if (!Number.isFinite(leafAreaCm2) || !Number.isFinite(healthScore) || !Number.isFinite(lightFactor)) {
    return 0;
  }

  const area = Math.max(0, leafAreaCm2);
  const light = clamp01(lightFactor);
  const healthMultiplier = clamp01((healthScore - HEALTH_FLOOR) / (100 - HEALTH_FLOOR));
  const oxygenMl = area * light * healthMultiplier * PC_ML_PER_MIN_PER_CM2 * 60;
  return Number.isFinite(oxygenMl) ? oxygenMl : 0;
}

// ---------------------------------------------------------------------------
// Inline tests, same convention as growth-curve.ts: run directly with
//   deno run supabase/functions/_shared/oxygen-calc.ts
// and guarded by `import.meta.main` so importing this module never runs them.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  function check(name: string, actual: number, expected: number, tolerance: number) {
    const pass = Math.abs(actual - expected) <= tolerance;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}: got ${actual.toFixed(4)}, expected ~${expected} (±${tolerance})`);
  }

  // Normal case: 3570 * (65/70) * 6.4e-4 * 60 ≈ 127.3 mL.
  check('normal case 3570 cm2, health 95, light 1 ~ 127 mL', calculateHourlyOxygen(3570, 95, 1), 127, 0.5);

  // Health at and below the floor counts as 0.
  check('health at floor (30) -> 0', calculateHourlyOxygen(3570, 30, 1), 0, 0);
  check('health below floor (10) -> 0', calculateHourlyOxygen(3570, 10, 1), 0, 0);
  check('negative health -> 0', calculateHourlyOxygen(3570, -50, 1), 0, 0);

  // Health 100 -> multiplier 1: 3570 * 6.4e-4 * 60 = 137.088 mL.
  check('health 100 -> multiplier 1', calculateHourlyOxygen(3570, 100, 1), 3570 * PC_ML_PER_MIN_PER_CM2 * 60, 1e-9);
  check('health above 100 is clamped to 100', calculateHourlyOxygen(3570, 150, 1), calculateHourlyOxygen(3570, 100, 1), 0);

  // lightFactor is clamped to 0-1.
  check('lightFactor 0 -> 0', calculateHourlyOxygen(3570, 95, 0), 0, 0);
  check('lightFactor above 1 is clamped to 1', calculateHourlyOxygen(3570, 95, 5), calculateHourlyOxygen(3570, 95, 1), 0);
  check('negative lightFactor -> 0', calculateHourlyOxygen(3570, 95, -1), 0, 0);

  // Zero or negative leaf area.
  check('leaf area 0 -> 0', calculateHourlyOxygen(0, 95, 1), 0, 0);
  check('negative leaf area -> 0', calculateHourlyOxygen(-100, 95, 1), 0, 0);

  // Non-finite inputs return 0 instead of throwing.
  check('NaN leaf area -> 0', calculateHourlyOxygen(NaN, 95, 1), 0, 0);
  check('NaN health -> 0', calculateHourlyOxygen(3570, NaN, 1), 0, 0);
  check('NaN lightFactor -> 0', calculateHourlyOxygen(3570, 95, NaN), 0, 0);
  check('Infinity leaf area -> 0', calculateHourlyOxygen(Infinity, 95, 1), 0, 0);
}
