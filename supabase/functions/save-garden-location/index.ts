import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { corsHeaders, json, parseCoordinates, rememberGardenLocation, requireUser } from '../_shared/plants.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { user, admin } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const coordinates = parseCoordinates(body as { latitude?: unknown; longitude?: unknown });
    if (!coordinates) {
      return json({ error: 'latitude and longitude are required' }, 400);
    }

    await rememberGardenLocation(admin, user.id, coordinates);
    return json({ saved: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return json({ error: error instanceof Error ? error.message : 'Failed to save garden location' }, 500);
  }
});
