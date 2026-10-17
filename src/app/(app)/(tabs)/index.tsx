import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { FriendlyButton } from '@/components/app/friendly-button';
import { GardenFrame } from '@/components/app/garden-frame';
import { PlantCard } from '@/components/inventory/plant-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useOnboarding } from '@/context/onboarding';
import { useTheme } from '@/hooks/use-theme';
import { deleteUserPlant, listUserPlants, type InventoryPlant } from '@/utils/plants';
import { listWateredPlantIds, markPlantsWatered } from '@/utils/watering';

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function GardenScreen() {
  const theme = useTheme();
  const { profile } = useOnboarding();
  const { signOut } = useAuth();
  const [plants, setPlants] = useState<InventoryPlant[]>([]);
  const [wateredIds, setWateredIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPlants = useCallback(async () => {
    setError(null);
    try {
      setPlants(await listUserPlants());
    } catch (loadError) {
      setError(errorText(loadError, 'Could not load your plants'));
      setLoading(false);
      return;
    }

    try {
      const nextWatered = await listWateredPlantIds();
      setWateredIds(nextWatered);
      setSelectedIds(new Set());
      setSelecting(false);
    } catch (loadError) {
      setError(errorText(loadError, 'Could not load watering logs'));
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
              setError(errorText(removeError, 'Could not remove plant'));
            }
          })();
        },
      },
    ]);
  }

  const needsWaterIds = plants.filter((plant) => !wateredIds.has(plant.id)).map((plant) => plant.id);
  const firstName = profile?.displayName?.split(' ')[0];
  const subtitle = loading
    ? 'Loading plants…'
    : plants.length === 0
      ? firstName
        ? `Welcome back, ${firstName}.`
        : 'Your garden is empty.'
      : needsWaterIds.length === 0
        ? `${plants.length} plant${plants.length === 1 ? '' : 's'} · all watered today`
        : `${needsWaterIds.length} plant${needsWaterIds.length === 1 ? '' : 's'} still need water`;

  function toggleSelected(plantId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(plantId)) {
        next.delete(plantId);
      } else {
        next.add(plantId);
      }
      return next;
    });
  }

  async function markWatered(plantIds: string[]) {
    if (saving || plantIds.length === 0) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await markPlantsWatered(plantIds);
      setWateredIds((current) => {
        const next = new Set(current);
        for (const plantId of plantIds) {
          next.add(plantId);
        }
        return next;
      });
      setSelectedIds(new Set());
      setSelecting(false);
    } catch (markError) {
      setError(errorText(markError, 'Could not mark plants as watered'));
    } finally {
      setSaving(false);
    }
  }

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

        {plants.length > 0 ? (
          <View style={styles.actions}>
            {selecting ? (
              <>
                <FriendlyButton
                  label={
                    saving
                      ? 'Saving…'
                      : selectedIds.size === 0
                        ? 'Mark watered'
                        : `Mark ${selectedIds.size} watered`
                  }
                  disabled={saving || selectedIds.size === 0}
                  onPress={() => void markWatered([...selectedIds])}
                />
                <FriendlyButton
                  label="Cancel"
                  variant="ghost"
                  disabled={saving}
                  onPress={() => {
                    setSelecting(false);
                    setSelectedIds(new Set());
                  }}
                />
              </>
            ) : (
              <FriendlyButton
                label="Select plants to water"
                variant="ghost"
                disabled={needsWaterIds.length === 0}
                onPress={() => setSelecting(true)}
              />
            )}
          </View>
        ) : null}

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
              <GardenFrame variant="bed" contentStyle={styles.empty}>
                <ThemedText type="smallBold">No plants yet</ThemedText>
                <ThemedText themeColor="textSecondary">
                  Add a plant by name or identify one from a photo.
                </ThemedText>
                <FriendlyButton label="Add plant" onPress={() => router.push('/add')} />
              </GardenFrame>
            )
          }
          renderItem={({ item }) => {
            const needsWater = !wateredIds.has(item.id);
            return (
              <PlantCard
                plant={item}
                needsWater={needsWater}
                selecting={selecting}
                selected={selectedIds.has(item.id)}
                onPress={() => {
                  if (selecting) {
                    if (needsWater) {
                      toggleSelected(item.id);
                    }
                    return;
                  }
                  router.push(`/plant/${item.id}`);
                }}
                onRemove={selecting ? undefined : () => confirmRemove(item)}
                onMarkWatered={
                  selecting || !needsWater || saving ? undefined : () => void markWatered([item.id])
                }
              />
            );
          }}
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
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  list: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
    flexGrow: 1,
  },
  empty: {
    gap: Spacing.three,
    padding: Spacing.four,
  },
  pressed: {
    opacity: 0.6,
  },
});
