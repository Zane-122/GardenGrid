import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppScreen } from '@/components/app/app-screen';
import { GardenFrame } from '@/components/app/garden-frame';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function AddHubScreen() {
  const theme = useTheme();

  return (
    <AppScreen
      title="Add plant"
      directions="Search by name or identify a plant from a photo."
      step={1}
      totalSteps={3}
      showBack={false}>
      <GardenFrame padded={false}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/add/search')}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={[styles.icon, { backgroundColor: theme.backgroundElement }]}>
            <SymbolView
              tintColor={theme.wood}
              name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
              size={20}
            />
          </View>
          <View style={styles.copy}>
            <ThemedText type="smallBold">Search by name</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Look up a common name such as basil or aloe.
            </ThemedText>
          </View>
          <SymbolView
            tintColor={theme.wood}
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={16}
          />
        </Pressable>
      </GardenFrame>

      <GardenFrame padded={false}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/add/photo')}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={[styles.icon, { backgroundColor: theme.backgroundElement }]}>
            <SymbolView
              tintColor={theme.wood}
              name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
              size={20}
            />
          </View>
          <View style={styles.copy}>
            <ThemedText type="smallBold">Identify from photo</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Take a photo or choose one from your library.
            </ThemedText>
          </View>
          <SymbolView
            tintColor={theme.wood}
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={16}
          />
        </Pressable>
      </GardenFrame>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  pressed: {
    opacity: 0.7,
  },
});
