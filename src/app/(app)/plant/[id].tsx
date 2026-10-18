import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { FriendlyButton } from '@/components/app/friendly-button';
import { GardenFrame } from '@/components/app/garden-frame';
import { GrowthChart } from '@/components/inventory/growth-chart';
import { PlantBanner } from '@/components/inventory/plant-banner';
import { SoilPanel } from '@/components/inventory/soil-panel';
import { WateringPanel } from '@/components/inventory/watering-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  deleteUserPlant,
  latestPlantGrowthObservation,
  listUserPlants,
  formatOxygenMl,
  formatPollenMg,
  plantDisplayName,
  plantGrowthCurveParams,
  plantImageUrl,
  updatePlantPhoto,
  type InventoryPlant,
  type PlantGrowthObservation,
} from '@/utils/plants';
import { seasonalBloomMultiplier } from '@/utils/seasonal-bloom';
import {
  formatWateredOn,
  getPlantWateringStatus,
  markPlantsWatered,
  type PlantWateringStatus,
} from '@/utils/watering';

function seasonLabel(multiplier: number) {
  if (multiplier <= 0) {
    return 'Outside the bloom season, so no pollen is emitted.';
  }
  if (multiplier >= 0.999) {
    return 'Peak season, so pollen is emitted in full.';
  }
  return `This time of year emits ${Math.round(multiplier * 100)}% of peak pollen.`;
}

function formatLastUpdated(lastRecalibratedAt: string | null | undefined) {
  if (!lastRecalibratedAt) {
    return 'Not yet updated';
  }

  const date = new Date(lastRecalibratedAt);
  if (Number.isNaN(date.getTime())) {
    return 'Not yet updated';
  }

  return `Last updated: ${date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`;
}

export default function PlantDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [plant, setPlant] = useState<InventoryPlant | null>(null);
  const [observation, setObservation] = useState<PlantGrowthObservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatingPhoto, setUpdatingPhoto] = useState(false);
  const [wateringStatus, setWateringStatus] = useState<PlantWateringStatus | null>(null);
  const [markingWatered, setMarkingWatered] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const plants = await listUserPlants();
        const found = plants.find((item) => item.id === id) ?? null;
        setPlant(found);
        const [nextObservation, nextWatering] = await Promise.all([
          found ? latestPlantGrowthObservation(found.id) : Promise.resolve(null),
          found ? getPlantWateringStatus(found.id) : Promise.resolve(null),
        ]);
        setObservation(nextObservation);
        setWateringStatus(nextWatering);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load that plant');
      }
    })();
  }, [id]);

  const name = plantDisplayName(plant?.info);
  const scientificName = plant?.info?.scientific_name;
  const lastUpdatedLabel = formatLastUpdated(plant?.last_recalibrated_at);
  // Prefer this plant's own photo-recalibrated curve; fall back to the
  // species' base params if it doesn't have one (or hasn't been photographed yet).
  const growthParams = observation?.params ?? plantGrowthCurveParams(plant?.info);

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

  async function handleMarkWatered() {
    if (!plant || markingWatered || wateringStatus?.wateredToday) {
      return;
    }

    setMarkingWatered(true);
    setError(null);
    try {
      await markPlantsWatered([plant.id]);
      setWateringStatus(await getPlantWateringStatus(plant.id));
    } catch (markError) {
      setError(markError instanceof Error ? markError.message : 'Could not mark this plant as watered');
    } finally {
      setMarkingWatered(false);
    }
  }

  async function handleUpdatePhoto(fromCamera: boolean) {
    if (!plant || updatingPhoto) {
      return;
    }

    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        fromCamera ? 'Camera access required' : 'Photo library access required',
        fromCamera
          ? 'Allow camera access to take a photo of this plant.'
          : 'Allow photo library access to choose an existing image.'
      );
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, base64: true });

    if (result.canceled) {
      return;
    }

    const image = result.assets[0];
    const payload = image.base64 ?? image.uri;
    if (!payload) {
      Alert.alert('Could not read that image', 'Try another photo.');
      return;
    }

    setUpdatingPhoto(true);
    try {
      const data = await updatePlantPhoto(plant.id, payload);
      console.log('update-plant-photo response:', JSON.stringify(data, null, 2));
      const plants = await listUserPlants();
      const updated = plants.find((item) => item.id === plant.id) ?? null;
      setPlant(updated);
      setObservation(updated ? await latestPlantGrowthObservation(updated.id) : null);
    } catch (updateError) {
      console.log('update-plant-photo error:', updateError);
      Alert.alert(
        'update-plant-photo error',
        updateError instanceof Error ? updateError.message : String(updateError)
      );
    } finally {
      setUpdatingPhoto(false);
    }
  }

  return (
    <ThemedView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        <PlantBanner
          photoUrl={plant ? plantImageUrl(plant) : null}
          name={name}
          scientificName={scientificName}
          needsWater={plant != null && wateringStatus != null && !wateringStatus.wateredToday}
          onBack={() => router.back()}
        />

        <View style={[styles.pageBody, { backgroundColor: theme.background }]}>
          <GardenFrame variant="bed">
            <GrowthChart params={growthParams} createdAt={plant?.created_at} ageAnchor={observation?.ageAnchor ?? null} />
          </GardenFrame>
          <GardenFrame variant="bed">
            <ThemedText type="smallBold">Oxygen</ThemedText>
            <ThemedText themeColor="textSecondary">
              {plant ? `${formatOxygenMl(plant.oxygen_ml)} produced` : '…'}
            </ThemedText>
          </GardenFrame>
          <GardenFrame variant="bed">
            <ThemedText type="smallBold">Pollen</ThemedText>
            <ThemedText themeColor="textSecondary">
              {plant ? `${formatPollenMg(plant.pollen_mg)} produced` : '…'}
            </ThemedText>
            <ThemedText themeColor="textSecondary">
              {plant?.flower_count != null
                ? `About ${Math.round(plant.flower_count).toLocaleString()} flowers right now.`
                : 'Flower count shows up after a photo, then refreshes every hour.'}
            </ThemedText>
            {plant?.flower_ratio != null ? (
              <ThemedText type="small" themeColor="textSecondary">
                {plant.flower_ratio.toFixed(4)} flowers per cm² of leaf ·{' '}
                {plant.pollen_per_flower_mg?.toFixed(1) ?? '0'} mg pollen per flower every 8 hours at peak
              </ThemedText>
            ) : null}
            {plant?.flower_ratio != null ? (
              <ThemedText type="small" themeColor="textSecondary">
                {seasonLabel(seasonalBloomMultiplier(new Date()))}
              </ThemedText>
            ) : null}
          </GardenFrame>
          <GardenFrame variant="bed">
            <WateringPanel watering={plant?.info?.watering} />
            {plant && wateringStatus ? (
              <View style={styles.wateringStatus}>
                <ThemedText themeColor="textSecondary">
                  {wateringStatus.wateredToday
                    ? 'Watered today.'
                    : wateringStatus.lastWateredOn
                      ? `Last watered ${formatWateredOn(wateringStatus.lastWateredOn)}.`
                      : 'No watering logged yet.'}
                </ThemedText>
                <FriendlyButton
                  label={
                    wateringStatus.wateredToday
                      ? 'Watered today'
                      : markingWatered
                        ? 'Saving…'
                        : 'Mark as watered'
                  }
                  disabled={wateringStatus.wateredToday || markingWatered}
                  onPress={() => void handleMarkWatered()}
                />
              </View>
            ) : null}
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
              disabled={updatingPhoto}
              onPress={() => void handleUpdatePhoto(true)}
              style={({ pressed }) => [
                styles.deleteButton,
                { borderColor: theme.woodEdge, backgroundColor: theme.surface },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold">
                {updatingPhoto ? 'Updating…' : 'Update photo (camera)'}
              </ThemedText>
            </Pressable>
          ) : null}

          {plant ? (
            <Pressable
              accessibilityRole="button"
              disabled={updatingPhoto}
              onPress={() => void handleUpdatePhoto(false)}
              style={({ pressed }) => [
                styles.deleteButton,
                { borderColor: theme.woodEdge, backgroundColor: theme.surface },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold">
                {updatingPhoto ? 'Updating…' : 'Update photo (gallery)'}
              </ThemedText>
            </Pressable>
          ) : null}

          {plant ? (
            <ThemedText type="small" themeColor="textSecondary">
              {lastUpdatedLabel}
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
  wateringStatus: {
    marginTop: Spacing.three,
    gap: Spacing.two,
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
