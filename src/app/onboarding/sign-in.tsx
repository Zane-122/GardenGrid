import { useState } from 'react';

import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { OnboardingTextField } from '@/components/onboarding/onboarding-text-field';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { getEmailError } from '@/utils/validation';

export default function SignInScreen() {
  const { signIn } = useAuth();
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const emailError = getEmailError(email);
  const passwordError = !password ? 'Enter your password.' : null;
  const canContinue = !emailError && !passwordError;

  async function handleContinue() {
    setShowErrors(true);
    setFormError(null);

    if (!canContinue || submitting) {
      return;
    }

    setSubmitting(true);
    const { error } = await signIn(email, password);
    setSubmitting(false);

    if (error) {
      setFormError(error);
      return;
    }

    // The root layout guard takes it from here, into onboarding or the app.
  }

  return (
    <OnboardingShell
      step={1}
      totalSteps={1}
      showBack
      title="Welcome back"
      subtitle="Log in to pick up your garden setup where you left off."
      continueLabel="Log in"
      loadingLabel="Logging in…"
      onContinue={handleContinue}
      continueDisabled={submitting}
      continueLoading={submitting}>
      <OnboardingTextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        returnKeyType="next"
        error={showErrors ? emailError : null}
      />
      <OnboardingTextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        secureTextEntry
        returnKeyType="done"
        onSubmitEditing={handleContinue}
        error={showErrors ? passwordError : null}
      />
      {formError ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {formError}
        </ThemedText>
      ) : null}
    </OnboardingShell>
  );
}
