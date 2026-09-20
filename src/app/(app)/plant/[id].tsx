import * as ImagePicker from 'expo-image-picker';
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
import {
  deleteUserPlant,
  listUserPlants,
  plantDisplayName,
  plantImageUrl,
  updatePlantPhoto,
  type InventoryPlant,
} from '@/utils/plants';

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
  const [error, setError] = useState<string | null>(null);
  const [updatingPhoto, setUpdatingPhoto] = useState(false);

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
  const lastUpdatedLabel = formatLastUpdated(plant?.last_recalibrated_at);

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
      setPlant(plants.find((item) => item.id === plant.id) ?? null);
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
