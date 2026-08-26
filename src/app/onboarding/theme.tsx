import { router } from 'expo-router';

import { ChoiceCard } from '@/components/onboarding/choice-card';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { Colors } from '@/constants/theme';
import { useOnboarding } from '@/context/onboarding';

export default function OnboardingThemeScreen() {
  const { draft, updateDraft, colorScheme } = useOnboarding();
  const selected = draft.themePreference === 'system' ? colorScheme : draft.themePreference;

  function handleContinue() {
    updateDraft({ themePreference: selected });
    router.push('/onboarding/garden');
  }

  return (
    <OnboardingShell
      step={3}
      title="Choose your look"
      subtitle="Pick light or dark mode. You can change this later."
      onContinue={handleContinue}>
      <ChoiceCard
        title="Light mode"
        description="Bright greens on a soft garden background."
        selected={selected === 'light'}
        onPress={() => updateDraft({ themePreference: 'light' })}
        icon={{ ios: 'sun.max.fill', android: 'light_mode', web: 'light_mode' }}
        preview={{ backgroundColor: Colors.light.background }}
      />
      <ChoiceCard
        title="Dark mode"
        description="Deep soil tones that are easier on the eyes at night."
        selected={selected === 'dark'}
        onPress={() => updateDraft({ themePreference: 'dark' })}
        icon={{ ios: 'moon.fill', android: 'dark_mode', web: 'dark_mode' }}
        preview={{ backgroundColor: Colors.dark.background }}
      />
    </OnboardingShell>
  );
}
