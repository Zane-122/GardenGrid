import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from '@/utils/supabase';

type AuthResult = {
  error: string | null;
  /**
   * True when the account was created but Supabase did not return a session,
   * which means the project has email confirmation turned on.
   */
  needsEmailConfirmation?: boolean;
};

/**
 * Written to `raw_user_meta_data` on the new auth user. A database trigger copies
 * these into the `profiles` table, so the key names have to match that trigger.
 */
export type SignUpMetadata = {
  display_name: string;
  username: string;
  tutorialComplete: boolean;
};

type AuthContextValue = {
  isReady: boolean;
  session: Session | null;
  user: User | null;
  signUp: (email: string, password: string, metadata: SignUpMetadata) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) {
          setSession(data.session);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsReady(true);
        }
      });

    // Fires for sign in, sign out, token refresh, and user updates.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, metadata: SignUpMetadata): Promise<AuthResult> => {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: metadata },
      });

      if (error) {
        return { error: error.message };
      }

      return { error: null, needsEmailConfirmation: !data.session };
    },
    []
  );

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    return { error: error ? error.message : null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      isReady,
      session,
      user: session?.user ?? null,
      signUp,
      signIn,
      signOut,
    }),
    [isReady, session, signUp, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
