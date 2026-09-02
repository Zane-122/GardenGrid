import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/context/auth';
import { OnboardingProvider, useOnboarding } from '@/context/onboarding';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AuthProvider>
      <OnboardingProvider>
        <RootNavigator />
      </OnboardingProvider>
    </AuthProvider>
  );
}

function RootNavigator() {
  const { isReady: authIsReady, session } = useAuth();
  const { isReady, colorScheme } = useOnboarding();

  if (!authIsReady || !isReady) {
    return null;
  }

  // Onboarding now ends with sign-up, so having a session means it is finished.
  const isSignedIn = !!session;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <AnimatedSplashOverlay />
      <Stack>
        <Stack.Protected guard={isSignedIn}>
          <Stack.Screen name="(app)">
            <Stack.Header hidden />
          </Stack.Screen>
        </Stack.Protected>
        <Stack.Protected guard={!isSignedIn}>
          <Stack.Screen name="onboarding">
            <Stack.Header hidden />
          </Stack.Screen>
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
