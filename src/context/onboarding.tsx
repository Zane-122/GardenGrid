import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme as useSystemColorScheme } from 'react-native';

import { useAuth, type SignUpMetadata } from '@/context/auth';

// The draft is filled in before an account exists, so it is stored per device.
const DRAFT_STORAGE_KEY = 'garden-grid-onboarding-draft';

export type ThemePreference = 'light' | 'dark' | 'system';

export type OnboardingDraft = {
  firstName: string;
  lastName: string;
  username: string;
  themePreference: ThemePreference;
  hasGarden: boolean | null;
};

export type OnboardingProfile = {
  displayName: string;
  username: string;
  tutorialComplete: boolean;
};

type OnboardingContextValue = {
  isReady: boolean;
  draft: OnboardingDraft;
  /** True once every onboarding question has an answer. */
  isDraftComplete: boolean;
  /** The metadata sent to Supabase at sign-up, or null while answers are missing. */
  signUpMetadata: SignUpMetadata | null;
  /** The signed-in user's profile, read back from their auth metadata. */
  profile: OnboardingProfile | null;
  colorScheme: 'light' | 'dark';
  updateDraft: (partial: Partial<OnboardingDraft>) => void;
  resetDraft: () => Promise<void>;
};

const initialDraft: OnboardingDraft = {
  firstName: '',
  lastName: '',
  username: '',
  themePreference: 'system',
  hasGarden: null,
};

export const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function displayNameFrom(firstName: string, lastName: string) {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}

function resolveColorScheme(
  preference: ThemePreference,
  systemScheme: 'light' | 'dark' | 'unspecified' | null | undefined
): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }

  return systemScheme === 'dark' ? 'dark' : 'light';
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const { user } = useAuth();

  const [isReady, setIsReady] = useState(false);
  const [draft, setDraft] = useState<OnboardingDraft>(initialDraft);

  const colorScheme = resolveColorScheme(draft.themePreference, systemScheme);

  // Restore an in-progress draft so a reload mid-onboarding does not lose answers.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_STORAGE_KEY);
        if (!raw || cancelled) {
          return;
        }

        const stored = JSON.parse(raw) as Partial<OnboardingDraft>;
        if (cancelled) {
          return;
        }

        setDraft((current) => ({ ...current, ...stored }));
      } catch {
        // Ignore corrupt data and start onboarding again.
      } finally {
        if (!cancelled) {
          setIsReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // react-native-web does not implement Appearance.setColorScheme.
    if (typeof Appearance.setColorScheme !== 'function') {
      return;
    }

    Appearance.setColorScheme(
      draft.themePreference === 'system' ? 'unspecified' : draft.themePreference
    );
  }, [draft.themePreference]);

  const updateDraft = useCallback((partial: Partial<OnboardingDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...partial };
      void AsyncStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetDraft = useCallback(async () => {
    setDraft(initialDraft);
    await AsyncStorage.removeItem(DRAFT_STORAGE_KEY);
  }, []);

  const isDraftComplete =
    !!draft.firstName.trim() &&
    !!draft.lastName.trim() &&
    !!draft.username.trim() &&
    draft.hasGarden !== null;

  const signUpMetadata: SignUpMetadata | null = isDraftComplete
    ? {
        display_name: displayNameFrom(draft.firstName, draft.lastName),
        username: draft.username.trim(),
        // They already have a garden, so the in-app tutorial is not needed.
        tutorialComplete: draft.hasGarden === true,
      }
    : null;

  const metadata = user?.user_metadata;
  const profile: OnboardingProfile | null = user
    ? {
        displayName: typeof metadata?.display_name === 'string' ? metadata.display_name : '',
        username: typeof metadata?.username === 'string' ? metadata.username : '',
        tutorialComplete: metadata?.tutorialComplete === true,
      }
    : null;

  const value = useMemo(
    () => ({
      isReady,
      draft,
      isDraftComplete,
      signUpMetadata,
      profile,
      colorScheme,
      updateDraft,
      resetDraft,
    }),
    [isReady, draft, isDraftComplete, signUpMetadata, profile, colorScheme, updateDraft, resetDraft]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);

  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }

  return context;
}
