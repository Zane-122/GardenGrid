import { getGardenCoordinates } from './location';
import { supabase } from './supabase';

export type PlantNameMatch = {
  matched_in: string;
  matched_in_type: string;
  access_token: string;
  match_position: number;
  match_length: number;
  entity_name: string;
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

type LocationOptions = {
  latitude?: number;
  longitude?: number;
};

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
    throw error;
  }

  return data;
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
    limit: options?.limit,
    language: options?.language,
    ...coordinates,
  });
}

export async function addPlantByName(
  accessToken: string,
  options?: { language?: string } & LocationOptions
) {
  const coordinates = await resolveCoordinates(options);

  return invokeFunction<{
    added: true;
    plant: UserPlant;
    info: PlantBasicInfo;
  }>('search-plant-name', {
    access_token: accessToken,
    language: options?.language,
    ...coordinates,
  });
}

export async function identifyPlantByPhoto(
  images: string[],
  options?: LocationOptions
) {
  const coordinates = await resolveCoordinates(options);

  return invokeFunction<{
    added: true;
    plant: UserPlant;
    info: PlantBasicInfo;
    is_plant: { binary?: boolean; probability?: number } | null;
    identification_access_token: string | null;
    suggestions: { id: string | null; name: string | null; probability: number | null }[];
  }>('identify-plant-photo', {
    images,
    ...coordinates,
  });
}
