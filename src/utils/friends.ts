import { supabase } from '@/utils/supabase';

export type FriendStatus = 'pending' | 'approved';

export type FriendDirection = 'incoming' | 'outgoing';

export type FriendRequest = {
  id: string;
  status: FriendStatus;
  sentAt: string;
  direction: FriendDirection;
  person: {
    id: string;
    username: string;
    displayName: string;
  };
};

export type LeaderboardEntry = {
  id: string;
  username: string;
  displayName: string;
  totalOxygen: number;
  totalPollen: number;
  you: boolean;
};

type FriendsResponse = {
  requests?: FriendRequest[];
  leaderboard?: LeaderboardEntry[];
};

export type FriendsList = {
  requests: FriendRequest[];
  leaderboard: LeaderboardEntry[];
};

async function functionErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'context' in error) {
    const response = (error as { context?: Response }).context;
    if (response && typeof response.json === 'function') {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (body?.error) {
        return body.error;
      }
    }
  }

  return error instanceof Error ? error.message : 'Something went wrong';
}

async function invokeFriends<T>(body: Record<string, unknown>) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }
  if (!session?.access_token) {
    throw new Error('You need to be signed in.');
  }

  const { data, error } = await supabase.functions.invoke<T>('friends', {
    body,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    throw new Error(await functionErrorMessage(error));
  }

  return data;
}

export async function listFriendRequests(): Promise<FriendsList> {
  const data = await invokeFriends<FriendsResponse>({ action: 'list' });
  return {
    requests: data?.requests ?? [],
    leaderboard: data?.leaderboard ?? [],
  };
}

export async function sendFriendRequest(username: string) {
  await invokeFriends({ action: 'send', username });
}

export async function respondToFriendRequest(requestId: string, status: 'approved' | 'rejected') {
  await invokeFriends({ action: 'respond', request_id: requestId, status });
}
