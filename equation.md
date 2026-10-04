# Growth Curve Equation Reference

## Base equation (applies to every plant, regardless of type)

y(x) = L * G(x) * P(x) * M(x)

Where:
- x = days (the input axis for graphing; x=0 is the curve's reference point)
- y(x) = leaf area in cm² (the output axis for graphing)
- L = peak/mature leaf area in cm² (the curve's asymptotic ceiling)

## Always-present terms

G(x) = 1 / (1 + e^(-kg * (x - xg)))
  Germination gate — near 0 before emergence, rises to 1 after.
  Params: xg (germination midpoint day), kg (germination steepness)

P(x) = 1 / (1 + e^(-k * (x - x0)))
  Main logistic growth curve — the primary growth ramp.
  Params: x0 (day of steepest growth), k (growth rate constant)

## M(x) — three variants, selected by growth_mode

### annual_bounded
(annuals, determinate vegetables, most houseplants — growth plateaus and holds)

M(x) = 1 - ((1 - f) / (1 + e^(-ks * (x - xs))))

Params: xs (day canopy stabilization begins), ks (senescence steepness),
f (long-term retention floor, fraction of L, e.g. 0.85 = settles at 85% of L)

### woody_residual
(trees, shrubs, woody perennials — growth never fully stops, just slows)

M(x) = 1 + ((r * max(0, x - xs)) / L)

Params: xs (day residual growth phase begins), r (residual growth rate, cm²/day)

### cyclical
(die-back perennials — mint, chives, perennial flowers — regrows each season)

x_season = x mod cycle_length
M(x) = (b_base / L) + ((l_season / L) * (1 / (1 + e^(-k * (x_season - x0)))))

Params: cycle_length (days per cycle), b_base (persistent crown/root baseline, cm²),
l_season (new seasonal leaf area regrown each cycle, cm²)

Note: cyclical mode reuses the main growth curve's k and x0 for the within-season
shape, applied to x_season instead of raw x — it does not use xs, ks, f, or r.

## Full parameter list (nulls expected per mode — see growth_mode above)

growth_mode, l, k, x0, xg, kg, xs, ks, f, r, cycle_length, b_base, l_season,
carbon_fraction (not used in the curve itself — only in CO2/O2 conversion)

## JS/TS reference implementation (matches growth-curve.ts)

function evaluateGrowthCurve(params, x) {
  const G = 1 / (1 + Math.exp(-params.kg * (x - params.xg)));
  const P = 1 / (1 + Math.exp(-params.k * (x - params.x0)));

  let M;
  if (params.growth_mode === 'annual_bounded') {
    M = 1 - ((1 - params.f) / (1 + Math.exp(-params.ks * (x - params.xs))));
  } else if (params.growth_mode === 'woody_residual') {
    M = 1 + ((params.r * Math.max(0, x - params.xs)) / params.l);
  } else if (params.growth_mode === 'cyclical') {
    const xSeason = ((x % params.cycle_length) + params.cycle_length) % params.cycle_length;
    const Pseason = 1 / (1 + Math.exp(-params.k * (xSeason - params.x0)));
    M = (params.b_base / params.l) + ((params.l_season / params.l) * Pseason);
  }

  return params.l * G * P * M;
}