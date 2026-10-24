import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { NeedsWaterBubble } from '@/components/inventory/needs-water-bubble';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

function bannerType(width: number) {
  if (width >= 1100) {
    return { name: 68, nameLine: 76, scientific: 24, scientificLine: 32, banner: 460 };
  }
  if (width >= 768) {
    return { name: 52, nameLine: 60, scientific: 20, scientificLine: 26, banner: 380 };
  }
  if (width < 500) {
    return { name: 28, nameLine: 34, scientific: 14, scientificLine: 18, banner: 200 };
  }
  return { name: 32, nameLine: 38, scientific: 15, scientificLine: 20, banner: 260 };
}

type PlantBannerProps = {
  photoUrl?: string | null;
  name: string;
  scientificName?: string | null;
  needsWater?: boolean;
  flushTop?: boolean;
  onBack: () => void;
};

export function PlantBanner({
  photoUrl,
  name,
  scientificName,
  needsWater = false,
  onBack,
}: PlantBannerProps) {
  const { width } = useWindowDimensions();
  const type = bannerType(width);

  return (
    <View
      style={[
        styles.banner,
        { minHeight: type.banner, paddingTop: Spacing.three },
      ]}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
      )}
      <View style={styles.overlay} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={12}
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
        <SymbolView
          tintColor="#FFFFFF"
          name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
          size={18}
        />
      </Pressable>

      {needsWater ? (
        <NeedsWaterBubble
          style={{ top: Spacing.three + 4, right: Spacing.four }}
        />
      ) : null}

      <View style={styles.copy}>
        <ThemedText style={[styles.name, { fontSize: type.name, lineHeight: type.nameLine }]}>
          {name}
        </ThemedText>
        {scientificName ? (
          <ThemedText
            style={[styles.scientific, { fontSize: type.scientific, lineHeight: type.scientificLine }]}>
            {scientificName}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: '100%',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  placeholder: {
    backgroundColor: '#EEEEEE',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  copy: {
    zIndex: 1,
    gap: Spacing.one,
    maxWidth: 920,
    paddingRight: Spacing.three,
  },
  name: {
    color: '#FFFFFF',
    fontWeight: 600,
  },
  scientific: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontStyle: 'italic',
  },
  pressed: {
    opacity: 0.65,
  },
});
