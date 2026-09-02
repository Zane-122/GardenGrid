import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { GardenFrame } from '@/components/app/garden-frame';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { plantDisplayName, wateringLabel, type InventoryPlant } from '@/utils/plants';

type PlantCardProps = {
  plant: InventoryPlant;
  onPress?: () => void;
  onRemove?: () => void;
};

export function PlantCard({ plant, onPress, onRemove }: PlantCardProps) {
  const theme = useTheme();
  const name = plantDisplayName(plant.info);
  const scientificName = plant.info?.scientific_name;
  const watering = wateringLabel(plant.info?.watering);

  const details = (
    <>
      {plant.info?.image_url ? (
        <Image source={{ uri: plant.info.image_url }} style={styles.image} contentFit="cover" />
      ) : (
        <View style={[styles.image, styles.placeholder, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">
            ?
          </ThemedText>
        </View>
      )}

      <View style={styles.body}>
        <ThemedText type="smallBold">{name}</ThemedText>
        {scientificName && scientificName !== name ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.scientific}>
            {scientificName}
          </ThemedText>
        ) : null}
        {watering ? (
          <ThemedText type="small" themeColor="textSecondary">
            Water: {watering}
          </ThemedText>
        ) : null}
      </View>
    </>
  );

  return (
    <GardenFrame padded={false}>
      <View style={styles.card}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={name}
          onPress={onPress}
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
          {details}
        </Pressable>
      ) : (
        <View style={styles.main}>{details}</View>
      )}

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
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  image: {
    width: 76,
    height: 76,
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
  remove: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  pressed: {
    opacity: 0.75,
  },
});
