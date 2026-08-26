import { useContext } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { OnboardingContext } from '@/context/onboarding';

export function useColorScheme(): 'light' | 'dark' {
  const onboarding = useContext(OnboardingContext);
  const systemScheme = useSystemColorScheme();

  if (onboarding) {
    return onboarding.colorScheme;
  }

  return systemScheme === 'dark' ? 'dark' : 'light';
}
