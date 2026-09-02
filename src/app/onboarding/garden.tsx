import { router } from 'expo-router';

import { ChoiceCard } from '@/components/onboarding/choice-card';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { useOnboarding } from '@/context/onboarding';
import { requestGardenLocationPermission } from '@/utils/location';

export default function OnboardingGardenScreen() {
  const { draft, updateDraft } = useOnboarding();

  async function handleContinue() {
    if (draft.hasGarden === null) {
      return;
    }

    await requestGardenLocationPermission();
    router.push('/onboarding/sign-up');
  }

  return (
    <OnboardingShell
      step={4}
      title="Do you already have a garden?"
      subtitle="This is just an opt-in for now so we can tailor a starting point later. We'll also ask for your location so plant identification can be more accurate."
      continueLabel="Continue"
      onContinue={handleContinue}
      continueDisabled={draft.hasGarden === null}>
      <ChoiceCard
        title="Yes, I have a garden"
        description="I'll add the beds, plants, and layouts I already grow."
        selected={draft.hasGarden === true}
        onPress={() => updateDraft({ hasGarden: true })}
        icon={{ ios: 'leaf.fill', android: 'eco', web: 'eco' }}
      />
      <ChoiceCard
        title="Not yet"
        description="I'm starting fresh and want help planning my first garden."
        selected={draft.hasGarden === false}
        onPress={() => updateDraft({ hasGarden: false })}
        icon={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}
      />
    </OnboardingShell>
  );
}
