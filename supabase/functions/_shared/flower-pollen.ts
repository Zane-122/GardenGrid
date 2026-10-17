import { lowercaseKeys } from './json-utils.ts';

// Flower ratio and pollen-per-flower are constants, not a growth curve.
// A photo asks Gemini to correct the previous constants. The hourly accrual
// job multiplies flower_ratio by current leaf area; it does not call the LLM.

export type FlowerPollenConstants = {
  /** Flowers per cm² of leaf area. 0 means the plant is not flowering. */
  flower_ratio: number;
  /** Cubic centimeters of pollen one flower produces over 8 hours. */
  pollen_per_flower_cm3: number;
};

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

const POLLEN_INTERVAL_HOURS = 8;

export function flowerCountFromLeafArea(leafAreaCm2: number, flowerRatio: number) {
  if (!Number.isFinite(leafAreaCm2) || leafAreaCm2 <= 0 || !Number.isFinite(flowerRatio) || flowerRatio <= 0) {
    return 0;
  }
  return leafAreaCm2 * flowerRatio;
}

export function pollenVolumeCm3(flowerCount: number, pollenPerFlowerCm3: number) {
  if (!Number.isFinite(flowerCount) || flowerCount <= 0 || !Number.isFinite(pollenPerFlowerCm3) || pollenPerFlowerCm3 <= 0) {
    return 0;
  }
  return flowerCount * pollenPerFlowerCm3;
}

export function pollenIntervalElapsed(lastCreditedAt: string | null, now: Date) {
  if (!lastCreditedAt) {
    return false;
  }
  const at = new Date(lastCreditedAt).getTime();
  if (!Number.isFinite(at)) {
    return false;
  }
  return now.getTime() - at >= POLLEN_INTERVAL_HOURS * 60 * 60 * 1000;
}

function buildPrompt(
  scientificName: string | null,
  commonName: string | null,
  previous: FlowerPollenConstants | null
): string {
  const species = scientificName?.trim() || 'Unknown';
  const common = commonName?.trim() || 'Unknown';
  const previousText = previous
    ? `Previous constants for this plant: flower_ratio=${previous.flower_ratio}, pollen_per_flower_cm3=${previous.pollen_per_flower_cm3}. CORRECT them from this photo. These are constants, not a curve. If the plant looks about the same, keep both numbers close to the previous values. Change them only when the photo clearly shows more flowers, fewer flowers, or a different pollen yield.`
    : 'This plant has no previous constants. Estimate them from the species and what you can see in the photo.';

  return `You are looking at a photo of a plant (species: ${species}, common name: ${common}).

Estimate two constants for pollen the plant produces. Do not estimate leaf area or a growth curve.

- flower_ratio: number of flowers per cm² of leaf area. 0 if the plant has no flowers. A typical garden plant in bloom is about 0.001 to 0.05.
- pollen_per_flower_cm3: cubic centimeters of pollen one open flower produces over ${POLLEN_INTERVAL_HOURS} hours. 0 if there are no flowers. Typical values are about 0.01 to 2.

${previousText}

Return only valid JSON: {"flower_ratio": number, "pollen_per_flower_cm3": number}`;
}

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

export function validateFlowerPollenConstants(raw: unknown): FlowerPollenConstants | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const flowerRatio = asFiniteNumber(record.flower_ratio);
  const pollenPerFlower = asFiniteNumber(record.pollen_per_flower_cm3);
  if (flowerRatio == null || flowerRatio < 0 || flowerRatio > 1) {
    return null;
  }
  if (pollenPerFlower == null || pollenPerFlower < 0 || pollenPerFlower > 20) {
    return null;
  }
  if (flowerRatio === 0) {
    return { flower_ratio: 0, pollen_per_flower_cm3: 0 };
  }
  return { flower_ratio: flowerRatio, pollen_per_flower_cm3: pollenPerFlower };
}

export async function generateFlowerPollenParams(
  imageBase64: string,
  mimeType: string,
  scientificName: string | null,
  commonName: string | null,
  previous: FlowerPollenConstants | null
): Promise<FlowerPollenConstants | null> {
  try {
    const apiKey = Deno.env.get('GEMINI_KEY');
    if (!apiKey) {
      console.error('GEMINI_KEY is not set; skipping flower and pollen constants');
      return null;
    }

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
              { text: buildPrompt(scientificName, commonName, previous) },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      console.error(`Flower pollen Gemini request failed (${response.status})`);
      return null;
    }

    const payload = await response.json().catch(() => null);
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      return null;
    }

    const parsed = JSON.parse(text);
    const normalized = typeof parsed === 'object' && parsed !== null ? lowercaseKeys(parsed) : parsed;
    const validated = validateFlowerPollenConstants(normalized);
    if (!validated) {
      console.error('FLOWER_POLLEN_DEBUG: validation rejected', text);
    }
    return validated;
  } catch (error) {
    console.error('generateFlowerPollenParams failed:', error);
    return null;
  }
}
