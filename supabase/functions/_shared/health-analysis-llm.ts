import { lowercaseKeys } from './json-utils.ts';

// Estimates canopy fullness and health of a plant from a photo by asking
// Gemini, then validates/clamps the response against known-sane bounds.
// Best-effort only: every failure path (missing key, network error, bad
// JSON, a required field missing/out of range) returns null rather than
// throwing.

export type PlantHealthAnalysis = {
  fullness_pct: number;
  health_score: number;
  confidence: number;
};

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Not specified by the request — defaulting to a current, fast Gemini model.
// Override with the GEMINI_MODEL secret if a different one is wanted.
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

function buildPrompt(scientificName: string | null): string {
  const speciesClause = scientificName?.trim() ? ` (species: ${scientificName.trim()})` : '';

  return `You are looking at a photo of a plant${speciesClause}.

Estimate two things:

1. fullness_pct: how full/mature this plant's canopy looks, as a percentage
   (0-100) of what a typical mature specimen of this species looks like.
   0 = bare soil/no visible growth, 100 = full mature canopy.

2. health_score: how healthy this plant looks, as a percentage (0-100).
   Consider leaf color, wilting, browning, spotting, or other visible
   stress. 100 = vibrant and healthy, 0 = severely stressed/dying.

Also return confidence: a number 0-1 reflecting how clearly the plant and
its condition are visible in the photo (lower for blurry, partially
obscured, or poorly-lit photos).

Return only valid JSON: {"fullness_pct": number, "health_score": number, "confidence": number}`;
}

async function callGemini(
  apiKey: string,
  prompt: string,
  imageBase64: string,
  mimeType: string
): Promise<unknown | null> {
  const model = Deno.env.get('GEMINI_MODEL')?.trim() || DEFAULT_GEMINI_MODEL;
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
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
// fullness_pct and health_score are hard/required: missing, non-finite, or
// outside [0, 100] => whole result is rejected (returns null).
// confidence is soft: clamped into [0, 1], defaulting to 0.5 when missing.
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

function validateHealthAnalysis(raw: unknown): PlantHealthAnalysis | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;

  const fullnessPct = requireInRange(record.fullness_pct, 0, 100);
  if (fullnessPct == null) {
    console.error('HEALTH_ANALYSIS_DEBUG: validation rejected response, field: fullness_pct');
    return null;
  }

  const healthScore = requireInRange(record.health_score, 0, 100);
  if (healthScore == null) {
    console.error('HEALTH_ANALYSIS_DEBUG: validation rejected response, field: health_score');
    return null;
  }

  const confidence = clampOrDefault(record.confidence, 0, 1, 0.5);

  return { fullness_pct: fullnessPct, health_score: healthScore, confidence };
}

export async function analyzePlantHealth(
  imageBase64: string,
  mimeType: string,
  scientificName: string | null
): Promise<PlantHealthAnalysis | null> {
  try {
    const apiKey = Deno.env.get('GEMINI_KEY');
    if (!apiKey) {
      console.error('GEMINI_KEY is not set; skipping health analysis');
      return null;
    }

    const prompt = buildPrompt(scientificName);
    const raw = await callGemini(apiKey, prompt, imageBase64, mimeType);
    if (raw == null) {
      return null;
    }

    return validateHealthAnalysis(raw);
  } catch (error) {
    console.error('analyzePlantHealth failed:', error);
    return null;
  }
}
