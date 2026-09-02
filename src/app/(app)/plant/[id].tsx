import { StatusBar } from 'expo-status-bar';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { GardenFrame } from '@/components/app/garden-frame';
import { PlantBanner } from '@/components/inventory/plant-banner';
import { SoilPanel } from '@/components/inventory/soil-panel';
import { WateringPanel } from '@/components/inventory/watering-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteUserPlant, listUserPlants, plantDisplayName, type InventoryPlant } from '@/utils/plants';

export default function PlantDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [plant, setPlant] = useState<InventoryPlant | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const plants = await listUserPlants();
        setPlant(plants.find((item) => item.id === id) ?? null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load that plant');
      }
    })();
  }, [id]);

  const name = plantDisplayName(plant?.info);
  const scientificName = plant?.info?.scientific_name;

  function handleRemove() {
    if (!plant) {
      return;
    }

    Alert.alert('Remove this plant?', 'It will be removed from your garden. You can add it again later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteUserPlant(plant.id);
              router.replace('/');
            } catch (removeError) {
              setError(removeError instanceof Error ? removeError.message : 'Could not remove plant');
            }
          })();
        },
      },
    ]);
  }

  return (
    <ThemedView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        <PlantBanner
          photoUrl={plant?.info?.image_url}
          name={name}
          scientificName={scientificName}
          onBack={() => router.back()}
        />

        <View style={[styles.pageBody, { backgroundColor: theme.background }]}>
          <GardenFrame variant="bed">
            <WateringPanel watering={plant?.info?.watering} />
          </GardenFrame>
          <GardenFrame variant="bed">
            <SoilPanel soilType={plant?.info?.best_soil_type} />
          </GardenFrame>

          {error ? (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          ) : null}

          {plant ? (
            <Pressable
              accessibilityRole="button"
              onPress={handleRemove}
              style={({ pressed }) => [
                styles.deleteButton,
                { borderColor: theme.woodEdge, backgroundColor: theme.surface },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.danger }}>
                Delete plant
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    width: '100%',
  },
  pageBody: {
    flexGrow: 1,
    width: '100%',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  deleteButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  pressed: {
    opacity: 0.65,
  },
});
