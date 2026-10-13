import { type GeneratedGrowthParams, validateGrowthParams } from './growth-params-llm.ts';
import { lowercaseKeys } from './json-utils.ts';

// Generates growth-curve parameters (see growth-curve.ts) from a photo of a
// specific plant by asking Gemini to correct the plant's previous curve using
// the new photo and the time elapsed since (the curve keeps one timeline: x is
// the plant's "curve age" in days, never re-based to today). Validated with
// the same rules as generateGrowthParams. Best-effort only: every failure path (missing key, network error, bad JSON, a field
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

Then estimate the parameters of the plant's growth curve, using both general species knowledge AND what you observe in this photo (current apparent size, fullness, health). All timing parameters (x0, xg, xs) are days on the plant's own curve timeline, where x=0 is the start of the curve, NOT days from today. Keep them on the same timeline as the previous parameters you are given.

Always required:
- L: mature/peak leaf area in cm², adjusted for what you observe (e.g. if the plant looks stunted or damaged, this may be lower than a typical healthy specimen's peak)
- x0: day on the curve timeline of this plant's major growth inflection point (the growth phase may already be mostly complete if the plant is near or past typical maturity)
- k: growth rate constant (typically 0.02-0.3)
- xg: germination/emergence midpoint day on the curve timeline
- kg: germination steepness constant (typically 0.1-0.3)
- carbon_fraction: fraction of dry biomass that is carbon (typically 0.40-0.55)

Required if growth_mode is "annual_bounded":
- xs: day on the curve timeline when canopy stabilization begins
- ks: senescence steepness constant
- f: long-term retention floor as fraction of L

Required if growth_mode is "woody_residual":
- xs: day on the curve timeline when the residual growth phase begins
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
  isRealPriorObservation: boolean,
  previousPredictedFullnessPct: number | null
): string {
  const species = scientificName?.trim() || 'Unknown';
  const common = commonName?.trim() || 'Unknown';
  const intro = `You are looking at a photo of a plant (species: ${species}, common name: ${common}).`;

  const age = plantAgeInDays != null ? `This plant has been tracked for ${plantAgeInDays} days. ` : '';
  let context: string;

  if (previousParams == null) {
    context = `${age}Based on both the species and how this specific plant currently looks in the photo, generate growth-curve parameters for this plant. Timing parameters are days on the plant's own curve timeline (x=0 is the start of the curve), so the plant is currently roughly ${plantAgeInDays ?? 'some'} days along it.`;
  } else if (isRealPriorObservation) {
    const prediction =
      previousPredictedFullnessPct != null
        ? ` Computed from these previous parameters, the plant was predicted to be about ${previousPredictedFullnessPct}% full today.`
        : '';
    context = `${age}Here are the growth-curve parameters previously fitted to this plant ${daysSinceLastObservation} days ago: ${JSON.stringify(previousParams)}.${prediction}

Do not guess fresh parameters. CORRECT the previous parameters using this new photo and the ${daysSinceLastObservation} days that have elapsed. Compare how full and healthy the plant looks now to what the previous curve predicted. If it looks as expected, keep parameters close to their previous values. If it looks smaller, more damaged, or less full than predicted, lower L (and/or adjust k/x0) to reflect a reduced trajectory; if larger or healthier, adjust upward. Keep all timing parameters on the same curve timeline as the previous parameters (do not re-base them to today).`;
  } else {
    context = `${age}Here are typical growth-curve parameters for this species: ${JSON.stringify(previousParams)}.

These are typical parameters for this species, not a prior prediction for this specific plant. Treat them as the starting point and CORRECT them using what you observe in this particular plant's photo (size, fullness, any visible damage or stress) and its age, rather than guessing fresh. Keep timing parameters on the same curve timeline (x=0 is the start of the curve).`;
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
  isRealPriorObservation: boolean,
  previousPredictedFullnessPct: number | null = null
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
      isRealPriorObservation,
      previousPredictedFullnessPct
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
