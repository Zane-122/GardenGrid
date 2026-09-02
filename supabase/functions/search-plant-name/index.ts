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

type SearchBody = {
  q?: string;
  access_token?: string;
  limit?: number;
  language?: string;
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
        limit: '20',
        language,
        thumbnails: 'true',
      });
      const results = await plantIdFetch(`/kb/plants/name_search?${params.toString()}`);
      const entities = Array.isArray(results?.entities) ? results.entities : [];
      const cachedMeta = await cachedSearchMeta(
        admin,
        entities.map((entity: { entity_name?: unknown }) => entity?.entity_name)
      );

      return json({
        entities: entities
          .filter((entity: Record<string, unknown>) => {
            const name = typeof entity.entity_name === 'string' ? entity.entity_name : '';
            return isPlantKingdom(cachedMeta.get(name)?.taxonomy);
          })
          .map((entity: Record<string, unknown>) => ({
            matched_in: typeof entity.matched_in === 'string' ? entity.matched_in : '',
            matched_in_type: typeof entity.matched_in_type === 'string' ? entity.matched_in_type : '',
            access_token: typeof entity.access_token === 'string' ? entity.access_token : '',
            match_position: typeof entity.match_position === 'number' ? entity.match_position : 0,
            match_length: typeof entity.match_length === 'number' ? entity.match_length : 0,
            entity_name: typeof entity.entity_name === 'string' ? entity.entity_name : '',
            thumbnail:
              cachedMeta.get(typeof entity.entity_name === 'string' ? entity.entity_name : '')?.image_url ??
              asSearchThumbnail(entity.thumbnail ?? entity.image) ??
              null,
          }))
          .slice(0, 20),
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

    const info = toBasicInfo(plantId, scientificName, detail);
    if (!isPlantKingdom(info.taxonomy)) {
      await cachePlantInfo(admin, info);
      return json({ error: NOT_A_GARDEN_PLANT_MESSAGE }, 400);
    }
    if (body.save === false) {
      const cached = await cachePlantInfo(admin, info);
      return json({
        added: false,
        info: cached,
        location: coordinates,
      });
    }

    const saved = await saveUserPlant(admin, user.id, info);
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

function asSearchThumbnail(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    if (value.startsWith('data:') || /^https?:\/\//.test(value)) {
      return value;
    }
    return `data:image/jpeg;base64,${value}`;
  }

  if (value && typeof value === 'object') {
    const record = value as { value?: unknown; url?: unknown };
    return asSearchThumbnail(record.url ?? record.value);
  }

  return null;
}

async function cachedSearchMeta(
  admin: Awaited<ReturnType<typeof requireUser>>['admin'],
  names: unknown[]
) {
  const scientificNames = [
    ...new Set(names.filter((name): name is string => typeof name === 'string' && name.length > 0)),
  ];
  const meta = new Map<string, { image_url: string | null; taxonomy: Record<string, unknown> | null }>();

  if (scientificNames.length === 0) {
    return meta;
  }

  const { data } = await admin
    .from('plant_basic_info')
    .select('scientific_name, image_url, taxonomy')
    .in('scientific_name', scientificNames);

  for (const row of data ?? []) {
    if (row.scientific_name) {
      meta.set(row.scientific_name, {
        image_url: row.image_url ?? null,
        taxonomy: row.taxonomy && typeof row.taxonomy === 'object' ? row.taxonomy : null,
      });
    }
  }

  return meta;
}
