import { supabase } from '@/utils/supabase';

// Mirrors MAX_MESSAGE_CHARS in supabase/functions/_shared/plant-assistant.ts.
export const CHAT_MAX_CHARS = 1000;
export const CHAT_COUNTER_FROM = 800;

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  created_at: string;
};

type AssistantResponse = {
  reply: string;
  message_id: string;
  created_at: string;
  remaining_today?: number;
};

export type AssistantAnswer = {
  message: ChatMessage;
  remainingToday: number | null;
};

/** Thrown for a failed plant-assistant call; `status` is the HTTP status when there was one. */
export class PlantChatError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'PlantChatError';
    this.status = status;
  }
}

/** Turns anything thrown into a short message that is safe to show the user. */
export function describeError(error: unknown, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  if (error && typeof error === 'object') {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string' && message) {
      return message;
    }
  }
  return fallback;
}

export function validateChatDraft(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false as const, error: 'Type a question first.' };
  }
  if (trimmed.length > CHAT_MAX_CHARS) {
    return { ok: false as const, error: `Keep questions under ${CHAT_MAX_CHARS} characters.` };
  }
  return { ok: true as const, message: trimmed };
}

export async function listPlantChat(plantId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('plant_chat_messages')
    .select('id, role, content, created_at')
    .eq('plant_id', plantId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: String(row.content),
    created_at: String(row.created_at),
  }));
}

async function chatErrorFrom(error: unknown) {
  const response =
    error && typeof error === 'object' ? (error as { context?: Response }).context : undefined;

  if (response && typeof response.json === 'function') {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return new PlantChatError(body?.error || describeError(error), response.status ?? null);
  }

  return new PlantChatError(describeError(error));
}

export async function askPlantAssistant(plantId: string, message: string): Promise<AssistantAnswer> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }
  if (!session?.access_token) {
    throw new PlantChatError('You need to be signed in to chat.');
  }

  const { data, error } = await supabase.functions.invoke<AssistantResponse>('plant-assistant', {
    body: { plant_id: plantId, message },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    throw await chatErrorFrom(error);
  }
  if (!data?.reply) {
    throw new PlantChatError('The assistant sent back an empty answer. Please try again.');
  }

  return {
    message: {
      id: data.message_id,
      role: 'assistant',
      content: data.reply,
      created_at: data.created_at,
    },
    remainingToday: typeof data.remaining_today === 'number' ? data.remaining_today : null,
  };
}
