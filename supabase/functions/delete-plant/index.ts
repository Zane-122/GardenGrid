import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { corsHeaders, json, PLANT_PHOTOS_BUCKET, requireUser } from '../_shared/plants.ts';

type DeletePlantBody = {
  plant_id?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { user, admin } = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as DeletePlantBody;

    const plantInstanceId = typeof body.plant_id === 'string' ? body.plant_id.trim() : '';
    if (!plantInstanceId) {
      return json({ error: 'plant_id is required' }, 400);
    }

    // Ownership check: the admin client bypasses RLS, so scope by user_id.
    const { data: plant, error: plantError } = await admin
      .from('plants')
      .select('id, photo_path')
      .eq('id', plantInstanceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (plantError) {
      return json({ error: `Failed to load plant: ${plantError.message}` }, 500);
    }
    if (!plant) {
      return json({ error: 'Plant not found' }, 404);
    }

    // plant_health_info and garden_slots rows go with it (ON DELETE CASCADE).
    const { error: deleteError } = await admin
      .from('plants')
      .delete()
      .eq('id', plant.id)
      .eq('user_id', user.id);

    if (deleteError) {
      return json({ error: `Failed to delete plant: ${deleteError.message}` }, 500);
    }

    // Storage cleanup runs only after the row is gone, and never fails the
    // request: an orphaned file in a private bucket is harmless, while a plant
    // row pointing at a missing photo would not be. Paths come from the
    // verified row, never from the request body.
    const photoPaths = [...new Set([plant.id, plant.photo_path].filter((p): p is string => !!p))];
    const { error: storageError } = await admin.storage.from(PLANT_PHOTOS_BUCKET).remove(photoPaths);
    if (storageError) {
      console.error(`delete-plant: failed to remove photo(s) for ${plant.id}:`, storageError.message);
    }

    return json({ deleted: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return json({ error: error instanceof Error ? error.message : 'Failed to delete plant' }, 500);
  }
});
