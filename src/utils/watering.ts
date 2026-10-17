import { supabase } from '@/utils/supabase';

export type PlantWateringStatus = {
  lastWateredOn: string | null;
  wateredToday: boolean;
};

/** Calendar day in the device timezone, as YYYY-MM-DD. */
export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatWateredOn(wateredOn: string) {
  const [year, month, day] = wateredOn.split('-').map(Number);
  if (!year || !month || !day) {
    return wateredOn;
  }

  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    dateStyle: 'medium',
  });
}

async function requireUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }
  if (!user) {
    throw new Error('You need to be signed in to track watering');
  }

  return user.id;
}

function asError(error: { message?: string } | null, fallback: string) {
  return new Error(error?.message || fallback);
}

export type WateringLog = {
  plantId: string;
  wateredOn: string;
};

export async function listWateringLogs(from: string, to: string) {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('plant_watering_logs')
    .select('plant_id, watered_on')
    .eq('user_id', userId)
    .gte('watered_on', from)
    .lte('watered_on', to)
    .order('watered_on', { ascending: true });

  if (error) {
    throw asError(error, 'Could not load watering logs');
  }

  return (data ?? []).map((row) => ({
    plantId: String(row.plant_id),
    wateredOn: String(row.watered_on),
  })) satisfies WateringLog[];
}

export async function listWateredPlantIds(wateredOn = localDateKey()) {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('plant_watering_logs')
    .select('plant_id')
    .eq('user_id', userId)
    .eq('watered_on', wateredOn);

  if (error) {
    throw asError(error, 'Could not load watering logs');
  }

  return new Set((data ?? []).map((row) => String(row.plant_id)));
}

export async function getPlantWateringStatus(plantId: string, today = localDateKey()): Promise<PlantWateringStatus> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('plant_watering_logs')
    .select('watered_on')
    .eq('user_id', userId)
    .eq('plant_id', plantId)
    .order('watered_on', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw asError(error, 'Could not load watering logs');
  }

  const lastWateredOn = data?.watered_on ? String(data.watered_on) : null;
  return {
    lastWateredOn,
    wateredToday: lastWateredOn === today,
  };
}

export async function markPlantsWatered(plantIds: string[], wateredOn = localDateKey()) {
  const uniqueIds = [...new Set(plantIds)];
  if (uniqueIds.length === 0) {
    return;
  }

  const userId = await requireUserId();
  const { error } = await supabase.from('plant_watering_logs').upsert(
    uniqueIds.map((plantId) => ({
      user_id: userId,
      plant_id: plantId,
      watered_on: wateredOn,
    })),
    { onConflict: 'plant_id,watered_on', ignoreDuplicates: true }
  );

  if (error) {
    throw asError(error, 'Could not mark plants as watered');
  }
}
