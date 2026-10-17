import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { analyzePlantHealth } from './health-analysis-llm.ts';
import { solveXForFullness, type GrowthCurveParams } from './growth-curve.ts';
import { generateGrowthParamsFromPhoto } from './growth-params-from-photo-llm.ts';
import type { GeneratedGrowthParams } from './growth-params-llm.ts';
import { decodePlantImage, ensureGrowthParams, type PlantBasicInfoRow } from './plants.ts';

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Estimates a newly added plant's curve position (x) from its first photo,
 * using the species growth params, and saves it as the plant's
 * current_x_position plus a real plant_health_info observation (which
 * supersedes the x=0 baseline row). Best-effort: never throws, and leaves the
 * plant at the baseline if the analysis or solve fails.
 */
export async function estimateInitialPosition(
  admin: SupabaseClient,
  plantId: string,
  baseInfo: PlantBasicInfoRow,
  image: string,
  photoPath: string | null
): Promise<void> {
  try {
    // Species params are normally generated when the species is cached; retry
    // here if that failed, so the first photo can still produce a curve.
    const info = await ensureGrowthParams(admin, baseInfo);
    if (
      !info.growth_mode ||
      info.l == null ||
      info.k == null ||
      info.x0 == null ||
      info.xg == null ||
      info.kg == null ||
      info.carbon_fraction == null
    ) {
      return;
    }

    const speciesParams: GeneratedGrowthParams = {
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
      carbon_fraction: info.carbon_fraction,
      confidence: info.confidence ?? 0.5,
    };

    const { bytes, contentType } = await decodePlantImage(image);
    const imageBase64 = encodeBase64(bytes);
    const health = await analyzePlantHealth(imageBase64, contentType, info.scientific_name);
    if (!health) {
      return;
    }

    // First photo: correct the species params using the photo. Later photos
    // (update-plant-photo) refine this plant's own curve further.
    const photoParams = await generateGrowthParamsFromPhoto(
      imageBase64,
      contentType,
      info.scientific_name,
      info.common_names?.[0] ?? null,
      speciesParams,
      null,
      0,
      false,
      null
    );
    const params = photoParams ?? speciesParams;

    const x = solveXForFullness(params, health.fullness_pct);
    if (!Number.isFinite(x)) {
      return;
    }

    const now = new Date().toISOString();
    const { error: plantError } = await admin
      .from('plants')
      .update({ current_x_position: x, last_recalibrated_at: now })
      .eq('id', plantId);
    if (plantError) {
      console.error(`estimateInitialPosition: ${plantError.message}`);
      return;
    }

    const { error: healthError } = await admin.from('plant_health_info').insert({
      plant_id: plantId,
      photo_path: photoPath,
      observed_at: now,
      estimated_fullness_pct: health.fullness_pct,
      estimated_health_score: health.health_score,
      resolved_x_position: x,
      growth_mode: params.growth_mode,
      l: params.l,
      k: params.k,
      x0: params.x0,
      xg: params.xg,
      kg: params.kg,
      xs: params.xs,
      ks: params.ks,
      f: params.f,
      r: params.r,
      cycle_length: params.cycle_length,
      b_base: params.b_base,
      l_season: params.l_season,
      carbon_fraction: params.carbon_fraction,
    });
    if (healthError) {
      console.error(`estimateInitialPosition health insert: ${healthError.message}`);
    }
  } catch (error) {
    console.error('estimateInitialPosition failed:', error);
  }
}
