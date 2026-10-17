import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { hoursToCredit, plantHoursToCredit } from '../_shared/accrue-hours.ts';
import { json } from '../_shared/plants.ts';
import { calculateHourlyOxygen } from '../_shared/oxygen-calc.ts';
import { getPlantStatus, type LatestObservation } from '../_shared/plant-status.ts';

/** Weather-derived light level (0-1) will replace this; until then every plant gets full light. */
export const LIGHT_FACTOR_PLACEHOLDER = 1;

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
 * Oxygen (mL) the user's plants produce over `hours`, with each plant's hours
 * limited to the time since its created_at.
 */
async function accruedOxygenMl(admin: SupabaseClient, userId: string, now: Date, hours: number): Promise<number> {
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

      const basicInfo = Array.isArray(plant.plant_basic_info) ? plant.plant_basic_info[0] : plant.plant_basic_info;
      const status = getPlantStatus(plant, basicInfo, observation as LatestObservation | null, now);
      if (!status) {
        return 0;
      }
      const plantHours = plantHoursToCredit(hours, plant.created_at, now);
      return calculateHourlyOxygen(status.leafAreaCm2, status.healthScore, LIGHT_FACTOR_PLACEHOLDER) * plantHours;
    })
  );

  return perPlant.reduce((sum, ml) => sum + ml, 0);
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

  if (expectedLast != null) {
    const hours = hoursToCredit(expectedLast, now);
    if (Number.isNaN(hours)) {
      throw new Error(`Unparseable oxygen_accrued_at: ${expectedLast}`);
    }
    if (hours <= 0) {
      return { credited: false, ml: 0, conflicted: false };
    }
    amountMl = await accruedOxygenMl(admin, userId, now, hours);
  }
  // No oxygen_accrued_at yet: start the clock now with no retroactive credit.

  const { data: applied, error: creditError } = await admin.rpc('credit_oxygen', {
    p_user_id: userId,
    p_amount: amountMl,
    p_expected_last: expectedLast,
    p_new_last: now.toISOString(),
  });
  if (creditError) {
    throw new Error(`credit_oxygen failed: ${creditError.message}`);
  }
  if (applied !== true) {
    return { credited: false, ml: 0, conflicted: true };
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
