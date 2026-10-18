import type { PlantBasicInfo } from '@/utils/plants';
import { supabase } from '@/utils/supabase';

/**
 * Plant.id `watering` is how wet the soil should stay: 1 dry, 2 medium, 3 wet.
 * Wetter soil leaves the target range sooner, so the gap between waterings is shorter.
 */
const WATERING_INTERVAL_DAYS: Record<string, number> = {
  '1-1': 14,
  '1-2': 10,
  '1-3': 7,
  '2-2': 7,
  '2-3': 4,
  '3-3': 3,
};

export type WateringIndex = PlantBasicInfo['watering'];

export type PlantWateringStatus = {
  lastWateredOn: string | null;
  wateredToday: boolean;
  needsWater: boolean;
  intervalDays: number | null;
  startDate: string;
  nextWateringOn: string | null;
};

type SchedulablePlant = {
  created_at: string;
  info?: { watering?: WateringIndex } | null;
};

/** Calendar day in the device timezone, as YYYY-MM-DD. */
export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function wateringIntervalDays(watering: WateringIndex | undefined) {
  if (!watering) {
    return null;
  }

  const min = watering.min ?? watering.max;
  const max = watering.max ?? watering.min;
  if (min == null || max == null || min < 1 || max > 3 || min > max) {
    return null;
  }

  return WATERING_INTERVAL_DAYS[`${min}-${max}`] ?? null;
}

export function wateringFrequencyLabel(intervalDays: number) {
  return intervalDays === 1 ? 'Every day' : `Every ${intervalDays} days`;
}

/** Local calendar day a plant was added. That day is the first scheduled watering. */
export function wateringStartDate(createdAt: string) {
  const added = new Date(createdAt);
  if (Number.isNaN(added.getTime())) {
    return localDateKey();
  }
  return localDateKey(added);
}

export function addCalendarDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

export function calendarDaysBetween(from: string, to: string) {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  const start = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const end = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.round((end - start) / 86_400_000);
}

export function plantWateringSchedule(
  plant: SchedulablePlant,
  lastWateredOn: string | null,
  today = localDateKey()
): PlantWateringStatus {
  const startDate = wateringStartDate(plant.created_at);
  const intervalDays = wateringIntervalDays(plant.info?.watering);
  const wateredToday = lastWateredOn === today;

  if (intervalDays == null) {
    return {
      lastWateredOn,
      wateredToday,
      needsWater: false,
      intervalDays: null,
      startDate,
      nextWateringOn: null,
    };
  }

  let nextWateringOn: string;
  if (wateredToday) {
    nextWateringOn = addCalendarDays(today, intervalDays);
  } else if (lastWateredOn) {
    const due = addCalendarDays(lastWateredOn, intervalDays);
    nextWateringOn = due < today ? today : due;
  } else {
    nextWateringOn = startDate < today ? today : startDate;
  }

  return {
    lastWateredOn,
    wateredToday,
    needsWater: nextWateringOn <= today,
    intervalDays,
    startDate,
    nextWateringOn,
  };
}

/** True when `dateKey` is this plant's next watering day, or a later day on the same cadence. */
export function isScheduledWateringDay(status: PlantWateringStatus, dateKey: string) {
  if (status.intervalDays == null || status.nextWateringOn == null || dateKey < status.nextWateringOn) {
    return false;
  }

  return calendarDaysBetween(status.nextWateringOn, dateKey) % status.intervalDays === 0;
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

export async function listLatestWateringDates() {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('plant_watering_logs')
    .select('plant_id, watered_on')
    .eq('user_id', userId)
    .order('watered_on', { ascending: false });

  if (error) {
    throw asError(error, 'Could not load watering logs');
  }

  const latest = new Map<string, string>();
  for (const row of data ?? []) {
    const plantId = String(row.plant_id);
    if (!latest.has(plantId)) {
      latest.set(plantId, String(row.watered_on));
    }
  }
  return latest;
}

export async function getPlantWateringStatus(
  plant: SchedulablePlant & { id: string },
  today = localDateKey()
): Promise<PlantWateringStatus> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('plant_watering_logs')
    .select('watered_on')
    .eq('user_id', userId)
    .eq('plant_id', plant.id)
    .order('watered_on', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw asError(error, 'Could not load watering logs');
  }

  const lastWateredOn = data?.watered_on ? String(data.watered_on) : null;
  return plantWateringSchedule(plant, lastWateredOn, today);
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
