import { router } from 'expo-router';
import { useState } from 'react';

import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { OnboardingTextField } from '@/components/onboarding/onboarding-text-field';
import { useOnboarding } from '@/context/onboarding';

export default function OnboardingNameScreen() {
  const { draft, updateDraft } = useOnboarding();
  const [firstName, setFirstName] = useState(draft.firstName);
  const [lastName, setLastName] = useState(draft.lastName);
  const [showErrors, setShowErrors] = useState(false);

  const firstNameError = !firstName.trim() ? 'Enter your first name.' : null;
  const lastNameError = !lastName.trim() ? 'Enter your last name.' : null;
  const canContinue = !firstNameError && !lastNameError;

  function handleContinue() {
    setShowErrors(true);
    if (!canContinue) {
      return;
    }

    updateDraft({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    });
    router.push('/onboarding/username');
  }

  return (
    <OnboardingShell
      step={1}
      title="What should we call you?"
      subtitle="Your first and last name will be used as your display name for now."
      onContinue={handleContinue}
      continueDisabled={!canContinue}>
      <OnboardingTextField
        label="First name"
        value={firstName}
        onChangeText={setFirstName}
        placeholder="Avery"
        autoCapitalize="words"
        autoComplete="given-name"
        textContentType="givenName"
        returnKeyType="next"
        error={showErrors ? firstNameError : null}
      />
      <OnboardingTextField
        label="Last name"
        value={lastName}
        onChangeText={setLastName}
        placeholder="Green"
        autoCapitalize="words"
        autoComplete="family-name"
        textContentType="familyName"
        returnKeyType="done"
        onSubmitEditing={handleContinue}
        error={showErrors ? lastNameError : null}
      />
    </OnboardingShell>
  );
}
