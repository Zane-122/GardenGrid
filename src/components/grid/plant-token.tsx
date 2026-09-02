import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { plantDisplayName, type InventoryPlant } from '@/utils/plants';

type PlantTokenProps = {
  plant: InventoryPlant;
  compact?: boolean;
  placed?: boolean;
  selected?: boolean;
};

export function PlantToken({ plant, compact = false, placed = false, selected = false }: PlantTokenProps) {
  const theme = useTheme();
  const name = plantDisplayName(plant.info);

  const image = plant.info?.image_url ? (
    <Image
      source={{ uri: plant.info.image_url }}
      style={compact ? styles.compactImage : styles.slotImage}
      contentFit="cover"
      pointerEvents="none"
    />
  ) : (
    <View
      style={[
        compact ? styles.compactImage : styles.slotImage,
        styles.placeholder,
        { backgroundColor: theme.backgroundElement },
      ]}>
      <ThemedText type="small" themeColor="textSecondary">
        ?
      </ThemedText>
    </View>
  );

  if (!compact) {
    return (
      <View style={styles.slotToken}>
        {image}
        <View style={styles.slotCaption}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.slotName}>
            {name}
          </ThemedText>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.token,
        styles.compact,
        {
          backgroundColor: theme.surface,
          borderColor: selected ? theme.primary : theme.border,
        },
        selected && { borderWidth: 2 },
        placed && { opacity: 0.72 },
      ]}>
      {image}
      <View style={[styles.caption, styles.compactCaption]}>
        <ThemedText type="smallBold" numberOfLines={2}>
          {name}
        </ThemedText>
        {placed ? (
          <ThemedText type="small" themeColor="textSecondary">
            In grid
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  token: {
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: Radius.sm,
  },
  slotToken: {
    flex: 1,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  compact: {
    width: 104,
    height: 128,
  },
  slotImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  compactImage: {
    height: 72,
    width: '100%',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    gap: 2,
  },
  compactCaption: {
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
  },
  slotCaption: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  slotName: {
    color: '#FFFFFF',
  },
});
