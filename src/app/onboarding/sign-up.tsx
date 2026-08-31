import { router } from 'expo-router';
import { useState } from 'react';

import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { OnboardingTextField } from '@/components/onboarding/onboarding-text-field';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/auth';
import { useOnboarding } from '@/context/onboarding';
import { useTheme } from '@/hooks/use-theme';
import { getEmailError, getPasswordError } from '@/utils/validation';

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const { signUpMetadata } = useOnboarding();
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const emailError = getEmailError(email);
  const passwordError = getPasswordError(password);
  const confirmError = password !== confirmPassword ? 'Passwords do not match.' : null;
  const canContinue = !emailError && !passwordError && !confirmError;

  async function handleContinue() {
    setShowErrors(true);
    setFormError(null);

    if (!canContinue || submitting) {
      return;
    }

    if (!signUpMetadata) {
      // Shouldn't happen: the earlier steps gate their own continue buttons.
      setFormError('Some onboarding answers are missing. Go back and finish them first.');
      return;
    }

    setSubmitting(true);
    const { error, needsEmailConfirmation } = await signUp(email, password, signUpMetadata);
    setSubmitting(false);

    if (error) {
      setFormError(error);
      return;
    }

    if (needsEmailConfirmation) {
      // No session yet, so the root guard keeps us in onboarding.
      setConfirmationSent(true);
      return;
    }

    // A session now exists; the root layout guard moves us into the app.
  }

  if (confirmationSent) {
    return (
      <OnboardingShell
        step={5}
        title="Confirm your email"
        subtitle={`We sent a confirmation link to ${email.trim()}. Tap it, then come back and log in.`}
        continueLabel="Go to log in"
        showBack={false}
        onContinue={() => router.replace('/onboarding/sign-in')}>
        <ThemedText type="small" themeColor="textSecondary">
          Your garden setup is saved to the new account, so it will be waiting when you log in.
        </ThemedText>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      step={5}
      title="Create your account"
      subtitle="Last step — this saves the garden setup you just filled in."
      continueLabel="Create account"
      loadingLabel="Creating account…"
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
        placeholder="At least 8 characters"
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        secureTextEntry
        returnKeyType="next"
        error={showErrors ? passwordError : null}
      />
      <OnboardingTextField
        label="Confirm password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="Re-enter your password"
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        secureTextEntry
        returnKeyType="done"
        onSubmitEditing={handleContinue}
        error={showErrors ? confirmError : null}
      />
      {formError ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {formError}
        </ThemedText>
      ) : null}
    </OnboardingShell>
  );
}
