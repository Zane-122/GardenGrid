import { type GeneratedGrowthParams, validateGrowthParams } from './growth-params-llm.ts';
import { lowercaseKeys } from './json-utils.ts';

// Generates growth-curve parameters (see growth-curve.ts) from a photo of a
// specific plant by asking Gemini, recalibrating the curve as of today
// (x=0). Validated with the same rules as generateGrowthParams. Best-effort
// only: every failure path (missing key, network error, bad JSON, a field
// out of range) returns null rather than throwing, so a misbehaving LLM
// call can never break the plant-saving flow that calls it.

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Not specified by the request — defaulting to a current, fast Gemini model.
// Override with the GEMINI_MODEL secret if a different one is wanted.
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

const PARAM_SCHEMA = `Classify this plant into exactly one growth_mode:
- "annual_bounded": annuals, determinate vegetables, most houseplants that reach a stable mature size and hold there
- "woody_residual": trees, shrubs, woody perennials that keep slowly growing indefinitely after initial maturity
- "cyclical": herbaceous perennials that die back and regrow each season

Then estimate, using both general species knowledge AND what you observe in this photo (current apparent size, fullness, health):

Always required:
- L: mature/peak leaf area in cm², adjusted for what you observe (e.g. if the plant looks stunted or damaged, this may be lower than a typical healthy specimen's peak)
- x0: days from today until this plant reaches its next major growth inflection point (if the plant is already near or past typical maturity, this may be small or the growth phase may already be mostly complete)
- k: growth rate constant (typically 0.02-0.3)
- xg: typically 0, since a plant visible in this photo has already emerged — only use a nonzero value if there's a reason to expect a new germination phase (e.g. a cyclical plant currently dormant)
- kg: germination steepness constant (typically 0.1-0.3)
- carbon_fraction: fraction of dry biomass that is carbon (typically 0.40-0.55)

Required if growth_mode is "annual_bounded":
- xs: days from today until canopy stabilization begins
- ks: senescence steepness constant
- f: long-term retention floor as fraction of L

Required if growth_mode is "woody_residual":
- xs: days from today until residual growth phase begins (0 if already in that phase)
- r: residual growth rate in cm²/day after xs

Required if growth_mode is "cyclical":
- cycle_length: days per growth cycle
- b_base: persistent crown/root leaf-equivalent baseline in cm², adjusted for what you observe
- l_season: new seasonal leaf area this plant will regrow this cycle, in cm²

Also return confidence: a number 0-1.

Return only valid JSON with only the fields relevant to your chosen growth_mode populated.`;

function buildPrompt(
  scientificName: string | null,
  commonName: string | null,
  previousParams: GeneratedGrowthParams | null,
  daysSinceLastObservation: number | null,
  plantAgeInDays: number | null,
  isRealPriorObservation: boolean
): string {
  const species = scientificName?.trim() || 'Unknown';
  const common = commonName?.trim() || 'Unknown';
  const intro = `You are looking at a photo of a plant (species: ${species}, common name: ${common}).`;

  let context: string;

  if (previousParams == null) {
    context = `Based on both the species and how this specific plant currently looks in the photo, generate growth-curve parameters that describe this plant GOING FORWARD FROM TODAY. Treat today (the date of this photo) as x=0 — all timing parameters below should describe days from today, not days from when the plant was originally planted.`;
  } else if (isRealPriorObservation) {
    context = `This plant is ${plantAgeInDays} days old. Here are the growth-curve parameters previously predicted for it: ${JSON.stringify(previousParams)}.

Compare what you see in this new photo to what these previous parameters would have predicted for this plant ${daysSinceLastObservation} days later. If the plant looks roughly as expected, keep parameters close to their previous values. If it looks smaller, more damaged, or less full than expected, lower L (and/or adjust k/x0) to reflect a reduced trajectory. If it looks larger or healthier than expected, adjust upward. Treat today as the new reference point (x=0) going forward — all timing parameters below should describe days from today.`;
  } else {
    context = `This plant is ${plantAgeInDays} days old. Here are typical growth-curve parameters for this species: ${JSON.stringify(previousParams)}.

These are typical parameters for this species, not a prior prediction for this specific plant. Use them as a starting reference, adjusted for what you observe in this particular plant's photo (size, fullness, any visible damage or stress). Treat today as x=0 — all timing parameters below should describe days from today.`;
  }

  return `${intro}\n\n${context}\n\n${PARAM_SCHEMA}`;
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

export async function generateGrowthParamsFromPhoto(
  imageBase64: string,
  mimeType: string,
  scientificName: string | null,
  commonName: string | null,
  previousParams: GeneratedGrowthParams | null,
  daysSinceLastObservation: number | null,
  plantAgeInDays: number | null,
  isRealPriorObservation: boolean
): Promise<GeneratedGrowthParams | null> {
  try {
    const apiKey = Deno.env.get('GEMINI_KEY');
    if (!apiKey) {
      console.error('GEMINI_KEY is not set; skipping photo-based growth-param generation');
      return null;
    }

    const prompt = buildPrompt(
      scientificName,
      commonName,
      previousParams,
      daysSinceLastObservation,
      plantAgeInDays,
      isRealPriorObservation
    );
    const raw = await callGemini(apiKey, prompt, imageBase64, mimeType);
    if (raw == null) {
      return null;
    }

    const validated = validateGrowthParams(raw);
    if (validated == null) {
      console.error('GROWTH_PARAMS_FROM_PHOTO_DEBUG: validation rejected the response');
    }
    return validated;
  } catch (error) {
    console.error('generateGrowthParamsFromPhoto failed:', error);
    return null;
  }
}
