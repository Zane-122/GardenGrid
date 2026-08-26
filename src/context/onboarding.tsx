import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme as useSystemColorScheme } from 'react-native';

const STORAGE_KEY = 'garden-grid-onboarding';

export type ThemePreference = 'light' | 'dark' | 'system';

export type OnboardingDraft = {
  firstName: string;
  lastName: string;
  username: string;
  themePreference: ThemePreference;
  hasGarden: boolean | null;
};

export type OnboardingProfile = {
  firstName: string;
  lastName: string;
  username: string;
  displayName: string;
  themePreference: Exclude<ThemePreference, 'system'>;
  hasGarden: boolean;
};

type OnboardingContextValue = {
  isReady: boolean;
  hasCompletedOnboarding: boolean;
  draft: OnboardingDraft;
  profile: OnboardingProfile | null;
  colorScheme: 'light' | 'dark';
  updateDraft: (partial: Partial<OnboardingDraft>) => void;
  completeOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
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
  const [isReady, setIsReady] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [draft, setDraft] = useState<OnboardingDraft>(initialDraft);
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);

  const themePreference = profile?.themePreference ?? draft.themePreference;
  const colorScheme = resolveColorScheme(themePreference, systemScheme);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw || cancelled) {
          return;
        }

        const stored = JSON.parse(raw) as OnboardingProfile;
        if (!stored?.username || cancelled) {
          return;
        }

        setProfile({
          ...stored,
          displayName: stored.displayName || displayNameFrom(stored.firstName, stored.lastName),
        });
        setDraft({
          firstName: stored.firstName,
          lastName: stored.lastName,
          username: stored.username,
          themePreference: stored.themePreference,
          hasGarden: stored.hasGarden,
        });
        setHasCompletedOnboarding(true);
      } catch {
        // Ignore corrupt test data and start onboarding again.
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

    Appearance.setColorScheme(themePreference === 'system' ? 'unspecified' : themePreference);
  }, [themePreference]);

  const updateDraft = useCallback((partial: Partial<OnboardingDraft>) => {
    setDraft((current) => ({ ...current, ...partial }));
  }, []);

  const completeOnboarding = useCallback(async () => {
    if (!draft.firstName.trim() || !draft.lastName.trim() || !draft.username.trim() || draft.hasGarden === null) {
      return;
    }

    const nextProfile: OnboardingProfile = {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      username: draft.username.trim(),
      displayName: displayNameFrom(draft.firstName, draft.lastName),
      themePreference: draft.themePreference === 'dark' ? 'dark' : 'light',
      hasGarden: draft.hasGarden,
    };

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextProfile));
    setProfile(nextProfile);
    setHasCompletedOnboarding(true);
  }, [draft]);

  const resetOnboarding = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setProfile(null);
    setDraft(initialDraft);
    setHasCompletedOnboarding(false);
  }, []);

  const value = useMemo(
    () => ({
      isReady,
      hasCompletedOnboarding,
      draft,
      profile,
      colorScheme,
      updateDraft,
      completeOnboarding,
      resetOnboarding,
    }),
    [
      isReady,
      hasCompletedOnboarding,
      draft,
      profile,
      colorScheme,
      updateDraft,
      completeOnboarding,
      resetOnboarding,
    ]
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
