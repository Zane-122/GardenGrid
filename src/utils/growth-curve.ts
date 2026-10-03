// Client-side mirror of supabase/functions/_shared/growth-curve.ts — kept in
// sync with equation.md. Only the curve evaluation is needed here (no
// solving), for rendering the growth chart on a plant's page.

export type GrowthMode = 'annual_bounded' | 'woody_residual' | 'cyclical';

export type GrowthCurveParams = {
  growth_mode: GrowthMode;
  l: number;
  k: number;
  x0: number;
  xg: number;
  kg: number;

  // annual_bounded only
  ks?: number | null;
  xs?: number | null;
  f?: number | null;

  // woody_residual only
  r?: number | null;
  // woody_residual reuses `xs` above as the residual-growth start day.

  // cyclical only
  cycle_length?: number | null;
  b_base?: number | null;
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
