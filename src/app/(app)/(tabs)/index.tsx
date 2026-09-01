import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { FriendlyButton } from '@/components/app/friendly-button';
import { PlantCard } from '@/components/inventory/plant-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useOnboarding } from '@/context/onboarding';
import { useTheme } from '@/hooks/use-theme';
import { deleteUserPlant, listUserPlants, type InventoryPlant } from '@/utils/plants';

export default function GardenScreen() {
  const theme = useTheme();
  const { profile } = useOnboarding();
  const { signOut } = useAuth();
  const [plants, setPlants] = useState<InventoryPlant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPlants = useCallback(async () => {
    setError(null);
    try {
      setPlants(await listUserPlants());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your plants');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPlants();
    }, [loadPlants])
  );

  function confirmRemove(plant: InventoryPlant) {
    Alert.alert('Remove this plant?', 'It will be removed from your garden. You can add it again later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteUserPlant(plant.id);
              setPlants((current) => current.filter((item) => item.id !== plant.id));
            } catch (removeError) {
              setError(removeError instanceof Error ? removeError.message : 'Could not remove plant');
            }
          })();
        },
      },
    ]);
  }

  const firstName = profile?.displayName?.split(' ')[0];
  const subtitle = loading
    ? 'Loading plants…'
    : plants.length === 0
      ? firstName
        ? `Welcome back, ${firstName}.`
        : 'Your garden is empty.'
      : `${plants.length} plant${plants.length === 1 ? '' : 's'} in your garden`;

  return (
    <ThemedView style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.hello}>
            <ThemedText type="small" themeColor="textSecondary">
              Garden Grid
            </ThemedText>
            <ThemedText type="heading">Garden</ThemedText>
            <ThemedText themeColor="textSecondary">{subtitle}</ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void signOut()}
            hitSlop={8}
            style={({ pressed }) => [pressed && styles.pressed]}>
            <ThemedText type="small" themeColor="textSecondary">
              Log out
            </ThemedText>
          </Pressable>
        </View>

        {error ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        ) : null}

        <FlatList
          data={plants}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={() => void loadPlants()}
          ListEmptyComponent={
            loading ? null : (
              <View style={[styles.empty, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <ThemedText type="smallBold">No plants yet</ThemedText>
                <ThemedText themeColor="textSecondary">
                  Add a plant by name or identify one from a photo.
                </ThemedText>
                <FriendlyButton label="Add plant" onPress={() => router.push('/add')} />
              </View>
            )
          }
          renderItem={({ item }) => (
            <PlantCard
              plant={item}
              onPress={() => router.push(`/plant/${item.id}`)}
              onRemove={() => confirmRemove(item)}
            />
          )}
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.three,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  hello: {
    flex: 1,
    gap: Spacing.half,
  },
  list: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
    flexGrow: 1,
  },
  empty: {
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.four,
  },
  pressed: {
    opacity: 0.6,
  },
});
