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
import { solveXForFullness, type GrowthCurveParams } from '../_shared/growth-curve.ts';

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

    const health = await analyzePlantHealth(imageBase64, contentType, basicInfo.scientific_name);

    const photoResult = await uploadPlantPhoto(admin, plant.id, photo);

    if (!health) {
      const { data: updatedPlant, error: updateError } = await admin
        .from('plants')
        .update({ photo_path: photoResult.path })
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

    let growthParams = toGrowthCurveParams(basicInfo);

    // Growth params are normally generated when the species is first cached
    // (see cachePlantInfo in plants.ts). If they're still missing here,
    // retry generation now rather than silently skipping curve-solving —
    // this should be a rare fallback, not the normal path.
    if (!growthParams) {
      basicInfo = await ensureGrowthParams(admin, basicInfo);
      growthParams = toGrowthCurveParams(basicInfo);
    }

    const resolvedXPosition = growthParams ? solveXForFullness(growthParams, health.fullness_pct) : null;

    const plantUpdate: Record<string, unknown> = { photo_path: photoResult.path };
    if (resolvedXPosition != null) {
      plantUpdate.current_x_position = resolvedXPosition;
      plantUpdate.last_recalibrated_at = new Date().toISOString();
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

    const { data: healthInfo, error: healthInfoError } = await admin
      .from('plant_health_info')
      .insert({
        plant_id: plant.id,
        photo_path: photoResult.path,
        observed_at: new Date().toISOString(),
        estimated_fullness_pct: health.fullness_pct,
        estimated_health_score: health.health_score,
        resolved_x_position: resolvedXPosition,
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
