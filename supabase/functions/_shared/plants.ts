import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';

import type { GrowthMode } from './growth-curve.ts';
import { generateGrowthParams } from './growth-params-llm.ts';

export const PLANT_ID_BASE = 'https://plant.id/api/v3';

export const BASIC_DETAILS = [
  'common_names',
  'url',
  'taxonomy',
  'rank',
  'gbif_id',
  'inaturalist_id',
  'image',
  'edible_parts',
  'watering',
  'propagation_methods',
  'best_soil_type',
].join(',');

export const NOT_A_GARDEN_PLANT_MESSAGE =
  'Garden Grid only includes plants, not fungi or similar organisms.';

export function isPlantKingdom(taxonomy: Record<string, unknown> | null | undefined) {
  if (!taxonomy) {
    return true;
  }

  const kingdom = String(taxonomy.kingdom ?? '').trim().toLowerCase();
  return !kingdom || kingdom === 'plantae';
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export type PlantBasicInfoRow = {
  plant_id: string;
  scientific_name: string | null;
  common_names: string[];
  taxonomy: Record<string, unknown> | null;
  rank: string | null;
  watering: { min?: number; max?: number } | null;
  propagation_methods: string[];
  edible_parts: string[];
  best_soil_type: string | null;
  image_url: string | null;
  url: string | null;
  gbif_id: number | null;
  inaturalist_id: number | null;
  updated_at: string;

  // Growth-curve params (see growth-curve.ts / growth-params-llm.ts).
  // Populated lazily by cachePlantInfo() via an LLM call, so all nullable.
  growth_mode: GrowthMode | null;
  l: number | null;
  k: number | null;
  x0: number | null;
  xg: number | null;
  kg: number | null;
  ks: number | null;
  xs: number | null;
  f: number | null;
  r: number | null;
  cycle_length: number | null;
  b_base: number | null;
  l_season: number | null;
  carbon_fraction: number | null;
  confidence: number | null;
  params_generated_at: string | null;
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export function parseCoordinates(body: { latitude?: unknown; longitude?: unknown }): Coordinates | null {
  const latitude = typeof body.latitude === 'number' ? body.latitude : Number(body.latitude);
  const longitude = typeof body.longitude === 'number' ? body.longitude : Number(body.longitude);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

export function plantIdKey() {
  const key = Deno.env.get('PLANTID_API_KEY');
  if (!key) {
    throw new Error('PLANTID_API_KEY is not set');
  }
  return key;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (value && typeof value === 'object') {
    const fromEn = (value as { en?: unknown }).en;
    if (Array.isArray(fromEn)) {
      return fromEn.filter((item): item is string => typeof item === 'string');
    }
  }
  return [];
}

function asImageUrl(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string') {
    return (value as { value: string }).value;
  }
  return null;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  if (value && typeof value === 'object') {
    const record = value as { value?: unknown; en?: unknown };
    return asText(record.value ?? record.en);
  }
  return null;
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toBasicInfo(
  plantId: string,
  scientificName: string | null,
  details: Record<string, unknown> | null | undefined
): Omit<PlantBasicInfoRow, 'updated_at'> {
  const watering = details?.watering;
  return {
    plant_id: plantId,
    scientific_name: scientificName,
    common_names: asStringArray(details?.common_names),
    taxonomy: details?.taxonomy && typeof details.taxonomy === 'object'
      ? (details.taxonomy as Record<string, unknown>)
      : null,
    rank: typeof details?.rank === 'string' ? details.rank : null,
    watering:
      watering && typeof watering === 'object'
        ? (watering as { min?: number; max?: number })
        : null,
    propagation_methods: asStringArray(details?.propagation_methods),
    edible_parts: asStringArray(details?.edible_parts),
    best_soil_type: asText(details?.best_soil_type),
    image_url: asImageUrl(details?.image),
    url: typeof details?.url === 'string' ? details.url : null,
    gbif_id: asInt(details?.gbif_id),
    inaturalist_id: asInt(details?.inaturalist_id),
  };
}

export async function plantIdFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${PLANT_ID_BASE}${path}`, {
    ...init,
    headers: {
      'Api-Key': plantIdKey(),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload && payload.error) ||
      `Plant.id request failed (${response.status})`;
    const error = new Error(String(message));
    (error as Error & { status: number; payload: unknown }).status = response.status;
    (error as Error & { status: number; payload: unknown }).payload = payload;
    throw error;
  }

  return payload;
}

export async function requireUser(req: Request): Promise<{ user: User; admin: SupabaseClient }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw json({ error: 'Missing Authorization bearer token' }, 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey =
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const serviceKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');

  if (!url || !anonKey || !serviceKey) {
    throw json({ error: 'Supabase environment is not configured' }, 500);
  }

  const token = authHeader.slice('Bearer '.length);
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    throw json({ error: 'Invalid or expired session' }, 401);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { user: data.user, admin };
}

// Growth-curve params are generated lazily, once per species: if a row
// doesn't have them yet, ask the LLM and persist the result. Best-effort —
// generateGrowthParams() never throws, so a failed/unavailable call just
// returns the row as-is and callers continue unaffected.
export async function ensureGrowthParams(
  admin: SupabaseClient,
  row: PlantBasicInfoRow
): Promise<PlantBasicInfoRow> {
  if (row.growth_mode && row.params_generated_at) {
    return row;
  }

  const generated = await generateGrowthParams(row.scientific_name, row.common_names?.[0] ?? null);
  if (!generated) {
    return row;
  }

  const { data: updated, error: updateError } = await admin
    .from('plant_basic_info')
    .update({ ...generated, params_generated_at: new Date().toISOString() })
    .eq('plant_id', row.plant_id)
    .select()
    .single();

  if (updateError) {
    console.error(`Failed to save growth params for ${row.plant_id}: ${updateError.message}`);
    return row;
  }

  return updated as PlantBasicInfoRow;
}

export async function cachePlantInfo(
  admin: SupabaseClient,
  info: Omit<PlantBasicInfoRow, 'updated_at'>
) {
  const { data: basicInfo, error: infoError } = await admin
    .from('plant_basic_info')
    .upsert(
      { ...info, updated_at: new Date().toISOString() },
      { onConflict: 'plant_id' }
    )
    .select()
    .single();

  if (infoError) {
    throw json({ error: `Failed to save plant_basic_info: ${infoError.message}` }, 500);
  }

  return ensureGrowthParams(admin, basicInfo as PlantBasicInfoRow);
}

export async function saveUserPlant(
  admin: SupabaseClient,
  userId: string,
  info: Omit<PlantBasicInfoRow, 'updated_at'>
) {
  const basicInfo = await cachePlantInfo(admin, info);

  const { data: plant, error: plantError } = await admin
    .from('plants')
    .insert({ user_id: userId, plant_id: info.plant_id })
    .select()
    .single();

  if (plantError) {
    throw json({ error: `Failed to save plant: ${plantError.message}` }, 500);
  }

  return { plant, info: basicInfo };
}

export const PLANT_PHOTOS_BUCKET = 'plant-photos';

function decodeBase64(payload: string): Uint8Array {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function decodePlantImage(image: string): Promise<{
  bytes: Uint8Array;
  contentType: string;
}> {
  const dataUrl = image.match(/^data:([^;]+);base64,(.+)$/s);
  if (dataUrl) {
    return {
      bytes: decodeBase64(dataUrl[2]),
      contentType: dataUrl[1] || 'image/jpeg',
    };
  }

  if (/^https?:\/\//i.test(image)) {
    const response = await fetch(image);
    if (!response.ok) {
      throw json({ error: 'Could not download the plant photo' }, 400);
    }

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type')?.split(';')[0] || 'image/jpeg',
    };
  }

  try {
    return {
      bytes: decodeBase64(image.replace(/\s/g, '')),
      contentType: 'image/jpeg',
    };
  } catch {
    throw json({ error: 'Could not decode the plant photo' }, 400);
  }
}

export async function uploadPlantPhoto(
  admin: SupabaseClient,
  plantInstanceId: string,
  image: string
) {
  const { bytes, contentType } = await decodePlantImage(image);
  const { error } = await admin.storage.from(PLANT_PHOTOS_BUCKET).upload(plantInstanceId, bytes, {
    contentType,
    upsert: true,
  });

  if (error) {
    throw json({ error: `Failed to store plant photo: ${error.message}` }, 500);
  }

  return { bucket: PLANT_PHOTOS_BUCKET, path: plantInstanceId };
}

export async function saveUserPlantWithPhoto(
  admin: SupabaseClient,
  userId: string,
  info: Omit<PlantBasicInfoRow, 'updated_at'>,
  image: string
) {
  const result = await saveUserPlant(admin, userId, info);

  try {
    const photo = await uploadPlantPhoto(admin, result.plant.id, image);
    const { data: plant, error } = await admin
      .from('plants')
      .update({ photo_path: photo.path })
      .eq('id', result.plant.id)
      .select()
      .single();

    if (error) {
      throw json({ error: `Failed to link plant photo: ${error.message}` }, 500);
    }

    return { plant, info: result.info, photo };
  } catch (error) {
    await admin.from('plants').delete().eq('id', result.plant.id);
    throw error;
  }
}
