import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { hoursToCredit, plantHoursToCredit } from '../_shared/accrue-hours.ts';
import { json } from '../_shared/plants.ts';
import { calculateHourlyOxygen } from '../_shared/oxygen-calc.ts';
import { fetchHourlyGardenWeather } from '../_shared/open-meteo.ts';
import { plantPhotoFreshness } from '../_shared/observation-freshness.ts';
import { getPlantStatus, type LatestObservation } from '../_shared/plant-status.ts';
import { estimatedSunlightIndex, latestSunlightIndex } from '../_shared/sunlight-index.ts';

const MS_PER_HOUR = 3_600_000;

const PAGE_SIZE = 1000;

/** Constant-time string comparison so the secret can't be probed by timing. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get('ACCRUE_SECRET');
  if (!expected) {
    return false;
  }
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  return match != null && secretsMatch(match[1], expected);
}

function createAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase service credentials');
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Every distinct user_id that owns at least one plant. */
async function loadUserIds(admin: SupabaseClient): Promise<string[]> {
  const userIds = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from('plants')
      .select('user_id')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Failed to load plant owners: ${error.message}`);
    }
    for (const row of data ?? []) {
      userIds.add(row.user_id as string);
    }
    if ((data?.length ?? 0) < PAGE_SIZE) {
      return [...userIds];
    }
  }
}

/**
 * Latest hourly sunlight index at or before `now`. If that reading is missing,
 * estimate daylight from the time and the garden's location.
 */
async function sunlightForUser(admin: SupabaseClient, userId: string, now: Date): Promise<number> {
  const { data, error } = await admin
    .from('profiles')
    .select('garden_latitude, garden_longitude')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error(`accrue-oxygen: location lookup failed for ${userId}: ${error.message}`);
    return estimatedSunlightIndex(now, null, null);
  }

  const latitude = typeof data?.garden_latitude === 'number' ? data.garden_latitude : null;
  const longitude = typeof data?.garden_longitude === 'number' ? data.garden_longitude : null;
  if (latitude == null || longitude == null) {
    const estimate = estimatedSunlightIndex(now, null, null);
    console.error(`accrue-oxygen: no garden location for ${userId}; estimating ${estimate} from the time`);
    return estimate;
  }

  try {
    const weather = await fetchHourlyGardenWeather(latitude, longitude);
    const index = latestSunlightIndex(weather, now);
    if (index == null) {
      const estimate = estimatedSunlightIndex(now, latitude, longitude);
      console.error(`accrue-oxygen: no sunlight readings for ${userId}; estimating ${estimate} from the time`);
      return estimate;
    }
    return index;
  } catch (error) {
    const estimate = estimatedSunlightIndex(now, latitude, longitude);
    console.error(`accrue-oxygen: Open-Meteo failed for ${userId}; estimating ${estimate} from the time:`, error);
    return estimate;
  }
}

type PlantOxygen = { plantId: string; ml: number };

/**
 * Oxygen (mL) each of the user's plants produces over `hours`, with each
 * plant's hours limited to the time since its created_at and scaled by photo freshness.
 */
async function accruedOxygenByPlant(
  admin: SupabaseClient,
  userId: string,
  now: Date,
  hours: number,
  lightFactor: number
): Promise<PlantOxygen[]> {
  const { data: plants, error } = await admin
    .from('plants')
    .select('id, plant_id, created_at, plant_basic_info(*)')
    .eq('user_id', userId);
  if (error) {
    throw new Error(`Failed to load plants: ${error.message}`);
  }

  const perPlant = await Promise.all(
    (plants ?? []).map(async (plant) => {
      const { data: observation, error: observationError } = await admin
        .from('plant_health_info')
        .select('*')
        .eq('plant_id', plant.id)
        .order('observed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (observationError) {
        throw new Error(`Failed to load health info for plant ${plant.id}: ${observationError.message}`);
      }

      // Latest real photo analysis (baseline rows have a null estimated_fullness_pct).
      const { data: lastPhoto, error: lastPhotoError } = await admin
        .from('plant_health_info')
        .select('observed_at')
        .eq('plant_id', plant.id)
        .not('estimated_fullness_pct', 'is', null)
        .order('observed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastPhotoError) {
        throw new Error(`Failed to load last photo for plant ${plant.id}: ${lastPhotoError.message}`);
      }

      const basicInfo = Array.isArray(plant.plant_basic_info) ? plant.plant_basic_info[0] : plant.plant_basic_info;
      const status = getPlantStatus(plant, basicInfo, observation as LatestObservation | null, now);
      if (!status) {
        return { plantId: plant.id, ml: 0 };
      }
      const plantHours = plantHoursToCredit(hours, plant.created_at, now);
      const freshness = plantPhotoFreshness(lastPhoto?.observed_at, plant.created_at, now);
      return {
        plantId: plant.id,
        ml: calculateHourlyOxygen(status.leafAreaCm2, status.healthScore, lightFactor) * plantHours * freshness,
      };
    })
  );

  return perPlant;
}

type AccrueResult = { credited: boolean; ml: number; conflicted: boolean };

async function accrueUser(admin: SupabaseClient, userId: string, now: Date): Promise<AccrueResult> {
  const { data: currency, error } = await admin
    .from('user_currency')
    .select('oxygen_accrued_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load user_currency: ${error.message}`);
  }

  const expectedLast: string | null = currency?.oxygen_accrued_at ?? null;
  let amountMl = 0;
  let plantOxygen: PlantOxygen[] = [];

  if (expectedLast != null) {
    const hours = hoursToCredit(expectedLast, now);
    if (Number.isNaN(hours)) {
      throw new Error(`Unparseable oxygen_accrued_at: ${expectedLast}`);
    }
    if (hours <= 0) {
      return { credited: false, ml: 0, conflicted: false };
    }
    const lightFactor = await sunlightForUser(admin, userId, now);
    plantOxygen = await accruedOxygenByPlant(admin, userId, now, hours, lightFactor);
    amountMl = plantOxygen.reduce((sum, plant) => sum + plant.ml, 0);
  }
  // No oxygen_accrued_at yet: start the clock now with no retroactive credit.

  const { data: applied, error: creditError } = await admin.rpc('credit_oxygen', {
    p_user_id: userId,
    p_amount: amountMl,
    p_expected_last: expectedLast,
    p_new_last: now.toISOString(),
    p_plant_oxygen: plantOxygen
      .filter((plant) => plant.ml > 0)
      .map((plant) => ({ plant_id: plant.plantId, ml: plant.ml })),
  });
  if (creditError) {
    throw new Error(`credit_oxygen failed: ${creditError.message}`);
  }
  if (applied !== true) {
    return { credited: false, ml: 0, conflicted: true };
  }

  const communityPlants = plantOxygen.filter((plant) => plant.ml > 0);
  if (communityPlants.length > 0) {
    const { error: communityError } = await admin.rpc('credit_community_garden_oxygen', {
      p_user_id: userId,
      p_plant_oxygen: communityPlants.map((plant) => ({ plant_id: plant.plantId, ml: plant.ml })),
    });
    if (communityError) {
      throw new Error(`credit_community_garden_oxygen failed: ${communityError.message}`);
    }
  }

  return { credited: amountMl > 0, ml: amountMl, conflicted: false };
}

Deno.serve(async (req: Request) => {
  if (!isAuthorized(req)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const admin = createAdminClient();
    const now = new Date();
    const userIds = await loadUserIds(admin);

    let usersProcessed = 0;
    let usersCredited = 0;
    let usersConflicted = 0;
    let totalMlCredited = 0;
    const errors: { user_id: string; error: string }[] = [];

    for (const userId of userIds) {
      try {
        const result = await accrueUser(admin, userId, now);
        usersProcessed += 1;
        if (result.credited) {
          usersCredited += 1;
          totalMlCredited += result.ml;
        }
        if (result.conflicted) {
          usersConflicted += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`accrue-oxygen: user ${userId} failed:`, message);
        errors.push({ user_id: userId, error: message });
      }
    }

    return json({
      users_processed: usersProcessed,
      users_credited: usersCredited,
      users_skipped_conflict: usersConflicted,
      total_ml_credited: totalMlCredited,
      errors,
    });
  } catch (error) {
    console.error('accrue-oxygen: run failed:', error);
    return json({ error: error instanceof Error ? error.message : 'Accrual run failed' }, 500);
  }
});
