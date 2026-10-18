import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { GardenFrame } from '@/components/app/garden-frame';
import { NeedsWaterBubble } from '@/components/inventory/needs-water-bubble';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  formatOxygenMl,
  formatPollenMg,
  plantDisplayName,
  plantImageUrl,
  wateringLabel,
  type InventoryPlant,
} from '@/utils/plants';

type PlantCardProps = {
  plant: InventoryPlant;
  needsWater?: boolean;
  selecting?: boolean;
  selected?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
  onMarkWatered?: () => void;
};

export function PlantCard({
  plant,
  needsWater = false,
  selecting = false,
  selected = false,
  onPress,
  onRemove,
  onMarkWatered,
}: PlantCardProps) {
  const theme = useTheme();
  const name = plantDisplayName(plant.info);
  const scientificName = plant.info?.scientific_name;
  const watering = wateringLabel(plant.info?.watering);
  const photoUrl = plantImageUrl(plant);

  const details = (
    <>
      <View style={styles.photo}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.image} contentFit="cover" />
        ) : (
          <View style={[styles.image, styles.placeholder, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">
              ?
            </ThemedText>
          </View>
        )}
        {needsWater ? <NeedsWaterBubble /> : null}
      </View>

      <View style={styles.body}>
        <ThemedText type="smallBold" numberOfLines={2}>{name}</ThemedText>
        {scientificName && scientificName !== name ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.scientific}>
            {scientificName}
          </ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          Oxygen: {formatOxygenMl(plant.oxygen_ml)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Pollen: {formatPollenMg(plant.pollen_mg)}
        </ThemedText>
        {watering ? (
          <ThemedText type="small" themeColor="textSecondary">
            Water: {watering}
          </ThemedText>
        ) : null}
        {needsWater ? (
          <ThemedText type="small" style={{ color: theme.info }}>
            Needs water today
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Watered today
          </ThemedText>
        )}
        {onMarkWatered ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Mark ${name} as watered`}
            onPress={onMarkWatered}
            style={({ pressed }) => [styles.mark, pressed && styles.pressed]}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              Mark watered
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </>
  );

  return (
    <GardenFrame padded={false}>
      <View style={[styles.card, selecting && !needsWater && styles.dimmed]}>
        {onPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={selecting ? `Select ${name}` : name}
            accessibilityState={{ selected }}
            onPress={onPress}
            style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
            {details}
          </Pressable>
        ) : (
          <View style={styles.main}>{details}</View>
        )}

        {selecting && needsWater ? (
          <View
            style={[
              styles.check,
              {
                borderColor: selected ? theme.primary : theme.border,
                backgroundColor: selected ? theme.primary : theme.surface,
              },
            ]}>
            {selected ? (
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                ✓
              </ThemedText>
            ) : null}
          </View>
        ) : null}

        {onRemove ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${name}`}
            onPress={onRemove}
            style={({ pressed }) => [styles.remove, pressed && styles.pressed]}>
            <ThemedText type="smallBold" style={{ color: theme.danger }}>
              Remove
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </GardenFrame>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
  },
  dimmed: {
    opacity: 0.55,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  photo: {
    width: 64,
    height: 64,
  },
  image: {
    width: 64,
    height: 64,
    borderRadius: Radius.md,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: Spacing.half,
  },
  scientific: {
    fontStyle: 'italic',
  },
  mark: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.one,
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.two,
  },
  remove: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  pressed: {
    opacity: 0.75,
  },
});
