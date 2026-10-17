import { evaluateGrowthCurve, type GrowthCurveParams, type GrowthMode } from './growth-curve.ts';

// Derives a plant's current status from its latest plant_health_info row by
// advancing that row's curve position by the time elapsed since it was
// observed ("curve age"): x = resolved_x_position + days since observed_at.
// Every function here is best-effort and returns null instead of throwing.

/** The slice of a plant_health_info row this module reads. */
export type LatestObservation = {
  observed_at: string;
  resolved_x_position: number | null;
  estimated_health_score: number | null;
  growth_mode: GrowthMode | null;
  l: number | null;
  k: number | null;
  x0: number | null;
  xg: number | null;
  kg: number | null;
  ks?: number | null;
  xs?: number | null;
  f?: number | null;
  r?: number | null;
  cycle_length?: number | null;
  b_base?: number | null;
  l_season?: number | null;
};

export type PlantStatus = {
  leafAreaCm2: number;
  healthScore: number;
};

/**
 * PLACEHOLDER health score (0-100, same scale as estimated_health_score) used
 * when an observation has none, e.g. a baseline row seeded at add time before
 * any photo has been analyzed. Not a real measurement; replace once there is a
 * better default.
 */
export const DEFAULT_HEALTH_SCORE = 70;

const MS_PER_DAY = 86_400_000;

/** Fractional days from `from` to `to`; null if `from` isn't a valid date. */
export function daysElapsed(from: string, to: Date): number | null {
  const fromMs = new Date(from).getTime();
  const days = (to.getTime() - fromMs) / MS_PER_DAY;
  return Number.isFinite(days) ? days : null;
}

/** Growth-curve params from a plant_health_info row, or null if any required one is missing. */
export function paramsFromObservation(row: LatestObservation): GrowthCurveParams | null {
  if (!row.growth_mode || row.l == null || row.k == null || row.x0 == null || row.xg == null || row.kg == null) {
    return null;
  }

  return {
    growth_mode: row.growth_mode,
    l: row.l,
    k: row.k,
    x0: row.x0,
    xg: row.xg,
    kg: row.kg,
    ks: row.ks,
    xs: row.xs,
    f: row.f,
    r: row.r,
    cycle_length: row.cycle_length,
    b_base: row.b_base,
    l_season: row.l_season,
  };
}

/** The row's curve position advanced to `now`; null if the position or date is unusable. */
export function currentCurveX(resolvedXPosition: number | null, observedAt: string, now: Date): number | null {
  if (resolvedXPosition == null || !Number.isFinite(resolvedXPosition)) {
    return null;
  }
  const elapsed = daysElapsed(observedAt, now);
  return elapsed == null ? null : resolvedXPosition + Math.max(0, elapsed);
}

/**
 * What a previously fitted curve predicts the plant's fullness is at `now`, as
 * a percentage (evaluateGrowthCurve / l * 100, rounded to 0.1). Null if the
 * position or params are missing or the curve can't be evaluated.
 */
export function predictFullnessPct(
  params: GrowthCurveParams | null,
  resolvedXPosition: number | null,
  observedAt: string,
  now: Date
): number | null {
  try {
    if (!params) {
      return null;
    }
    const x = currentCurveX(resolvedXPosition, observedAt, now);
    if (x == null) {
      return null;
    }
    const pct = (evaluateGrowthCurve(params, x) / params.l) * 100;
    return Number.isFinite(pct) ? Math.round(pct * 10) / 10 : null;
  } catch {
    return null;
  }
}

/**
 * Current estimated leaf area and health for a plant, from its latest
 * plant_health_info row. Returns null if there is no observation or the row's
 * params or position are missing. Never throws.
 *
 * `plant` and `basicInfo` are accepted for call-site symmetry but unused: a
 * row's resolved_x_position is only meaningful against that same row's params,
 * so species params are deliberately not substituted.
 */
export function getPlantStatus(
  _plant: unknown,
  _basicInfo: unknown,
  latestObservation: LatestObservation | null | undefined,
  now: Date
): PlantStatus | null {
  try {
    if (!latestObservation) {
      return null;
    }
    const params = paramsFromObservation(latestObservation);
    if (!params) {
      return null;
    }
    const x = currentCurveX(latestObservation.resolved_x_position, latestObservation.observed_at, now);
    if (x == null) {
      return null;
    }
    const leafAreaCm2 = evaluateGrowthCurve(params, x);
    if (!Number.isFinite(leafAreaCm2)) {
      return null;
    }
    return { leafAreaCm2, healthScore: latestObservation.estimated_health_score ?? DEFAULT_HEALTH_SCORE };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Inline tests: deno run supabase/functions/_shared/plant-status.ts
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const check = (name: string, pass: boolean, detail: unknown) =>
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}: ${JSON.stringify(detail)}`);

  const now = new Date('2026-10-12T00:00:00Z');
  const observedAt = '2026-10-02T00:00:00Z'; // 10 days earlier
  const row: LatestObservation = {
    observed_at: observedAt,
    resolved_x_position: 100,
    estimated_health_score: 0.8,
    growth_mode: 'woody_residual',
    l: 1000,
    k: 0.05,
    x0: 120,
    xg: 45,
    kg: 0.2,
    xs: 200,
    r: 2,
  };
  const params = paramsFromObservation(row)!;

  const status = getPlantStatus(null, null, row, now);
  check('leaf area uses x = resolved_x_position + 10 days', status?.leafAreaCm2 === evaluateGrowthCurve(params, 110), status);
  check('health score comes from the row', status?.healthScore === 0.8, status?.healthScore);
  check('no observation -> null', getPlantStatus(null, null, null, now) === null, null);
  const noScore = getPlantStatus(null, null, { ...row, estimated_health_score: null }, now);
  check('missing health score -> DEFAULT_HEALTH_SCORE', noScore?.healthScore === DEFAULT_HEALTH_SCORE, noScore);
  check('missing params -> null', getPlantStatus(null, null, { ...row, l: null }, now) === null, null);
  check('missing position -> null', getPlantStatus(null, null, { ...row, resolved_x_position: null }, now) === null, null);
  check('missing mode param -> null, no throw', getPlantStatus(null, null, { ...row, xs: null }, now) === null, null);
  check('bad observed_at -> null', getPlantStatus(null, null, { ...row, observed_at: 'nope' }, now) === null, null);

  const expectedPct = Math.round((evaluateGrowthCurve(params, 110) / params.l) * 1000) / 10;
  check('predictFullnessPct matches the curve', predictFullnessPct(params, 100, observedAt, now) === expectedPct, expectedPct);
  check('predictFullnessPct null without position', predictFullnessPct(params, null, observedAt, now) === null, null);
  check('predictFullnessPct null without params', predictFullnessPct(null, 100, observedAt, now) === null, null);
}
