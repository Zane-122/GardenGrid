import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AddPlantProvider } from '@/context/add-plant';
import { useRequestGardenLocation } from '@/hooks/use-request-garden-location';
import { ensureDailyWateringNotification } from '@/utils/watering-notification';

export default function AppLayout() {
  useRequestGardenLocation();

  useEffect(() => {
    void ensureDailyWateringNotification();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
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
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
