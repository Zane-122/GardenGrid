import type { GrowthCurveParams, GrowthMode } from './growth-curve.ts';
import { lowercaseKeys } from './json-utils.ts';

// Generates growth-curve parameters (see growth-curve.ts) for a species by
// asking Gemini, then validates/clamps the response against known-sane
// bounds. Best-effort only: every failure path (missing key, network error,
// bad JSON, a field out of range) returns null rather than throwing, so a
// misbehaving LLM call can never break the plant-saving flow that calls it.

export type GeneratedGrowthParams = GrowthCurveParams & {
  carbon_fraction: number;
  confidence: number;
};

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Not specified by the request — defaulting to a current, fast Gemini model.
// Override with the GEMINI_MODEL secret if a different one is wanted.
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

const VALID_GROWTH_MODES: GrowthMode[] = ['annual_bounded', 'woody_residual', 'cyclical'];

function buildPrompt(scientificName: string | null, commonName: string | null): string {
  const species = scientificName?.trim() || 'Unknown';
  const common = commonName?.trim() || 'Unknown';

  return `Species: ${species}
Common name: ${common}

Classify this species into exactly one growth_mode:
- "annual_bounded": annuals, determinate vegetables, most houseplants that reach a stable mature size and hold there
- "woody_residual": trees, shrubs, woody perennials that keep slowly growing indefinitely after initial maturity
- "cyclical": herbaceous perennials that die back and regrow each season (mint, chives, perennial flowers)

Then estimate these parameters for typical garden/houseplant growing conditions:

Always required:
- L: mature/peak leaf area in cm²
- x0: day of maximum growth rate
- k: growth rate constant (typically 0.02-0.3)
- xg: typical germination/emergence day from seed
- kg: germination steepness constant (typically 0.1-0.3)
- carbon_fraction: fraction of dry biomass that is carbon (typically 0.40-0.55)

Required if growth_mode is "annual_bounded":
- xs: day canopy stabilization begins
- ks: senescence steepness constant
- f: long-term retention floor as fraction of L (typically 0.7-0.95)

Required if growth_mode is "woody_residual":
- xs: day residual growth phase begins
- r: residual growth rate in cm²/day after xs

Required if growth_mode is "cyclical":
- cycle_length: days per growth cycle (typically 365)
- b_base: persistent crown/root leaf-equivalent baseline in cm²
- l_season: new seasonal leaf area regrown each cycle in cm²

Also return confidence: a number 0-1 reflecting how well-documented this species' growth pattern is.

Return only valid JSON with only the fields relevant to your chosen growth_mode populated.`;
}

async function callGemini(apiKey: string, prompt: string): Promise<unknown | null> {
  const model = Deno.env.get('GEMINI_MODEL')?.trim() || DEFAULT_GEMINI_MODEL;
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    console.error(`Gemini request failed (${response.status}): ${await response.text().catch(() => '')}`);
    return null;
  }

  const payload = await response.json().catch(() => null);
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    console.error('Gemini response did not contain text content');
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? lowercaseKeys(parsed) : parsed;
  } catch (error) {
    console.error('Gemini response was not valid JSON:', error, text);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validation
//
// Two kinds of fields:
//  - hard/required: missing, non-finite, or outside [min, max] => whole
//    result is rejected (returns null).
//  - soft: clamped into [min, max], with a sane default when missing.
// ---------------------------------------------------------------------------

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Hard field: null (reject) if missing, non-finite, or outside [min, max]. */
function requireInRange(value: unknown, min: number, max: number): number | null {
  const num = asFiniteNumber(value);
  if (num == null || num < min || num > max) {
    return null;
  }
  return num;
}

/** Soft field: clamps into [min, max], falling back to defaultValue when missing/invalid. */
function clampOrDefault(value: unknown, min: number, max: number, defaultValue: number): number {
  const num = asFiniteNumber(value);
  if (num == null) {
    return defaultValue;
  }
  return Math.min(max, Math.max(min, num));
}

export function validateGrowthParams(raw: unknown): GeneratedGrowthParams | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;

  const growthMode = typeof record.growth_mode === 'string' ? record.growth_mode : null;
  if (!growthMode || !VALID_GROWTH_MODES.includes(growthMode as GrowthMode)) {
    return null;
  }

  const l = requireInRange(record.l, 1, 5000000);
  const k = requireInRange(record.k, 0.001, 1.0);
  const x0 = requireInRange(record.x0, 1, 3650);
  const xg = requireInRange(record.xg, 0, 365);
  const kg = requireInRange(record.kg, 0.001, 1.0);
  if (l == null || k == null || x0 == null || xg == null || kg == null) {
    return null;
  }

  const carbonFraction = clampOrDefault(record.carbon_fraction, 0.35, 0.55, 0.45);
  const confidence = clampOrDefault(record.confidence, 0, 1, 0.5);

  const base = { growth_mode: growthMode as GrowthMode, l, k, x0, xg, kg, carbon_fraction: carbonFraction, confidence };

  switch (base.growth_mode) {
    case 'annual_bounded': {
      const xs = requireInRange(record.xs, 1, 3650);
      const ks = requireInRange(record.ks, 0.001, 1.0);
      if (xs == null || ks == null) {
        return null;
      }
      const f = clampOrDefault(record.f, 0.5, 0.99, 0.85);
      return { ...base, xs, ks, f };
    }

    case 'woody_residual': {
      const xs = requireInRange(record.xs, 1, 3650);
      const r = requireInRange(record.r, 0.001, 1000);
      if (xs == null || r == null) {
        return null;
      }
      return { ...base, xs, r };
    }

    case 'cyclical': {
      const cycleLength = requireInRange(record.cycle_length, 30, 730);
      const bBase = requireInRange(record.b_base, 0, 100000);
      const lSeason = requireInRange(record.l_season, 1, 100000);
      if (cycleLength == null || bBase == null || lSeason == null) {
        return null;
      }
      return { ...base, cycle_length: cycleLength, b_base: bBase, l_season: lSeason };
    }
  }
}

export async function generateGrowthParams(
  scientificName: string | null,
  commonName: string | null
): Promise<GeneratedGrowthParams | null> {
  try {
    const apiKey = Deno.env.get('GEMINI_KEY');
    if (!apiKey) {
      console.error('GEMINI_KEY is not set; skipping growth-param generation');
      return null;
    }

    console.log('GROWTH_PARAMS_DEBUG: called for', scientificName, commonName);
    const prompt = buildPrompt(scientificName, commonName);
    const raw = await callGemini(apiKey, prompt);
    if (raw == null) {
      return null;
    }

    console.log('GROWTH_PARAMS_DEBUG: raw Gemini response:', JSON.stringify(raw));

    const validated = validateGrowthParams(raw);
    if (validated == null) {
      console.error('GROWTH_PARAMS_DEBUG: validation rejected the response above');
    }
    return validated;
    } catch (error) {
      console.error('generateGrowthParams failed:', error);
      return null;
    }
}
