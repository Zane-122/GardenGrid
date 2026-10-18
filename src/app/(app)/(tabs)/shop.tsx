import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { FriendlyButton } from '@/components/app/friendly-button';
import { GardenFrame } from '@/components/app/garden-frame';
import { GARDEN_SHAPE_BORDER, GardenBed } from '@/components/grid/garden-shape-border';
import { PlantToken } from '@/components/grid/plant-token';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GardenPalette, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  buyGardenTile,
  GARDEN_SLOT_GAP,
  gardenBoardSize,
  gardenTilePrice,
  gardenViewBounds,
  isOutskirtsTile,
  listGardenSlots,
  listGardenTiles,
  tileKey,
  type GardenSlot,
  type GardenTile,
} from '@/utils/garden';
import { listUserPlants, plantDisplayName, type InventoryPlant } from '@/utils/plants';
import { buyShopItem, listShopItems, shopItemImageUrl, type ShopItem } from '@/utils/shop-items';

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function ShopScreen() {
  const theme = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [tiles, setTiles] = useState<GardenTile[]>([]);
  const [slots, setSlots] = useState<GardenSlot[]>([]);
  const [plants, setPlants] = useState<InventoryPlant[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ShopItem[]>([]);
  const [buyingItemId, setBuyingItemId] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextTiles, nextSlots, nextPlants, nextCatalog] = await Promise.all([
        listGardenTiles(),
        listGardenSlots(),
        listUserPlants(),
        listShopItems(),
      ]);
      setTiles(nextTiles);
      setSlots(nextSlots);
      setPlants(nextPlants);
      setCatalog(nextCatalog);
    } catch (loadError) {
      setError(errorText(loadError, 'Could not load the shop'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const price = gardenTilePrice(tiles.length);

  async function purchase(col: number, row: number) {
    if (buying) {
      return;
    }

    setBuying(true);
    setError(null);
    try {
      await buyGardenTile(col, row);
      setTiles(await listGardenTiles());
      setPickerOpen(false);
    } catch (buyError) {
      setError(errorText(buyError, 'Could not buy that plot'));
    } finally {
      setBuying(false);
    }
  }

  async function purchaseItem(item: ShopItem) {
    if (buying || buyingItemId) {
      return;
    }

    setBuyingItemId(item.id);
    setError(null);
    setNotice(null);
    try {
      await buyShopItem(item.id);
      setPendingItemId(null);
      setNotice(`${item.name} added. Drag it onto a plot from the grid.`);
    } catch (buyError) {
      setError(errorText(buyError, 'Could not buy that item'));
    } finally {
      setBuyingItemId(null);
    }
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.hello}>
          <ThemedText type="heading">Shop</ThemedText>
          <ThemedText themeColor="textSecondary">
            {loading ? 'Loading the shop…' : 'Buy plots, or items you can lay in the garden.'}
          </ThemedText>
        </View>

        {error && !pickerOpen ? <ThemedText style={{ color: theme.danger }}>{error}</ThemedText> : null}
        {notice && !pickerOpen ? <ThemedText themeColor="textSecondary">{notice}</ThemedText> : null}

        <ThemedText type="smallBold">Plots</ThemedText>
        <GardenFrame contentStyle={styles.offer}>
          <ThemedText type="smallBold">Garden plot</ThemedText>
          <ThemedText themeColor="textSecondary">
            Adds a single plot that shares an edge with land you already own.
          </ThemedText>
          <ThemedText type="smallBold">
            {price.oxygen.toLocaleString()} mL oxygen · {price.pollen.toLocaleString()} mg pollen
          </ThemedText>
          <FriendlyButton
            label={loading ? 'Loading…' : 'Choose a plot'}
            disabled={loading || buying}
            onPress={() => {
              setError(null);
              setPickerOpen(true);
            }}
          />
        </GardenFrame>

        <ThemedText type="smallBold">Items</ThemedText>
        {catalog.length === 0 ? (
          <ThemedText themeColor="textSecondary">{loading ? 'Loading items…' : 'Nothing else is for sale.'}</ThemedText>
        ) : (
          catalog.map((item) => {
            const imageUrl = shopItemImageUrl(item.image_path);
            return (
              <GardenFrame key={item.id} contentStyle={styles.itemOffer}>
                {imageUrl ? (
                  <Image
                    source={{ uri: imageUrl }}
                    style={[
                      styles.itemImage,
                      item.footprint_cols * item.footprint_rows > 1 ? styles.itemImageWide : null,
                    ]}
                    contentFit={item.footprint_cols * item.footprint_rows > 1 ? 'contain' : 'cover'}
                  />
                ) : null}
                <View style={styles.itemCopy}>
                  <ThemedText type="smallBold">{item.name}</ThemedText>
                  <ThemedText themeColor="textSecondary">{item.description}</ThemedText>
                  <ThemedText type="smallBold">{item.oxygen_cost.toLocaleString()} mL oxygen</ThemedText>
                  {pendingItemId === item.id ? (
                    <View style={styles.itemActions}>
                      <FriendlyButton
                        label="Cancel"
                        variant="ghost"
                        disabled={buyingItemId !== null}
                        onPress={() => setPendingItemId(null)}
                      />
                      <FriendlyButton
                        label={buyingItemId === item.id ? 'Buying…' : 'Confirm'}
                        disabled={loading || buying || buyingItemId !== null}
                        onPress={() => {
                          void purchaseItem(item);
                        }}
                      />
                    </View>
                  ) : (
                    <FriendlyButton
                      label="Buy one"
                      disabled={loading || buying || buyingItemId !== null}
                      onPress={() => {
                        setError(null);
                        setNotice(null);
                        setPendingItemId(item.id);
                      }}
                    />
                  )}
                </View>
              </GardenFrame>
            );
          })
        )}
      </ScrollView>

      <PlotPicker
        visible={pickerOpen}
        tiles={tiles}
        slots={slots}
        plants={plants}
        buying={buying}
        error={error}
        oxygen={price.oxygen}
        pollen={price.pollen}
        windowWidth={windowWidth}
        windowHeight={windowHeight}
        onClose={() => {
          if (!buying) {
            setPickerOpen(false);
          }
        }}
        onBuy={(col, row) => {
          void purchase(col, row);
        }}
      />
    </ThemedView>
  );
}

function PlotPicker({
  visible,
  tiles,
  slots,
  plants,
  buying,
  error,
  oxygen,
  pollen,
  windowWidth,
  windowHeight,
  onClose,
  onBuy,
}: {
  visible: boolean;
  tiles: GardenTile[];
  slots: GardenSlot[];
  plants: InventoryPlant[];
  buying: boolean;
  error: string | null;
  oxygen: number;
  pollen: number;
  windowWidth: number;
  windowHeight: number;
  onClose: () => void;
  onBuy: (col: number, row: number) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const plantsById = useMemo(() => new Map(plants.map((plant) => [plant.id, plant])), [plants]);
  const slotMap = useMemo(() => new Map(slots.map((slot) => [tileKey(slot.col, slot.row), slot])), [slots]);
  const bounds = useMemo(() => gardenViewBounds(tiles, 1), [tiles]);
  const viewColumns = bounds.maxCol - bounds.minCol + 1;
  const viewRows = bounds.maxRow - bounds.minRow + 1;
  const boardSize = useMemo(() => {
    const horizontalPad = Spacing.four * 2 + 16;
    const verticalReserve = 220;
    return gardenBoardSize(
      Math.max(0, windowWidth - horizontalPad - GARDEN_SHAPE_BORDER * 2),
      Math.max(160, windowHeight - verticalReserve - GARDEN_SHAPE_BORDER * 2),
      viewColumns,
      viewRows,
    );
  }, [viewColumns, viewRows, windowHeight, windowWidth]);

  useEffect(() => {
    if (!visible) {
      setSelected(null);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.picker}>
          <View style={styles.pickerHeader}>
            <ThemedText type="heading" style={{ color: GardenPalette.panelText }}>
              Pick one plot
            </ThemedText>
            <ThemedText type="small" style={{ color: GardenPalette.panelTextSecondary }}>
              {selected
                ? `Buy this plot for ${oxygen.toLocaleString()} mL oxygen and ${pollen.toLocaleString()} mg pollen.`
                : 'Tap a + on the edge, then confirm the purchase.'}
            </ThemedText>
          </View>

          {error ? (
            <ThemedText type="small" style={{ color: GardenPalette.panelDanger }}>
              {error}
            </ThemedText>
          ) : null}

          <View style={styles.boardCenter}>
            <View style={styles.frameOuter}>
              <View style={[styles.frameInner, { padding: GARDEN_SHAPE_BORDER }]}>
                <View style={[styles.board, { width: boardSize.width, height: boardSize.height }]}>
                  <GardenBed
                    tiles={tiles}
                    minCol={bounds.minCol}
                    minRow={bounds.minRow}
                    columns={viewColumns}
                    rows={viewRows}
                    cellSize={boardSize.cell}
                  />
                  {Array.from({ length: viewRows }, (_, rowOffset) => {
                    const row = bounds.minRow + rowOffset;
                    return (
                      <View key={row} style={styles.row}>
                        {Array.from({ length: viewColumns }, (_, columnOffset) => {
                          const col = bounds.minCol + columnOffset;
                          const key = tileKey(col, row);
                          const owned = tiles.some((tile) => tile.col === col && tile.row === row);
                          const forSale = !owned && isOutskirtsTile(tiles, col, row);
                          const occupant = slotMap.get(key);
                          const plant = occupant ? plantsById.get(occupant.plant_id) : undefined;

                          if (!owned && !forSale) {
                            return (
                              <View key={key} style={{ width: boardSize.cell, height: boardSize.cell }} />
                            );
                          }

                          const chosen = selected === key;

                          return (
                            <View key={key} style={{ width: boardSize.cell, height: boardSize.cell }}>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={
                                  plant ? plantDisplayName(plant.info) : forSale ? 'Choose this plot' : 'Owned plot'
                                }
                                disabled={!forSale || buying}
                                onPress={() => setSelected(key)}
                                style={({ pressed }) => [
                                  styles.slot,
                                  forSale ? styles.buySlot : null,
                                  {
                                    backgroundColor: chosen
                                      ? GardenPalette.highlight
                                      : forSale
                                        ? 'transparent'
                                        : GardenPalette.plot,
                                    borderColor: GardenPalette.highlight,
                                  },
                                  forSale && styles.buyBorder,
                                  pressed && forSale && styles.pressed,
                                ]}>
                                {plant ? (
                                  <PlantToken plant={plant} />
                                ) : forSale ? (
                                  <ThemedText
                                    type="smallBold"
                                    style={{ color: chosen ? GardenPalette.panelText : GardenPalette.highlight }}>
                                    {buying && chosen ? '…' : '+'}
                                  </ThemedText>
                                ) : (
                                  <Image
                                    source={require('@/assets/images/soil_tile.png')}
                                    style={styles.slotSoil}
                                    contentFit="cover"
                                    pointerEvents="none"
                                  />
                                )}
                              </Pressable>
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>
          </View>

          {selected ? (
            <FriendlyButton
              label={buying ? 'Buying…' : 'Buy this plot'}
              disabled={buying}
              onPress={() => {
                const [col, row] = selected.split(':').map(Number);
                onBuy(col, row);
              }}
            />
          ) : null}
          <FriendlyButton
            label="Close"
            variant="ghost"
            disabled={buying}
            onPress={() => {
              setSelected(null);
              onClose();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  hello: {
    gap: Spacing.half,
  },
  offer: {
    gap: Spacing.two,
  },
  itemOffer: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
  },
  itemImage: {
    width: 72,
    height: 72,
    borderRadius: Radius.sm,
    backgroundColor: GardenPalette.plot,
  },
  itemImageWide: {
    width: 112,
    backgroundColor: 'transparent',
  },
  itemCopy: {
    flex: 1,
    gap: Spacing.two,
  },
  itemActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 18, 8, 0.72)',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  picker: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.md,
    backgroundColor: GardenPalette.panel,
    borderWidth: 1,
    borderColor: GardenPalette.panelBorder,
  },
  pickerHeader: {
    gap: Spacing.one,
  },
  boardCenter: {
    alignItems: 'center',
  },
  frameOuter: {
    padding: 0,
  },
  frameInner: {},
  board: {
    gap: GARDEN_SLOT_GAP,
  },
  row: {
    flexDirection: 'row',
    gap: GARDEN_SLOT_GAP,
  },
  slot: {
    width: '100%',
    height: '100%',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buySlot: {
    borderStyle: 'dashed',
  },
  buyBorder: {
    borderWidth: 2,
  },
  slotSoil: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  pressed: {
    opacity: 0.7,
  },
});
