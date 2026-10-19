import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { plantPhotoFreshness } from '../_shared/observation-freshness.ts';
import {
  buildContents,
  buildContextText,
  decideRateLimit,
  HISTORY_LIMIT,
  MAX_PHOTOS,
  validateMessage,
  type ChatRow,
  type GeminiPart,
} from '../_shared/plant-assistant.ts';
import { generatePlantReply } from '../_shared/plant-assistant-llm.ts';
import { corsHeaders, json, PLANT_PHOTOS_BUCKET, requireUser, type PlantBasicInfoRow } from '../_shared/plants.ts';

type PlantAssistantBody = {
  plant_id?: string;
  message?: string;
};

type PlantRow = {
  id: string;
  user_id: string;
  created_at: string;
  photo_path: string | null;
  plant_basic_info: PlantBasicInfoRow;
};

type ObservationRow = {
  observed_at: string;
  photo_path: string | null;
  estimated_fullness_pct: number | null;
  estimated_health_score: number | null;
};

const MS_PER_DAY = 86_400_000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const FRIENDLY_GEMINI_ERROR =
  "Sorry, I couldn't come up with an answer just now. Please try again in a moment.";

// Same chunked approach as update-plant-photo (String.fromCharCode(...bytes)
// overflows the call stack on large images).
function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Downloads up to MAX_PHOTOS distinct stored photos for the plant as Gemini
 * image parts, most recent first. Any photo that fails to download, is not an
 * image, or is too large is skipped.
 *
 * Note: the bucket holds one object per plant (named plants.id, overwritten on
 * every photo update), so in practice this yields at most one image today.
 */
async function loadPhotoParts(admin: SupabaseClient, paths: string[]): Promise<GeminiPart[]> {
  const parts: GeminiPart[] = [];

  for (const path of paths) {
    if (parts.length >= MAX_PHOTOS) {
      break;
    }

    try {
      const { data, error } = await admin.storage.from(PLANT_PHOTOS_BUCKET).download(path);
      if (error || !data) {
        console.error(`plant-assistant: could not download photo ${path}: ${error?.message ?? 'no data'}`);
        continue;
      }
      if (!data.type.startsWith('image/') || data.size > MAX_IMAGE_BYTES) {
        console.error(`plant-assistant: skipping photo ${path} (type ${data.type}, ${data.size} bytes)`);
        continue;
      }

      parts.push({
        inline_data: {
          mime_type: data.type,
          data: encodeBase64(new Uint8Array(await data.arrayBuffer())),
        },
      });
    } catch (error) {
      console.error(`plant-assistant: photo ${path} failed:`, error);
    }
  }

  return parts;
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
    const body = (await req.json().catch(() => ({}))) as PlantAssistantBody;

    const plantInstanceId = typeof body.plant_id === 'string' ? body.plant_id.trim() : '';
    if (!plantInstanceId) {
      return json({ error: 'plant_id is required' }, 400);
    }

    const validation = validateMessage(body.message);
    if (!validation.ok) {
      return json({ error: validation.error }, 400);
    }
    const { message } = validation;

    // Ownership check: the admin client bypasses RLS, so scope by user_id.
    const { data: plantRow, error: plantError } = await admin
      .from('plants')
      .select('id, user_id, created_at, photo_path, plant_basic_info(*)')
      .eq('id', plantInstanceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (plantError) {
      return json({ error: `Failed to load plant: ${plantError.message}` }, 500);
    }
    if (!plantRow) {
      return json({ error: 'Plant not found' }, 404);
    }
    const plant = plantRow as unknown as PlantRow;

    // Rate limit: this user's questions across all plants in the last 24 hours.
    const now = new Date();
    const since = new Date(now.getTime() - MS_PER_DAY).toISOString();
    const { count, error: countError } = await admin
      .from('plant_chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('role', 'user')
      .gte('created_at', since);

    if (countError) {
      return json({ error: `Failed to check usage: ${countError.message}` }, 500);
    }

    const limit = decideRateLimit(count ?? 0);
    if (!limit.allowed) {
      return json({ error: limit.error }, 429);
    }

    // Real observations only: baseline rows (seeded when the plant was added)
    // have a null estimated_fullness_pct.
    const { data: observationRows, error: observationError } = await admin
      .from('plant_health_info')
      .select('observed_at, photo_path, estimated_fullness_pct, estimated_health_score')
      .eq('plant_id', plant.id)
      .not('estimated_fullness_pct', 'is', null)
      .order('observed_at', { ascending: false })
      .limit(5);

    if (observationError) {
      return json({ error: `Failed to load plant health info: ${observationError.message}` }, 500);
    }
    const observations = (observationRows ?? []) as ObservationRow[];
    const latest = observations[0] ?? null;

    const photoPaths = [
      ...new Set(
        [...observations.map((row) => row.photo_path), plant.photo_path].filter((path): path is string => !!path)
      ),
    ];
    const photoParts = await loadPhotoParts(admin, photoPaths);

    // History is loaded before this message is saved, so it never includes it.
    const { data: historyRows, error: historyError } = await admin
      .from('plant_chat_messages')
      .select('role, content')
      .eq('plant_id', plant.id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);

    if (historyError) {
      return json({ error: `Failed to load chat history: ${historyError.message}` }, 500);
    }
    const history = ((historyRows ?? []) as ChatRow[]).reverse();

    const info = plant.plant_basic_info;
    const contextText = buildContextText({
      scientificName: info.scientific_name,
      commonNames: info.common_names ?? [],
      watering: info.watering,
      bestSoilType: info.best_soil_type,
      plantCreatedAt: plant.created_at,
      observation: latest
        ? {
            observedAt: latest.observed_at,
            fullnessPct: latest.estimated_fullness_pct,
            healthScore: latest.estimated_health_score,
          }
        : null,
      photosAttached: photoParts.length,
      now,
    });

    const contents = buildContents(history, [
      { text: contextText },
      ...photoParts,
      { text: `<user_question>\n${message}\n</user_question>` },
    ]);

    // The user's message is saved before asking Gemini, so it counts toward
    // the limit and appears in the thread even if the reply fails.
    const { error: userInsertError } = await admin.from('plant_chat_messages').insert({
      plant_id: plant.id,
      user_id: user.id,
      role: 'user',
      content: message,
    });
    if (userInsertError) {
      return json({ error: `Failed to save your message: ${userInsertError.message}` }, 500);
    }

    const reply = await generatePlantReply(contents);
    if (!reply) {
      return json({ error: FRIENDLY_GEMINI_ERROR }, 502);
    }

    const { data: saved, error: replyInsertError } = await admin
      .from('plant_chat_messages')
      .insert({ plant_id: plant.id, user_id: user.id, role: 'assistant', content: reply })
      .select('id, created_at')
      .single();

    if (replyInsertError) {
      return json({ error: `Failed to save the reply: ${replyInsertError.message}` }, 500);
    }

    return json({
      reply,
      message_id: saved.id,
      created_at: saved.created_at,
      remaining_today: limit.remaining,
      photo_freshness: plantPhotoFreshness(latest?.observed_at ?? null, plant.created_at, now),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return json({ error: error instanceof Error ? error.message : 'Failed to answer that question' }, 500);
  }
});
