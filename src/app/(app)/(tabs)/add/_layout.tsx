import { Stack } from 'expo-router';

export default function AddTabLayout() {
  return (
    <Stack>
      <Stack.Screen name="index">
        <Stack.Header hidden />
      </Stack.Screen>
      <Stack.Screen name="search">
        <Stack.Header hidden />
      </Stack.Screen>
      <Stack.Screen name="photo">
        <Stack.Header hidden />
      </Stack.Screen>
      <Stack.Screen name="confirm">
        <Stack.Header hidden />
      </Stack.Screen>
    </Stack>
  );
}
