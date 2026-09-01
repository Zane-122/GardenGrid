import { getGardenCoordinates } from '@/utils/location';
import { supabase } from '@/utils/supabase';

export type PlantNameMatch = {
  matched_in: string;
  matched_in_type: string;
  access_token: string;
  match_position: number;
  match_length: number;
  entity_name: string;
  thumbnail: string | null;
};

export type PlantBasicInfo = {
  plant_id: string;
  scientific_name: string | null;
  common_names: string[];
  taxonomy: Record<string, unknown> | null;
  rank: string | null;
  watering: { min?: number; max?: number } | null;
  propagation_methods: string[];
  edible_parts: string[];
  image_url: string | null;
  url: string | null;
  gbif_id: number | null;
  inaturalist_id: number | null;
  updated_at: string;
};

export type UserPlant = {
  id: string;
  user_id: string;
  plant_id: string;
  created_at: string;
};

export type InventoryPlant = UserPlant & {
  info: PlantBasicInfo | null;
};

export type PlantSimilarImage = {
  url: string;
  citation: string | null;
  license_name: string | null;
  license_url: string | null;
};

type LocationOptions = {
  latitude?: number;
  longitude?: number;
};

const WATERING_LABELS = ['', 'dry', 'medium', 'wet'] as const;

function capitalizePlantName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || /[A-Z]/.test(trimmed)) {
    return trimmed;
  }

  return trimmed.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

export function plantDisplayName(info: PlantBasicInfo | null | undefined, fallback?: string) {
  return capitalizePlantName(
    info?.common_names?.[0] || fallback || info?.scientific_name || 'Unknown plant'
  );
}

export function plantSearchLabels(match: PlantNameMatch) {
  return { title: capitalizePlantName(match.matched_in) || 'Unknown plant', subtitle: null };
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase();
}

function searchMatchType(match: Pick<PlantNameMatch, 'matched_in_type'>) {
  return match.matched_in_type.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function isCommonNameSearchMatch(match: PlantNameMatch) {
  const type = searchMatchType(match);
  if (type === 'entity_name' || type === 'synonym') {
    return false;
  }
  if (type === 'common_name' || type === 'common_names') {
    return true;
  }

  const matched = normalizeSearchText(match.matched_in);
  const scientific = normalizeSearchText(match.entity_name);
  return Boolean(matched && scientific && matched !== scientific);
}

function editDistance(left: string, right: string) {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const grid = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));

  for (let row = 0; row < rows; row += 1) {
    grid[row][0] = row;
  }
  for (let column = 0; column < columns; column += 1) {
    grid[0][column] = column;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      grid[row][column] = Math.min(
        grid[row - 1][column] + 1,
        grid[row][column - 1] + 1,
        grid[row - 1][column - 1] + substitution
      );
    }
  }

  return grid[left.length][right.length];
}

export function plantSearchSimilarity(query: string, match: PlantNameMatch) {
  const q = normalizeSearchText(query);
  const name = normalizeSearchText(match.matched_in);
  if (!q || !name) {
    return 0;
  }

  let score = 0;
  if (name === q) {
    score = 1;
  } else if (name.startsWith(q)) {
    score = 0.86 + 0.12 * (q.length / name.length);
  } else if (name.split(/\s+/).some((word) => word.startsWith(q))) {
    score = 0.7 + 0.14 * (q.length / name.length);
  } else if (name.includes(q)) {
    score = 0.52;
  } else {
    score = 1 - editDistance(q, name) / Math.max(q.length, name.length);
  }

  if (match.match_length > 0) {
    score = Math.max(score, match.match_length / Math.max(name.length, q.length));
  }
  if (match.match_position === 0) {
    score += 0.04;
  }

  const type = searchMatchType(match);
  if (type === 'common_name' || type === 'common_names') {
    score += 0.08;
  } else if (type === 'entity_name' || type === 'synonym') {
    score -= 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

function uniqueSearchMatches(ranked: { match: PlantNameMatch }[]) {
  const seen = new Set<string>();
  const selected: PlantNameMatch[] = [];

  for (const { match } of ranked) {
    if (seen.has(match.access_token)) {
      continue;
    }
    seen.add(match.access_token);
    selected.push(match);
  }

  return selected;
}

export function selectPlantSearchMatches(query: string, matches: PlantNameMatch[]) {
  const ranked = matches
    .map((match) => ({ match, score: plantSearchSimilarity(query, match) }))
    .filter(({ score }) => score >= 0.45)
    .sort((left, right) => right.score - left.score || left.match.matched_in.localeCompare(right.match.matched_in));

  const common = uniqueSearchMatches(ranked.filter(({ match }) => isCommonNameSearchMatch(match)));
  if (common.length > 0) {
    return common;
  }

  return uniqueSearchMatches(ranked);
}

export function wateringRange(watering: PlantBasicInfo['watering'] | undefined) {
  if (!watering) {
    return null;
  }

  const min = watering.min ?? watering.max;
  const max = watering.max ?? watering.min;
  if (min == null || max == null) {
    return null;
  }

  const minLabel = WATERING_LABELS[min];
  const maxLabel = WATERING_LABELS[max];
  if (!minLabel || !maxLabel) {
    return null;
  }

  return {
    min,
    max,
    label: min === max ? minLabel : `${minLabel} to ${maxLabel}`,
  };
}

export function wateringLabel(watering: PlantBasicInfo['watering'] | undefined) {
  return wateringRange(watering)?.label ?? null;
}

async function resolveCoordinates(options?: LocationOptions) {
  if (
    typeof options?.latitude === 'number' &&
    typeof options?.longitude === 'number' &&
    Number.isFinite(options.latitude) &&
    Number.isFinite(options.longitude)
  ) {
    return { latitude: options.latitude, longitude: options.longitude };
  }

  return getGardenCoordinates();
}

async function functionErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'context' in error) {
    const response = (error as { context?: Response }).context;
    if (response && typeof response.json === 'function') {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (body?.error) {
        return body.error;
      }
    }
  }

  return error instanceof Error ? error.message : 'Something went wrong';
}

async function invokeFunction<T>(name: string, body: Record<string, unknown>) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }
  if (!session?.access_token) {
    throw new Error('You need to be signed in to add a plant');
  }

  const { data, error } = await supabase.functions.invoke<T>(name, {
    body,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    throw new Error(await functionErrorMessage(error));
  }

  return data;
}

export async function listUserPlants() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }
  if (!user) {
    throw new Error('You need to be signed in to view your plants');
  }

  const { data, error } = await supabase
    .from('plants')
    .select('id, user_id, plant_id, created_at, info:plant_basic_info(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    user_id: row.user_id as string,
    plant_id: row.plant_id as string,
    created_at: row.created_at as string,
    info: (Array.isArray(row.info) ? row.info[0] : row.info) as PlantBasicInfo | null,
  })) satisfies InventoryPlant[];
}

export async function deleteUserPlant(id: string) {
  const { error } = await supabase.from('plants').delete().eq('id', id);
  if (error) {
    throw error;
  }
}

export async function searchPlantByName(
  q: string,
  options?: { limit?: number; language?: string } & LocationOptions
) {
  const coordinates = await resolveCoordinates(options);

  return invokeFunction<{
    entities: PlantNameMatch[];
    entities_trimmed: boolean;
    limit: number;
  }>('search-plant-name', {
    q,
    limit: options?.limit ?? 20,
    language: options?.language,
    ...coordinates,
  });
}

export async function previewPlantByName(
  accessToken: string,
  options?: { language?: string } & LocationOptions
) {
  const coordinates = await resolveCoordinates(options);

  return invokeFunction<{
    added: false;
    info: PlantBasicInfo;
  }>('search-plant-name', {
    access_token: accessToken,
    save: false,
    language: options?.language,
    ...coordinates,
  });
}

export async function previewPlantByPhoto(images: string[], options?: LocationOptions) {
  const coordinates = await resolveCoordinates(options);

  return invokeFunction<{
    added: false;
    info: PlantBasicInfo;
    is_plant: { binary?: boolean; probability?: number } | null;
    identification_access_token: string | null;
    similar_images: PlantSimilarImage[];
    suggestions: { id: string | null; name: string | null; probability: number | null }[];
  }>('identify-plant-photo', {
    images,
    save: false,
    ...coordinates,
  });
}

export async function confirmAddPlant(plantId: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }
  if (!user) {
    throw new Error('You need to be signed in to add a plant');
  }

  const { data, error } = await supabase
    .from('plants')
    .insert({ user_id: user.id, plant_id: plantId })
    .select('id, user_id, plant_id, created_at')
    .single();

  if (error) {
    throw error;
  }

  return data as UserPlant;
}
