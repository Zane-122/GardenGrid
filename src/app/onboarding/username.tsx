import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { OnboardingTextField } from '@/components/onboarding/onboarding-text-field';
import { ThemedText } from '@/components/themed-text';
import { TAKEN_USERNAMES, getUsernameError, getUsernameFormatError } from '@/constants/usernames';
import { useOnboarding } from '@/context/onboarding';

export default function OnboardingUsernameScreen() {
  const { draft, updateDraft } = useOnboarding();
  const [username, setUsername] = useState(draft.username);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setError(null);
  }, [username]);

  async function handleContinue() {
    const formatError = getUsernameFormatError(username);
    if (formatError) {
      setError(formatError);
      return;
    }

    setChecking(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const takenError = getUsernameError(username);
    setChecking(false);

    if (takenError) {
      setError(takenError);
      return;
    }

    updateDraft({ username: username.trim() });
    router.push('/onboarding/theme');
  }

  return (
    <OnboardingShell
      step={2}
      title="Pick a username"
      subtitle="This has to be unique. We'll check it against names that are already in use."
      onContinue={handleContinue}
      continueDisabled={!username.trim() || checking}
      continueLoading={checking}>
      <OnboardingTextField
        label="Username"
        value={username}
        onChangeText={(value) => setUsername(value.replace(/\s/g, ''))}
        placeholder="gardengrid"
        autoCapitalize="none"
        autoComplete="username"
        textContentType="username"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={handleContinue}
        error={error}
      />
      <ThemedText type="small" themeColor="textSecondary">
        For testing, try `{TAKEN_USERNAMES[0]}` — that name is already taken. Other reserved names
        include {TAKEN_USERNAMES.slice(1, 4).join(', ')}.
      </ThemedText>
    </OnboardingShell>
  );
}
