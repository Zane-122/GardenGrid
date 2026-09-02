import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendlyButton } from '@/components/app/friendly-button';
import { GardenFrame } from '@/components/app/garden-frame';
import { PlantBanner } from '@/components/inventory/plant-banner';
import { SoilPanel } from '@/components/inventory/soil-panel';
import { WateringPanel } from '@/components/inventory/watering-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useAddPlant } from '@/context/add-plant';
import { useTheme } from '@/hooks/use-theme';
import { confirmAddPlant, plantDisplayName } from '@/utils/plants';

export default function AddConfirmScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { preview, setPreview } = useAddPlant();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!preview) {
      router.replace('/add');
    }
  }, [preview]);

  if (!preview) {
    return null;
  }

  const name = plantDisplayName(preview.info, preview.fallbackName);
  const scientificName = preview.info.scientific_name;
  const matchPercent =
    typeof preview.probability === 'number' && Number.isFinite(preview.probability)
      ? Math.round(preview.probability * 100)
      : null;
  const hints = (preview.similarImages ?? []).filter((image) => image.url);

  async function handleConfirm() {
    if (confirming) {
      return;
    }

    setConfirming(true);
    setError(null);
    try {
      await confirmAddPlant(preview.info.plant_id);
      setPreview(null);
      router.replace('/');
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Could not add that plant');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <ThemedView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.previewBanner,
            {
              paddingTop: insets.top + Spacing.two,
              backgroundColor: theme.woodOuter,
              borderBottomColor: theme.woodEdge,
            },
          ]}>
          <SymbolView
            tintColor={theme.woodEdge}
            name={{ ios: 'info.circle', android: 'info', web: 'info' }}
            size={18}
          />
          <ThemedText type="small" style={[styles.previewCopy, { color: theme.woodEdge }]} numberOfLines={1}>
            {matchPercent != null
              ? `Preview — ${matchPercent}% photo match. Not in your garden yet.`
              : 'Preview — this plant is not in your garden yet.'}
          </ThemedText>
          <View style={styles.previewSpacer} />
        </View>

        <PlantBanner
          photoUrl={preview.info.image_url}
          name={name}
          scientificName={scientificName}
          flushTop
          onBack={() => router.back()}
        />

        <View style={[styles.pageBody, { backgroundColor: theme.background }]}>
          <GardenFrame variant="bed">
            <WateringPanel watering={preview.info.watering} />
          </GardenFrame>
          <GardenFrame variant="bed">
            <SoilPanel soilType={preview.info.best_soil_type} />
          </GardenFrame>

          {hints.length > 0 ? (
            <GardenFrame variant="bed">
              <View style={styles.hints}>
                <ThemedText type="smallBold">Similar images</ThemedText>
                <View style={styles.hintRow}>
                  {hints.map((image) => (
                    <View
                      key={image.url}
                      style={[styles.hintFrame, { backgroundColor: theme.backgroundElement, borderColor: theme.wood }]}>
                      <Image
                        source={{ uri: image.url }}
                        style={styles.hintImage}
                        contentFit="contain"
                      />
                    </View>
                  ))}
                </View>
              </View>
            </GardenFrame>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={[
          styles.actions,
          {
            borderTopColor: theme.wood,
            backgroundColor: theme.surface,
          },
        ]}>
        {error ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        ) : null}
        <FriendlyButton
          label={confirming ? 'Adding…' : 'Add to garden'}
          disabled={confirming}
          onPress={() => void handleConfirm()}
        />
        <FriendlyButton
          label="Cancel"
          variant="ghost"
          disabled={confirming}
          onPress={() => router.back()}
        />
      </View>
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
  previewBanner: {
    width: '100%',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderBottomWidth: 1,
  },
  previewCopy: {
    flex: 1,
    textAlign: 'center',
  },
  previewSpacer: {
    width: 18,
  },
  pageBody: {
    flexGrow: 1,
    width: '100%',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  hints: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  hintRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  hintFrame: {
    flex: 1,
    height: 200,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
  },
  hintImage: {
    width: '100%',
    height: '100%',
  },
  actions: {
    width: '100%',
    borderTopWidth: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
});
