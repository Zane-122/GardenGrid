import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

type FriendStatus = 'pending' | 'rejected' | 'approved';

type FriendAction = 'list' | 'send' | 'respond';

type FriendBody = {
  action?: FriendAction;
  username?: string;
  request_id?: number | string;
  status?: FriendStatus;
};

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
};

type RequestRow = {
  id: number | string;
  requesting_user: string;
  receiving_user: string;
  status: FriendStatus;
  sent_at: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function requireUser(req: Request): Promise<{ user: User; admin: SupabaseClient }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw json({ error: 'Missing Authorization bearer token' }, 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');

  if (!url || !anonKey || !serviceKey) {
    throw json({ error: 'Supabase environment is not configured' }, 500);
  }

  const token = authHeader.slice('Bearer '.length);
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    throw json({ error: 'Invalid or expired session' }, 401);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { user: data.user, admin };
}

function personFrom(profile: ProfileRow | undefined, fallbackId: string) {
  const username = profile?.username?.trim() || 'unknown';
  return {
    id: profile?.id ?? fallbackId,
    username,
    displayName: profile?.display_name?.trim() || username,
  };
}

function toRequest(row: RequestRow, userId: string, profiles: Map<string, ProfileRow>) {
  const outgoing = row.requesting_user === userId;
  const otherId = outgoing ? row.receiving_user : row.requesting_user;
  return {
    id: String(row.id),
    status: row.status,
    sentAt: row.sent_at,
    direction: outgoing ? 'outgoing' : 'incoming',
    person: personFrom(profiles.get(otherId), otherId),
  };
}

async function listRequests(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from('FriendRequests')
    .select('id, requesting_user, receiving_user, status, sent_at')
    .or(`requesting_user.eq.${userId},receiving_user.eq.${userId}`)
    .order('sent_at', { ascending: false });

  if (error) {
    throw json({ error: `Failed to load friend requests: ${error.message}` }, 500);
  }

  const rows = (data ?? []) as RequestRow[];
  const profileIds = [...new Set(rows.flatMap((row) => [row.requesting_user, row.receiving_user]))];
  const profiles = new Map<string, ProfileRow>();

  if (profileIds.length > 0) {
    const { data: people, error: peopleError } = await admin
      .from('profiles')
      .select('id, username, display_name')
      .in('id', profileIds);

    if (peopleError) {
      throw json({ error: `Failed to load profiles: ${peopleError.message}` }, 500);
    }

    for (const person of (people ?? []) as ProfileRow[]) {
      profiles.set(person.id, person);
    }
  }

  return rows
    .filter((row) => row.status === 'pending' || row.status === 'approved')
    .map((row) => toRequest(row, userId, profiles));
}

type LeaderRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  total_oxygen: number | string | null;
  total_pollen: number | string | null;
};

function asAmount(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

async function listLeaderboard(admin: SupabaseClient, userId: string, friendIds: string[]) {
  const ids = [...new Set([userId, ...friendIds])];
  const { data, error } = await admin
    .from('profiles')
    .select('id, username, display_name, total_oxygen, total_pollen')
    .in('id', ids);

  if (error) {
    throw json({ error: `Failed to load the leaderboard: ${error.message}` }, 500);
  }

  return ((data ?? []) as LeaderRow[]).map((row) => {
    const username = row.username?.trim() || 'unknown';
    return {
      id: row.id,
      username,
      displayName: row.display_name?.trim() || username,
      totalOxygen: asAmount(row.total_oxygen),
      totalPollen: asAmount(row.total_pollen),
      you: row.id === userId,
    };
  });
}

async function findProfile(admin: SupabaseClient, username: string) {
  const { data, error } = await admin
    .from('profiles')
    .select('id, username, display_name')
    .ilike('username', username);

  if (error) {
    throw json({ error: `Failed to look up that username: ${error.message}` }, 500);
  }

  const wanted = username.toLowerCase();
  return ((data ?? []) as ProfileRow[]).find((row) => row.username?.toLowerCase() === wanted) ?? null;
}

async function findPair(admin: SupabaseClient, firstId: string, secondId: string) {
  const { data, error } = await admin
    .from('FriendRequests')
    .select('id, requesting_user, receiving_user, status, sent_at')
    .or(
      `and(requesting_user.eq.${firstId},receiving_user.eq.${secondId}),and(requesting_user.eq.${secondId},receiving_user.eq.${firstId})`,
    )
    .maybeSingle();

  if (error) {
    throw json({ error: `Failed to check an existing request: ${error.message}` }, 500);
  }

  return (data as RequestRow | null) ?? null;
}

async function sendRequest(admin: SupabaseClient, userId: string, username: string) {
  if (!USERNAME_PATTERN.test(username)) {
    throw json({ error: 'Use 3–20 letters, numbers, or underscores.' }, 400);
  }

  const person = await findProfile(admin, username);
  if (!person) {
    throw json({ error: 'No one has that username.' }, 404);
  }
  if (person.id === userId) {
    throw json({ error: 'You cannot send a request to yourself.' }, 400);
  }

  const existing = await findPair(admin, userId, person.id);
  if (existing?.status === 'approved') {
    throw json({ error: 'You are already friends.' }, 409);
  }
  if (existing?.status === 'pending' && existing.requesting_user === userId) {
    throw json({ error: 'You already sent that request.' }, 409);
  }
  if (existing?.status === 'pending') {
    throw json({ error: 'They already sent you a request. Accept it instead.' }, 409);
  }

  const sentAt = new Date().toISOString();
  if (existing) {
    const { error } = await admin
      .from('FriendRequests')
      .update({
        requesting_user: userId,
        receiving_user: person.id,
        status: 'pending',
        sent_at: sentAt,
      })
      .eq('id', existing.id);

    if (error) {
      throw json({ error: `Failed to send request: ${error.message}` }, 500);
    }
  } else {
    const { error } = await admin.from('FriendRequests').insert({
      requesting_user: userId,
      receiving_user: person.id,
      status: 'pending',
      sent_at: sentAt,
    });

    if (error) {
      throw json({ error: `Failed to send request: ${error.message}` }, 500);
    }
  }

  return { sent: true };
}

async function respondToRequest(
  admin: SupabaseClient,
  userId: string,
  requestId: string,
  status: FriendStatus,
) {
  if (status !== 'approved' && status !== 'rejected') {
    throw json({ error: 'Status must be approved or rejected.' }, 400);
  }

  const { data, error } = await admin
    .from('FriendRequests')
    .select('id, requesting_user, receiving_user, status, sent_at')
    .eq('id', requestId)
    .maybeSingle();

  if (error) {
    throw json({ error: `Failed to load that request: ${error.message}` }, 500);
  }

  const row = data as RequestRow | null;
  if (!row || (row.requesting_user !== userId && row.receiving_user !== userId)) {
    throw json({ error: 'Request not found.' }, 404);
  }
  if (row.receiving_user !== userId) {
    throw json({ error: 'Only the person who received the request can respond.' }, 403);
  }
  if (row.status !== 'pending') {
    throw json({ error: 'That request is no longer pending.' }, 409);
  }

  const { error: updateError } = await admin.from('FriendRequests').update({ status }).eq('id', row.id);
  if (updateError) {
    throw json({ error: `Failed to update request: ${updateError.message}` }, 500);
  }

  return { updated: true, status };
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
    const body = (await req.json().catch(() => ({}))) as FriendBody;
    const action = body.action;

    if (action === 'list') {
      const requests = await listRequests(admin, user.id);
      const friendIds = requests
        .filter((request) => request.status === 'approved')
        .map((request) => request.person.id);
      return json({
        requests,
        leaderboard: await listLeaderboard(admin, user.id, friendIds),
      });
    }

    if (action === 'send') {
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      if (!username) {
        return json({ error: 'username is required' }, 400);
      }
      return json(await sendRequest(admin, user.id, username));
    }

    if (action === 'respond') {
      const requestId =
        typeof body.request_id === 'number' || typeof body.request_id === 'string'
          ? String(body.request_id).trim()
          : '';
      if (!requestId) {
        return json({ error: 'request_id is required' }, 400);
      }
      return json(await respondToRequest(admin, user.id, requestId, body.status ?? 'pending'));
    }

    return json({ error: 'action must be list, send, or respond' }, 400);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return json({ error: error instanceof Error ? error.message : 'Failed to update friends' }, 500);
  }
});
