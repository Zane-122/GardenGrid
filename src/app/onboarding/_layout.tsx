import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack>
      <Stack.Screen name="index">
        <Stack.Header hidden />
      </Stack.Screen>
      <Stack.Screen name="sign-in">
        <Stack.Header hidden />
      </Stack.Screen>
      <Stack.Screen name="name">
        <Stack.Header hidden />
      </Stack.Screen>
      <Stack.Screen name="username">
        <Stack.Header hidden />
      </Stack.Screen>
      <Stack.Screen name="theme">
        <Stack.Header hidden />
      </Stack.Screen>
      <Stack.Screen name="garden">
        <Stack.Header hidden />
      </Stack.Screen>
      <Stack.Screen name="sign-up">
        <Stack.Header hidden />
      </Stack.Screen>
    </Stack>
  );
}
