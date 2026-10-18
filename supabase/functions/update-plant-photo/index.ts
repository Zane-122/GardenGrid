import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import {
  corsHeaders,
  decodePlantImage,
  ensureGrowthParams,
  json,
  requireUser,
  uploadPlantPhoto,
  type PlantBasicInfoRow,
} from '../_shared/plants.ts';
import { analyzePlantHealth } from '../_shared/health-analysis-llm.ts';
import { generateGrowthParamsFromPhoto } from '../_shared/growth-params-from-photo-llm.ts';
import type { GeneratedGrowthParams } from '../_shared/growth-params-llm.ts';
import { solveXForFullness, type GrowthCurveParams } from '../_shared/growth-curve.ts';
import { paramsFromObservation, predictFullnessPct, type LatestObservation } from '../_shared/plant-status.ts';
import { generateFlowerPollenParams, type FlowerPollenConstants } from '../_shared/flower-pollen.ts';

type UpdatePlantPhotoBody = {
  plant_id?: string;
  photo?: string;
};

type PlantRow = {
  id: string;
  user_id: string;
  plant_id: string;
  created_at: string;
  photo_path: string | null;
  current_x_position: number | null;
  last_recalibrated_at: string | null;
  flower_ratio: number | null;
  pollen_per_flower_mg: number | null;
  plant_basic_info: PlantBasicInfoRow;
};

function toGrowthCurveParams(info: PlantBasicInfoRow): GrowthCurveParams | null {
  if (!info.growth_mode || info.l == null || info.k == null || info.x0 == null || info.xg == null || info.kg == null) {
    return null;
  }

  return {
    growth_mode: info.growth_mode,
    l: info.l,
    k: info.k,
    x0: info.x0,
    xg: info.xg,
    kg: info.kg,
    ks: info.ks,
    xs: info.xs,
    f: info.f,
    r: info.r,
    cycle_length: info.cycle_length,
    b_base: info.b_base,
    l_season: info.l_season,
  };
}

type GrowthParamFields = {
  growth_mode: GrowthCurveParams['growth_mode'] | null;
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
};

// plant_health_info rows don't store a confidence value (it's not something
// we ever act on for a past observation), so a fallback is used when
// building a reference object from one.
function toGeneratedGrowthParams(
  fields: GrowthParamFields,
  confidence: number
): GeneratedGrowthParams | null {
  if (
    !fields.growth_mode ||
    fields.l == null ||
    fields.k == null ||
    fields.x0 == null ||
    fields.xg == null ||
    fields.kg == null ||
    fields.carbon_fraction == null
  ) {
    return null;
  }

  return {
    growth_mode: fields.growth_mode,
    l: fields.l,
    k: fields.k,
    x0: fields.x0,
    xg: fields.xg,
    kg: fields.kg,
    ks: fields.ks,
    xs: fields.xs,
    f: fields.f,
    r: fields.r,
    cycle_length: fields.cycle_length,
    b_base: fields.b_base,
    l_season: fields.l_season,
    carbon_fraction: fields.carbon_fraction,
    confidence,
  };
}

function daysBetween(earlier: string, later: Date): number {
  return Math.round((later.getTime() - new Date(earlier).getTime()) / 86_400_000);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { user, admin } = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as UpdatePlantPhotoBody;

    const plantInstanceId = typeof body.plant_id === 'string' ? body.plant_id.trim() : '';
    const photo = typeof body.photo === 'string' ? body.photo.trim() : '';

    if (!plantInstanceId) {
      return json({ error: 'plant_id is required' }, 400);
    }
    if (!photo) {
      return json({ error: 'photo is required' }, 400);
    }

    const { data: plantRow, error: plantError } = await admin
      .from('plants')
      .select('*, plant_basic_info(*)')
      .eq('id', plantInstanceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (plantError) {
      return json({ error: `Failed to load plant: ${plantError.message}` }, 500);
    }
    if (!plantRow) {
      return json({ error: 'Plant not found' }, 404);
    }

    let plant = plantRow as PlantRow;
    let basicInfo = plant.plant_basic_info;

    const { bytes, contentType } = await decodePlantImage(photo);
    const imageBase64 = encodeBase64(bytes);
    const previousFlower: FlowerPollenConstants | null =
      plant.flower_ratio != null && plant.pollen_per_flower_mg != null
        ? { flower_ratio: plant.flower_ratio, pollen_per_flower_mg: plant.pollen_per_flower_mg }
        : null;
    const flowerPromise = generateFlowerPollenParams(
      imageBase64,
      contentType,
      basicInfo.scientific_name,
      basicInfo.common_names?.[0] ?? null,
      previousFlower
    );

    const health = await analyzePlantHealth(imageBase64, contentType, basicInfo.scientific_name);

    const photoResult = await uploadPlantPhoto(admin, plant.id, photo);

    if (!health) {
      const flowerParams = await flowerPromise;
      const plantUpdate: Record<string, unknown> = { photo_path: photoResult.path };
      if (flowerParams) {
        plantUpdate.flower_ratio = flowerParams.flower_ratio;
        plantUpdate.pollen_per_flower_mg = flowerParams.pollen_per_flower_mg;
      } else {
        console.error(`update-plant-photo: no flower pollen constants for plant ${plant.id}`);
      }
      const { data: updatedPlant, error: updateError } = await admin
        .from('plants')
        .update(plantUpdate)
        .eq('id', plant.id)
        .select('*, plant_basic_info(*)')
        .single();

      if (updateError) {
        return json({ error: `Failed to link plant photo: ${updateError.message}` }, 500);
      }

      return json({
        plant: updatedPlant,
        health_info: null,
        analysis_failed: true,
      });
    }

    const now = new Date();

    const { data: lastHealthInfo, error: lastHealthInfoError } = await admin
      .from('plant_health_info')
      .select(
        'observed_at, resolved_x_position, estimated_fullness_pct, estimated_health_score, growth_mode, l, k, x0, xg, kg, xs, ks, f, r, cycle_length, b_base, l_season, carbon_fraction'
      )
      .eq('plant_id', plant.id)
      .order('observed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastHealthInfoError) {
      return json({ error: `Failed to load prior plant health info: ${lastHealthInfoError.message}` }, 500);
    }

    let previousParams: GeneratedGrowthParams | null = null;
    let daysSinceLastObservation: number | null = null;
    let isRealPriorObservation = false;
    let previousPredictedFullnessPct: number | null = null;

    // Baseline rows (seeded when the plant was added) have a null
    // estimated_fullness_pct and are not real prior observations.
    if (lastHealthInfo?.growth_mode && lastHealthInfo.estimated_fullness_pct != null) {
      previousParams = toGeneratedGrowthParams(lastHealthInfo, 0.5);
      if (previousParams) {
        daysSinceLastObservation = daysBetween(lastHealthInfo.observed_at, now);
        isRealPriorObservation = true;

        // Computed in code (not by the AI): where the previous curve says the
        // plant should be today, i.e. x = previous resolved_x_position + days
        // since that observation.
        previousPredictedFullnessPct = predictFullnessPct(
          paramsFromObservation(lastHealthInfo as LatestObservation),
          lastHealthInfo.resolved_x_position,
          lastHealthInfo.observed_at,
          now
        );
      }
    }

    if (!previousParams && basicInfo.growth_mode) {
      previousParams = toGeneratedGrowthParams(basicInfo, basicInfo.confidence ?? 0.5);
      daysSinceLastObservation = null;
      isRealPriorObservation = false;
    }

    const plantAgeInDays = daysBetween(plant.created_at, now);

    const photoGrowthParams = await generateGrowthParamsFromPhoto(
      imageBase64,
      contentType,
      basicInfo.scientific_name,
      basicInfo.common_names?.[0] ?? null,
      previousParams,
      daysSinceLastObservation,
      plantAgeInDays,
      isRealPriorObservation,
      previousPredictedFullnessPct
    );

    // Solve against the NEW photo-based params. Only if the photo analysis
    // failed, fall back (best-effort) to the species params from
    // plant_basic_info.
    let growthParams: GrowthCurveParams | null = photoGrowthParams;

    if (!growthParams) {
      growthParams = toGrowthCurveParams(basicInfo);

      // Growth params are normally generated when the species is first cached
      // (see cachePlantInfo in plants.ts). If they're still missing here,
      // retry generation now — this should be a rare fallback.
      if (!growthParams) {
        try {
          basicInfo = await ensureGrowthParams(admin, basicInfo);
          growthParams = toGrowthCurveParams(basicInfo);
        } catch (error) {
          console.error('ensureGrowthParams failed; skipping x-position solve:', error);
        }
      }
    }

    const resolvedXPosition = growthParams ? solveXForFullness(growthParams, health.fullness_pct) : null;

    const flowerParams = await flowerPromise;
    if (!flowerParams) {
      console.error(`update-plant-photo: no flower pollen constants for plant ${plant.id}`);
    }

    const plantUpdate: Record<string, unknown> = { photo_path: photoResult.path };
    if (resolvedXPosition != null) {
      plantUpdate.current_x_position = resolvedXPosition;
      plantUpdate.last_recalibrated_at = now.toISOString();
    }
    if (flowerParams) {
      plantUpdate.flower_ratio = flowerParams.flower_ratio;
      plantUpdate.pollen_per_flower_mg = flowerParams.pollen_per_flower_mg;
    }

    const { data: updatedPlant, error: updateError } = await admin
      .from('plants')
      .update(plantUpdate)
      .eq('id', plant.id)
      .select('*, plant_basic_info(*)')
      .single();

    if (updateError) {
      return json({ error: `Failed to link plant photo: ${updateError.message}` }, 500);
    }
    plant = updatedPlant as PlantRow;

    // Save the photo params exactly as the AI returned them. If the photo
    // analysis failed, save the species params instead (the same ones
    // resolved_x_position was solved against) so every row has a usable curve.
    const paramsToSave: Partial<GrowthParamFields> | null =
      photoGrowthParams ?? (basicInfo.growth_mode ? basicInfo : null);

    const { data: healthInfo, error: healthInfoError } = await admin
      .from('plant_health_info')
      .insert({
        plant_id: plant.id,
        photo_path: photoResult.path,
        observed_at: now.toISOString(),
        estimated_fullness_pct: health.fullness_pct,
        estimated_health_score: health.health_score,
        resolved_x_position: resolvedXPosition,
        ...(paramsToSave
          ? {
              growth_mode: paramsToSave.growth_mode,
              l: paramsToSave.l,
              k: paramsToSave.k,
              x0: paramsToSave.x0,
              xg: paramsToSave.xg,
              kg: paramsToSave.kg,
              xs: paramsToSave.xs,
              ks: paramsToSave.ks,
              f: paramsToSave.f,
              r: paramsToSave.r,
              cycle_length: paramsToSave.cycle_length,
              b_base: paramsToSave.b_base,
              l_season: paramsToSave.l_season,
              carbon_fraction: paramsToSave.carbon_fraction,
            }
          : {}),
        ...(flowerParams
          ? {
              flower_ratio: flowerParams.flower_ratio,
              pollen_per_flower_mg: flowerParams.pollen_per_flower_mg,
            }
          : {}),
      })
      .select()
      .single();

    if (healthInfoError) {
      return json({ error: `Failed to save plant health info: ${healthInfoError.message}` }, 500);
    }

    return json({
      plant,
      health_info: healthInfo,
      analysis_failed: false,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return json(
      { error: error instanceof Error ? error.message : 'Failed to update plant photo' },
      500
    );
  }
});
