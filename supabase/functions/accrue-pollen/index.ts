import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { createClient } from 'jsr:@supabase/supabase-js@2';

import {
  flowerCountFromLeafArea,
  pollenIntervalElapsed,
  pollenMassMg,
  seasonalBloomMultiplier,
} from '../_shared/flower-pollen.ts';
import { plantPhotoFreshness } from '../_shared/observation-freshness.ts';
import { getPlantStatus, type LatestObservation } from '../_shared/plant-status.ts';

const POLLEN_ACCRUAL_SECRET = 'kR7mQ2vL9pX4nW8sT1cY6bH3dF5aJ0eU';

type PlantRow = {
  id: string;
  user_id: string;
  created_at: string;
  flower_ratio: number | null;
  pollen_per_flower_mg: number | null;
  last_pollen_credited_at: string | null;
};

type HealthRow = LatestObservation & { plant_id: string; estimated_fullness_pct: number | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authorized(req: Request) {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const secret = Deno.env.get('POLLEN_ACCRUAL_SECRET')?.trim() || POLLEN_ACCRUAL_SECRET;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  return token.length > 0 && (token === secret || token === serviceKey);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }
  if (!authorized(req)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  if (!url || !serviceKey) {
    return json({ error: 'Supabase environment is not configured' }, 500);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date();

  const { data: plantRows, error: plantError } = await admin
    .from('plants')
    .select('id, user_id, created_at, flower_ratio, pollen_per_flower_mg, last_pollen_credited_at')
    .not('flower_ratio', 'is', null);

  if (plantError) {
    return json({ error: plantError.message }, 500);
  }

  const plants = (plantRows ?? []) as PlantRow[];
  if (plants.length === 0) {
    return json({ updated: 0, credited: 0 });
  }

  const { data: healthRows, error: healthError } = await admin
    .from('plant_health_info')
    .select(
      'plant_id, observed_at, estimated_fullness_pct, resolved_x_position, estimated_health_score, growth_mode, l, k, x0, xg, kg, ks, xs, f, r, cycle_length, b_base, l_season'
    )
    .in('plant_id', plants.map((plant) => plant.id))
    .order('observed_at', { ascending: false });

  if (healthError) {
    return json({ error: healthError.message }, 500);
  }

  const latest = new Map<string, HealthRow>();
  for (const row of (healthRows ?? []) as HealthRow[]) {
    if (!latest.has(row.plant_id)) {
      latest.set(row.plant_id, row);
    }
  }

  // Rows are newest-first, so the first non-null-fullness row per plant is its
  // last real photo analysis (baseline rows have null fullness).
  const lastPhoto = new Map<string, string>();
  for (const row of (healthRows ?? []) as HealthRow[]) {
    if (row.estimated_fullness_pct != null && !lastPhoto.has(row.plant_id)) {
      lastPhoto.set(row.plant_id, row.observed_at);
    }
  }

  const credits = new Map<string, { plantId: string; mg: number }[]>();
  let updated = 0;
  let credited = 0;

  for (const plant of plants) {
    const status = getPlantStatus(null, null, latest.get(plant.id) ?? null, now);
    const flowers = flowerCountFromLeafArea(status?.leafAreaCm2 ?? 0, plant.flower_ratio ?? 0);
    const plantUpdate: Record<string, unknown> = {
      flower_count: flowers,
      flower_count_updated_at: now.toISOString(),
    };

    const due = plant.last_pollen_credited_at == null || pollenIntervalElapsed(plant.last_pollen_credited_at, now);
    if (due) {
      plantUpdate.last_pollen_credited_at = now.toISOString();
      if (plant.last_pollen_credited_at != null) {
        const massMg =
          pollenMassMg(flowers, plant.pollen_per_flower_mg ?? 0) *
          plantPhotoFreshness(lastPhoto.get(plant.id), plant.created_at, now) *
          seasonalBloomMultiplier(now);
        if (massMg > 0) {
          const earned = credits.get(plant.user_id) ?? [];
          earned.push({ plantId: plant.id, mg: massMg });
          credits.set(plant.user_id, earned);
        }
        credited += 1;
      }
    }

    const { error: updateError } = await admin.from('plants').update(plantUpdate).eq('id', plant.id);
    if (updateError) {
      console.error(`accrue-pollen: plant ${plant.id}: ${updateError.message}`);
      continue;
    }
    updated += 1;
  }

  for (const [userId, earned] of credits) {
    const amount = earned.reduce((sum, plant) => sum + plant.mg, 0);
    const { error: creditError } = await admin.rpc('credit_user_pollen', {
      target_user_id: userId,
      amount,
      plant_pollen: earned.map((plant) => ({ plant_id: plant.plantId, mg: plant.mg })),
    });
    if (creditError) {
      console.error(`accrue-pollen: credit ${userId}: ${creditError.message}`);
    }
  }

  return json({ updated, credited, users: credits.size });
});
