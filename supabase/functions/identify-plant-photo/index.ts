import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import {
  BASIC_DETAILS,
  cachePlantInfo,
  corsHeaders,
  isPlantKingdom,
  json,
  NOT_A_GARDEN_PLANT_MESSAGE,
  parseCoordinates,
  plantIdFetch,
  requireUser,
  saveUserPlant,
  toBasicInfo,
} from '../_shared/plants.ts';

type IdentifyBody = {
  images?: string[];
  latitude?: number;
  longitude?: number;
  save?: boolean;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { user, admin } = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as IdentifyBody;
    const images = Array.isArray(body.images)
      ? body.images.filter((image): image is string => typeof image === 'string' && image.length > 0)
      : [];

    if (images.length === 0) {
      return json({ error: 'Provide at least one image URL or base64 string' }, 400);
    }

    const coordinates = parseCoordinates(body);
    const identification = await plantIdFetch(`/identification?details=${BASIC_DETAILS}&language=en`, {
      method: 'POST',
      body: JSON.stringify({
        images,
        similar_images: true,
        suggestion_filter: { classification: 'vascular_plants OR bryophytes' },
        ...(coordinates ?? {}),
      }),
    });

    const isPlant = identification?.result?.is_plant;
    if (isPlant?.binary === false) {
      return json(
        {
          error: 'This photo does not appear to contain a plant',
          is_plant: isPlant,
        },
        400
      );
    }

    const suggestions = Array.isArray(identification?.result?.classification?.suggestions)
      ? identification.result.classification.suggestions
      : [];
    const top = suggestions.find((suggestion: { details?: Record<string, unknown> }) =>
      isPlantKingdom(
        suggestion?.details?.taxonomy && typeof suggestion.details.taxonomy === 'object'
          ? (suggestion.details.taxonomy as Record<string, unknown>)
          : null
      )
    );
    const plantId = typeof top?.id === 'string' ? top.id : null;
    const scientificName = typeof top?.name === 'string' ? top.name : null;

    if (!plantId || !top) {
      return json(
        {
          error: suggestions.length > 0 ? NOT_A_GARDEN_PLANT_MESSAGE : 'Plant.id did not return a species suggestion',
        },
        suggestions.length > 0 ? 400 : 502
      );
    }

    const info = toBasicInfo(plantId, scientificName, top.details ?? {});
    if (!isPlantKingdom(info.taxonomy)) {
      return json({ error: NOT_A_GARDEN_PLANT_MESSAGE }, 400);
    }
    const shouldSave = body.save !== false;
    const result = shouldSave
      ? await saveUserPlant(admin, user.id, info)
      : { plant: null, info: await cachePlantInfo(admin, info) };

    return json({
      added: shouldSave,
      plant: result.plant,
      info: result.info,
      location: coordinates,
      is_plant: isPlant ?? null,
      identification_access_token: identification?.access_token ?? null,
      similar_images: asSimilarImages(top.similar_images),
      suggestions: suggestions.map((suggestion: { id?: string; name?: string; probability?: number }) => ({
        id: suggestion.id ?? null,
        name: suggestion.name ?? null,
        probability: suggestion.probability ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    const status = typeof (error as { status?: number }).status === 'number'
      ? (error as { status: number }).status
      : 500;
    return json(
      {
        error: error instanceof Error ? error.message : 'Photo identification failed',
        details: (error as { payload?: unknown }).payload ?? null,
      },
      status === 429 ? 429 : status
    );
  }
});

function asSimilarImages(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as {
        url?: unknown;
        url_small?: unknown;
        citation?: unknown;
        license_name?: unknown;
        license_url?: unknown;
      };
      const url =
        typeof record.url === 'string' && record.url.length > 0
          ? record.url
          : typeof record.url_small === 'string' && record.url_small.length > 0
            ? record.url_small
            : null;

      if (!url) {
        return null;
      }

      return {
        url,
        citation: typeof record.citation === 'string' ? record.citation : null,
        license_name: typeof record.license_name === 'string' ? record.license_name : null,
        license_url: typeof record.license_url === 'string' ? record.license_url : null,
      };
    })
    .filter((image): image is NonNullable<typeof image> => image != null)
    .slice(0, 3);
}
