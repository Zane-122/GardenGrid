import { Stack } from 'expo-router';

import { AddPlantProvider } from '@/context/add-plant';
import { useRequestGardenLocation } from '@/hooks/use-request-garden-location';

export default function AppLayout() {
  useRequestGardenLocation();

  return (
    <AddPlantProvider>
      <Stack>
        <Stack.Screen name="(tabs)">
          <Stack.Header hidden />
        </Stack.Screen>
        <Stack.Screen name="plant/[id]">
          <Stack.Header hidden />
        </Stack.Screen>
      </Stack>
    </AddPlantProvider>
  );
}
