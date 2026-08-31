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

type SearchBody = {
  q?: string;
  access_token?: string;
  limit?: number;
  language?: string;
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
    const body = (await req.json().catch(() => ({}))) as SearchBody;
    const query = body.q?.trim();
    const accessToken = body.access_token?.trim();
    const language = body.language?.trim() || 'en';
    const limit = Math.min(Math.max(body.limit ?? 10, 1), 20);
    const coordinates = parseCoordinates(body);

    if (!query && !accessToken) {
      return json({ error: 'Provide q to search, or access_token to add a plant' }, 400);
    }

    if (query && !accessToken) {
      const params = new URLSearchParams({
        q: query,
        limit: String(limit),
        language,
      });
      const results = await plantIdFetch(`/kb/plants/name_search?${params.toString()}`);
      return json({
        entities: results?.entities ?? [],
        entities_trimmed: Boolean(results?.entities_trimmed),
        limit: results?.limit ?? limit,
        location: coordinates,
      });
    }

    const detail = await plantIdFetch(
      `/kb/plants/${encodeURIComponent(accessToken!)}?details=${BASIC_DETAILS}&language=${encodeURIComponent(language)}`
    );

    const plantId = typeof detail?.entity_id === 'string' ? detail.entity_id : null;
    const scientificName = typeof detail?.name === 'string' ? detail.name : null;
    if (!plantId) {
      return json({ error: 'Plant.id detail response was missing entity_id' }, 502);
    }

    const saved = await saveUserPlant(admin, user.id, toBasicInfo(plantId, scientificName, detail));
    return json({
      added: true,
      plant: saved.plant,
      info: saved.info,
      location: coordinates,
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
        error: error instanceof Error ? error.message : 'Name search failed',
        details: (error as { payload?: unknown }).payload ?? null,
      },
      status === 429 ? 429 : status
    );
  }
});
