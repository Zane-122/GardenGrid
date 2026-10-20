import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { FriendlyButton } from '@/components/app/friendly-button';
import { GardenFrame } from '@/components/app/garden-frame';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GardenPalette, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  buyCommunityPlots,
  donateItemToCommunity,
  getCommunityGarden,
  placePlantInCommunityGarden,
  type CommunityGarden,
  type CommunityGardenItem,
  type CommunityKitItem,
  type CommunityKitPlant,
} from '@/utils/community-garden';
import {
  connectedPlotKeys,
  GARDEN_SLOT_GAP,
  gardenTilesPrice,
  tileKey,
} from '@/utils/garden';
import { formatOxygenMl, getCurrencyBalances } from '@/utils/plants';
import { itemCells, itemSpan, shopItemImageUrl } from '@/utils/shop-items';

const CELL = 64;

function errorText(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return error instanceof Error ? error.message : fallback;
}

export default function CommunityGardenScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const communityId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [garden, setGarden] = useState<CommunityGarden | null>(null);
  const [balances, setBalances] = useState({ oxygen: 0, pollen: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [selectedPlots, setSelectedPlots] = useState<string[]>([]);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!communityId) {
      return;
    }
    setError(null);
    try {
      const [nextGarden, nextBalances] = await Promise.all([
        getCommunityGarden(communityId),
        getCurrencyBalances(),
      ]);
      setGarden(nextGarden);
      setBalances(nextBalances);
    } catch (loadError) {
      setError(errorText(loadError, 'Could not open that garden'));
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const covered = useMemo(() => {
    const keys = new Set<string>();
    for (const item of garden?.items ?? []) {
      for (const cell of itemCells(item.col, item.row, footprint(item))) {
        keys.add(tileKey(cell.col, cell.row));
      }
    }
    return keys;
  }, [garden?.items]);

  const plantAt = useMemo(() => {
    const map = new Map<string, CommunityGarden['plants'][number]>();
    for (const plant of garden?.plants ?? []) {
      map.set(tileKey(plant.col, plant.row), plant);
    }
    return map;
  }, [garden?.plants]);

  const candidates = useMemo(() => {
    if (!garden || !buying) {
      return [] as { col: number; row: number }[];
    }
    const owned = new Set(garden.tiles.map((tile) => tileKey(tile.col, tile.row)));
    const extra: { col: number; row: number }[] = [];
    const seen = new Set<string>();
    for (const tile of garden.tiles) {
      for (const [colOffset, rowOffset] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        const col = tile.col + colOffset;
        const row = tile.row + rowOffset;
        const key = tileKey(col, row);
        if (owned.has(key) || seen.has(key)) {
          continue;
        }
        seen.add(key);
        extra.push({ col, row });
      }
    }
    return extra;
  }, [buying, garden]);

  const cells = useMemo(() => {
    const owned = (garden?.tiles ?? []).map((tile) => ({ ...tile, owned: true as const }));
    return [...owned, ...candidates.map((tile) => ({ ...tile, id: tileKey(tile.col, tile.row), owned: false as const }))];
  }, [candidates, garden?.tiles]);

  const bounds = useMemo(() => {
    const cols = cells.map((cell) => cell.col);
    const rows = cells.map((cell) => cell.row);
    return {
      minCol: cols.length ? Math.min(...cols) : 0,
      minRow: rows.length ? Math.min(...rows) : 0,
      maxCol: cols.length ? Math.max(...cols) : 0,
      maxRow: rows.length ? Math.max(...rows) : 0,
    };
  }, [cells]);

  const price = gardenTilesPrice(garden?.tiles.length ?? 0, selectedPlots.length);
  const boardWidth = (bounds.maxCol - bounds.minCol + 1) * CELL + (bounds.maxCol - bounds.minCol) * GARDEN_SLOT_GAP;
  const boardHeight = (bounds.maxRow - bounds.minRow + 1) * CELL + (bounds.maxRow - bounds.minRow) * GARDEN_SLOT_GAP;

  async function confirmBuy() {
    if (!communityId || !garden || selectedPlots.length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await buyCommunityPlots(
        communityId,
        selectedPlots.map((key) => {
          const [col, row] = key.split(':').map(Number);
          return { col, row };
        }),
      );
      setSelectedPlots([]);
      setBuying(false);
      await load();
    } catch (buyError) {
      setError(errorText(buyError, 'Could not buy those plots'));
    } finally {
      setBusy(false);
    }
  }

  async function giveAt(col: number, row: number) {
    if (!communityId || busy) {
      return;
    }
    const key = tileKey(col, row);
    if (plantAt.has(key) || covered.has(key)) {
      return;
    }
    if (!selectedPlantId && !selectedItemId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (selectedPlantId) {
        await placePlantInCommunityGarden(selectedPlantId, communityId, col, row);
        setSelectedPlantId(null);
      } else if (selectedItemId) {
        await donateItemToCommunity(selectedItemId, communityId, col, row);
        setSelectedItemId(null);
      }
      await load();
    } catch (placeError) {
      setError(errorText(placeError, 'Could not add that to the garden'));
    } finally {
      setBusy(false);
    }
  }

  function togglePlot(col: number, row: number) {
    if (!garden) {
      return;
    }
    const key = tileKey(col, row);
    setSelectedPlots((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      return connectedPlotKeys(garden.tiles, next);
    });
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <FriendlyButton label="Back" variant="ghost" onPress={() => router.back()} />
          <ThemedText type="heading">{garden?.name ?? 'Community garden'}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {loading && !garden
              ? 'Loading the garden…'
              : `${formatOxygenMl(garden?.totalOxygen ?? 0)} produced in total`}
          </ThemedText>
        </View>

        {error ? <ThemedText style={{ color: theme.danger }}>{error}</ThemedText> : null}

        <GardenFrame contentStyle={styles.card}>
          <ThemedText type="smallBold">Oxygen from members</ThemedText>
          {(garden?.contributions ?? []).length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No members yet.
            </ThemedText>
          ) : (
            garden?.contributions.map((member) => (
              <View key={member.userId} style={styles.statRow}>
                <ThemedText type="small" style={styles.statName} numberOfLines={1}>
                  {member.displayName}
                </ThemedText>
                <ThemedText type="smallBold">{formatOxygenMl(member.oxygenMl)}</ThemedText>
              </View>
            ))
          )}
        </GardenFrame>

        <View style={styles.actions}>
          <FriendlyButton
            label={buying ? 'Stop buying' : 'Buy plots'}
            variant={buying ? 'ghost' : 'primary'}
            disabled={busy || !garden}
            onPress={() => {
              setBuying((current) => !current);
              setSelectedPlots([]);
              setSelectedPlantId(null);
              setSelectedItemId(null);
            }}
          />
          {buying ? (
            <FriendlyButton
              label={
                selectedPlots.length === 0
                  ? 'Select edge plots'
                  : busy
                    ? 'Buying…'
                    : `Buy ${selectedPlots.length} · ${price.oxygen.toLocaleString()} oxygen, ${price.pollen.toLocaleString()} pollen`
              }
              disabled={busy || selectedPlots.length === 0}
              onPress={() => void confirmBuy()}
            />
          ) : null}
        </View>
        {buying ? (
          <ThemedText type="small" themeColor="textSecondary">
            You have {Math.round(balances.oxygen).toLocaleString()} oxygen and {Math.round(balances.pollen).toLocaleString()} pollen.
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {selectedPlantId || selectedItemId
              ? 'Tap an empty plot to give it. A plant can only live in one garden.'
              : 'Choose a plant or shop item below to give it to this garden.'}
          </ThemedText>
        )}

        <View style={[styles.board, { width: boardWidth, height: Math.max(boardHeight, CELL) }]}>
          {cells.map((cell) => {
            const key = tileKey(cell.col, cell.row);
            const plant = plantAt.get(key);
            const selected = selectedPlots.includes(key);
            const taken = Boolean(plant) || covered.has(key);
            const canGive = Boolean(selectedPlantId || selectedItemId);
            return (
              <Pressable
                key={cell.owned ? cell.id : key}
                disabled={busy || (cell.owned ? buying || taken || !canGive : !buying)}
                onPress={() => {
                  if (!cell.owned) {
                    togglePlot(cell.col, cell.row);
                    return;
                  }
                  void giveAt(cell.col, cell.row);
                }}
                style={[
                  styles.cell,
                  {
                    left: (cell.col - bounds.minCol) * (CELL + GARDEN_SLOT_GAP),
                    top: (cell.row - bounds.minRow) * (CELL + GARDEN_SLOT_GAP),
                    backgroundColor: cell.owned ? GardenPalette.plot : 'transparent',
                    borderColor: selected ? GardenPalette.highlight : GardenPalette.plotLine,
                    borderStyle: cell.owned ? 'solid' : 'dashed',
                  },
                ]}>
                {plant ? (
                  <PlantFace name={plant.name} uri={plant.photoUrl ?? plant.imageUrl} owner={plant.ownerName} />
                ) : null}
              </Pressable>
            );
          })}
          {(garden?.items ?? []).map((item) => {
            const span = itemSpan(footprint(item));
            const uri = shopItemImageUrl(item.imagePath);
            return (
              <View
                key={item.id}
                pointerEvents="none"
                style={[
                  styles.item,
                  {
                    left: (item.col - bounds.minCol) * (CELL + GARDEN_SLOT_GAP),
                    top: (item.row - bounds.minRow) * (CELL + GARDEN_SLOT_GAP),
                    width: span.cols * CELL + (span.cols - 1) * GARDEN_SLOT_GAP,
                    height: span.rows * CELL + (span.rows - 1) * GARDEN_SLOT_GAP,
                  },
                ]}>
                {uri ? <Image source={uri} style={styles.fill} contentFit="contain" /> : null}
                <ThemedText type="small" numberOfLines={1} style={styles.owner}>
                  {item.ownerName}
                </ThemedText>
              </View>
            );
          })}
        </View>

        <ThemedText type="smallBold">Plants you can give</ThemedText>
        <KitRow
          empty="Every plant you own is already in a garden."
          items={garden?.kitPlants ?? []}
          selectedId={selectedPlantId}
          onSelect={(id) => {
            setBuying(false);
            setSelectedPlots([]);
            setSelectedItemId(null);
            setSelectedPlantId((current) => (current === id ? null : id));
          }}
          render={(plant) => <PlantFace name={plant.name} uri={plant.photoUrl ?? plant.imageUrl} />}
        />

        <ThemedText type="smallBold">Shop items you can give</ThemedText>
        <KitRow
          empty="Buy something from the shop, then give an unplaced copy here."
          items={garden?.kitItems ?? []}
          selectedId={selectedItemId}
          onSelect={(id) => {
            setBuying(false);
            setSelectedPlots([]);
            setSelectedPlantId(null);
            setSelectedItemId((current) => (current === id ? null : id));
          }}
          render={(item) => {
            const uri = shopItemImageUrl(item.imagePath);
            return uri ? <Image source={uri} style={styles.kitImage} contentFit="contain" /> : <ThemedText type="small">{item.name}</ThemedText>;
          }}
        />
      </ScrollView>
    </ThemedView>
  );
}

function footprint(item: Pick<CommunityGardenItem, 'footprintCols' | 'footprintRows' | 'rotation'> | CommunityKitItem) {
  return {
    footprint_cols: item.footprintCols,
    footprint_rows: item.footprintRows,
    rotation: item.rotation,
  };
}

function PlantFace({ name, uri, owner }: { name: string; uri: string | null; owner?: string }) {
  return (
    <View style={styles.fill}>
      {uri ? <Image source={{ uri }} style={styles.fill} contentFit="cover" /> : null}
      <ThemedText type="small" numberOfLines={1} style={styles.owner}>
        {owner ?? name}
      </ThemedText>
    </View>
  );
}

function KitRow<T extends { id: string; name: string }>({
  items,
  empty,
  selectedId,
  onSelect,
  render,
}: {
  items: T[];
  empty: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  render: (item: T) => ReactNode;
}) {
  if (items.length === 0) {
    return <ThemedText type="small" themeColor="textSecondary">{empty}</ThemedText>;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kit}>
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <Pressable
            key={item.id}
            onPress={() => onSelect(item.id)}
            style={[styles.kitItem, selected && styles.kitSelected]}>
            {render(item)}
            <ThemedText type="small" numberOfLines={1}>
              {item.name}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  header: { gap: Spacing.half },
  card: { gap: Spacing.two },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  statName: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  board: { alignSelf: 'center', position: 'relative' },
  cell: {
    position: 'absolute',
    width: CELL,
    height: CELL,
    borderWidth: 2,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  item: { position: 'absolute', zIndex: 2 },
  fill: { flex: 1, width: '100%', height: '100%' },
  owner: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 2,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 3,
  },
  kit: { gap: Spacing.two, paddingVertical: Spacing.one },
  kitItem: {
    width: 96,
    gap: Spacing.half,
    padding: Spacing.one,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  kitSelected: { borderColor: GardenPalette.highlight },
  kitImage: { width: '100%', height: 64 },
});
