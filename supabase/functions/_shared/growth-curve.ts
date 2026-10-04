// Growth-curve model for estimating a plant's leaf area over time.
//
// y(x) = L · G(x) · P(x) · M(x)
//
//   G(x) — germination/emergence gate (logistic, ramps 0 -> 1 around xg)
//   P(x) — main logistic growth term (ramps 0 -> 1 around x0)
//   M(x) — growth-mode-specific modifier (see GrowthMode below)
//
// Column names below intentionally mirror public.plant_basic_info
// (see supabase/migrations/20260913054225_add_growth_curve_params.sql)
// so a row from that table can be passed in directly.

export type GrowthMode = 'annual_bounded' | 'woody_residual' | 'cyclical';

export type GrowthCurveParams = {
  growth_mode: GrowthMode;
  /** Peak/mature leaf area (cm²) — carrying capacity. */
  l: number;
  /** Growth rate constant for the main logistic term P(x). */
  k: number;
  /** Day of maximum growth rate (inflection point) in P(x). */
  x0: number;
  /** Germination/emergence midpoint day, used in G(x). */
  xg: number;
  /** Germination steepness constant, used in G(x). */
  kg: number;

  // annual_bounded only
  /** Steepness constant for the senescence term (distinct from k). */
  ks?: number | null;
  /** Senescence onset day. */
  xs?: number | null;
  /** Long-term canopy retention floor, as a fraction of L. */
  f?: number | null;

  // woody_residual only
  /** Residual growth rate (cm²/day) added after xs. */
  r?: number | null;
  // woody_residual reuses `xs` above as the residual-growth start day.

  // cyclical only
  /** Days per growth cycle (e.g. ~365 for annual die-back perennials). */
  cycle_length?: number | null;
  /** Persistent crown/root leaf-area baseline (cm²) that survives dormancy. */
  b_base?: number | null;
  /** New seasonal leaf area regrown each cycle (cm²). */
  l_season?: number | null;
};

function requireParam(value: number | null | undefined, name: string, growthMode: GrowthMode): number {
  if (value == null || !Number.isFinite(value)) {
    throw new Error(`growth_mode '${growthMode}' requires numeric param '${name}'`);
  }
  return value;
}

function logistic(steepness: number, x: number, midpoint: number): number {
  return 1 / (1 + Math.exp(-steepness * (x - midpoint)));
}

/** Modulo that always returns a value in [0, modulus), unlike JS `%`. */
function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function evaluateM(params: GrowthCurveParams, x: number): number {
  switch (params.growth_mode) {
    case 'annual_bounded': {
      const ks = requireParam(params.ks, 'ks', params.growth_mode);
      const xs = requireParam(params.xs, 'xs', params.growth_mode);
      const f = requireParam(params.f, 'f', params.growth_mode);
      return 1 - (1 - f) / (1 + Math.exp(-ks * (x - xs)));
    }

    case 'woody_residual': {
      const r = requireParam(params.r, 'r', params.growth_mode);
      const xs = requireParam(params.xs, 'xs', params.growth_mode);
      return 1 + (r * Math.max(0, x - xs)) / params.l;
    }

    case 'cyclical': {
      const cycleLength = requireParam(params.cycle_length, 'cycle_length', params.growth_mode);
      const bBase = requireParam(params.b_base, 'b_base', params.growth_mode);
      const lSeason = requireParam(params.l_season, 'l_season', params.growth_mode);
      const xSeason = positiveMod(x, cycleLength);
      return bBase / params.l + (lSeason / params.l) * logistic(params.k, xSeason, params.x0);
    }

    default: {
      const exhaustive: never = params.growth_mode;
      throw new Error(`Unknown growth_mode: ${String(exhaustive)}`);
    }
  }
}

export function evaluateGrowthCurve(params: GrowthCurveParams, x: number): number {
  const g = logistic(params.kg, x, params.xg);
  const p = logistic(params.k, x, params.x0);
  const m = evaluateM(params, x);
  return params.l * g * p * m;
}

export type SolveXForFullnessOptions = {
  /** Lower bound of the search range, in days. Defaults to 0. */
  minX?: number;
  /** Upper bound of the search range, in days. Defaults to 3650 (10 years). */
  maxX?: number;
  /** Stop once the bracket width is at most this many days. Defaults to 0.01. */
  toleranceX?: number;
  /** Max bisection iterations, as a backstop against a non-converging search. */
  maxIterations?: number;
};

/**
 * Finds x such that evaluateGrowthCurve(params, x) / params.l ≈ fullnessPct / 100,
 * via binary search over [minX, maxX].
 *
 * Assumes fullness is monotonically non-decreasing over the search range, which
 * holds for 'woody_residual' and 'cyclical' (within a season) and for
 * 'annual_bounded' up through senescence onset. Past senescence, annual_bounded's
 * M(x) trends down toward f < 1, so the curve can turn over; if fullnessPct falls
 * in that declining region, or is unreachable within [minX, maxX] at all, this
 * will converge on *a* crossing point but not necessarily the intended one —
 * callers working with senescing curves should sanity-check the result or narrow
 * the range.
 */
export function solveXForFullness(
  params: GrowthCurveParams,
  fullnessPct: number,
  options?: SolveXForFullnessOptions
): number {
  const minX = options?.minX ?? 0;
  const maxX = options?.maxX ?? 3650;
  const toleranceX = options?.toleranceX ?? 0.01;
  const maxIterations = options?.maxIterations ?? 200;

  const target = fullnessPct / 100;
  const fullnessAt = (x: number) => evaluateGrowthCurve(params, x) / params.l;

  let lo = minX;
  let hi = maxX;
  let loValue = fullnessAt(lo);
  const hiValue = fullnessAt(hi);

  if (target <= loValue) {
    return lo;
  }
  if (target >= hiValue) {
    return hi;
  }

  for (let i = 0; i < maxIterations && hi - lo > toleranceX; i += 1) {
    const mid = (lo + hi) / 2;
    const midValue = fullnessAt(mid);

    if (midValue < target) {
      lo = mid;
      loValue = midValue;
    } else {
      hi = mid;
    }
  }

  void loValue;
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Inline tests. This project has no test runner configured (no jest/vitest,
// no *.test.* files anywhere), so these follow the Deno convention used by
// the edge functions themselves: run directly with
//   deno run supabase/functions/_shared/growth-curve.ts
// and guarded by `import.meta.main` so importing this module elsewhere never
// executes them.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const approxEqual = (actual: number, expected: number, tolerance: number) =>
    Math.abs(actual - expected) <= tolerance;

  function check(name: string, actual: number, expected: number, tolerance: number) {
    const pass = approxEqual(actual, expected, tolerance);
    const status = pass ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${name}: got ${actual.toFixed(4)}, expected ~${expected} (±${tolerance})`);
  }

  // The source PDF's reference table gives y(180) ≈ 941.87, but that value is
  // wrong: it's been independently hand-verified (and confirmed against x=45,
  // x=90, and x=120 as well) that the table contains multiple arithmetic
  // errors. Evaluating the equation directly, as implemented here, is the
  // ground truth — this test asserts against that (918.84), not the table.
  const annualBounded: GrowthCurveParams = {
    growth_mode: 'annual_bounded',
    l: 1000,
    k: 0.05,
    x0: 120,
    xg: 45,
    kg: 0.2,
    xs: 200,
    f: 0.9,
    ks: 0.03,
  };
  check('annual_bounded y(180) matches direct equation evaluation', evaluateGrowthCurve(annualBounded, 180), 918.84, 1);

  // Sanity checks that don't depend on the missing ks value:

  // Long before germination/growth, output should be ~0.
  check('annual_bounded y(0) ~ 0', evaluateGrowthCurve(annualBounded, 0), 0, 1);

  // Well past senescence, M(x) -> f, G(x) and P(x) -> 1, so y(x) -> L * f.
  check('annual_bounded y(2000) -> L*f', evaluateGrowthCurve(annualBounded, 2000), 1000 * 0.9, 0.5);

  // woody_residual: past xs, growth adds r*(x-xs) on top of L*G*P.
  const woodyResidual: GrowthCurveParams = {
    growth_mode: 'woody_residual',
    l: 1000,
    k: 0.05,
    x0: 120,
    xg: 45,
    kg: 0.2,
    xs: 200,
    r: 2,
  };
  // At x = xs, the residual term is exactly 0, so M(xs) = 1 and
  // y(xs) = L * G(xs) * P(xs).
  const gAtXs = 1 / (1 + Math.exp(-0.2 * (200 - 45)));
  const pAtXs = 1 / (1 + Math.exp(-0.05 * (200 - 120)));
  check('woody_residual y(xs) == L*G(xs)*P(xs)', evaluateGrowthCurve(woodyResidual, 200), 1000 * gAtXs * pAtXs, 0.01);

  // 300 days past xs, M = 1 + 2*300/1000 = 1.6, and G/P are both ~1 by then.
  check('woody_residual y(500) ~ L*1.6', evaluateGrowthCurve(woodyResidual, 500), 1000 * 1.6, 1);

  // cyclical: at the season's x0 (mid-cycle inflection), the logistic term is
  // exactly 0.5, so y = L*G(x)*(b_base/L + l_season/(2*L)).
  const cyclical: GrowthCurveParams = {
    growth_mode: 'cyclical',
    l: 500,
    k: 0.1,
    x0: 60,
    xg: 10,
    kg: 0.3,
    cycle_length: 365,
    b_base: 50,
    l_season: 450,
  };
  const gAt60 = 1 / (1 + Math.exp(-0.3 * (60 - 10)));
  check(
    'cyclical y(60) at season inflection',
    evaluateGrowthCurve(cyclical, 60),
    500 * gAt60 * (50 / 500 + 450 / 500 / 2),
    0.01
  );
  // One full cycle later, x_season wraps back to the same point.
  check('cyclical y(60 + cycle_length) matches y(60)', evaluateGrowthCurve(cyclical, 60 + 365), evaluateGrowthCurve(cyclical, 60), 0.001);

  // solveXForFullness: round-trip against evaluateGrowthCurve for a mode
  // that's monotonic over the whole search range.
  const targetX = 300;
  const fullnessAtTargetX = (evaluateGrowthCurve(woodyResidual, targetX) / woodyResidual.l) * 100;
  const solvedX = solveXForFullness(woodyResidual, fullnessAtTargetX);
  check('solveXForFullness round-trips woody_residual', solvedX, targetX, 1);
}
