import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import {
  BASIC_DETAILS,
  corsHeaders,
  json,
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
    const top = suggestions[0];
    const plantId = typeof top?.id === 'string' ? top.id : null;
    const scientificName = typeof top?.name === 'string' ? top.name : null;

    if (!plantId) {
      return json({ error: 'Plant.id did not return a species suggestion' }, 502);
    }

    const saved = await saveUserPlant(
      admin,
      user.id,
      toBasicInfo(plantId, scientificName, top.details ?? {})
    );

    return json({
      added: true,
      plant: saved.plant,
      info: saved.info,
      location: coordinates,
      is_plant: isPlant ?? null,
      identification_access_token: identification?.access_token ?? null,
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
