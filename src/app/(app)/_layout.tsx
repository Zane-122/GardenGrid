import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AddPlantProvider } from '@/context/add-plant';
import { useRequestGardenLocation } from '@/hooks/use-request-garden-location';

export default function AppLayout() {
  useRequestGardenLocation();

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
