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
  buyGardenTiles,
  connectedPlotKeys,
  GARDEN_SLOT_GAP,
  gardenBoardSize,
  gardenTilePrice,
  gardenTilesPrice,
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
  const [quantity, setQuantity] = useState(1);
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

  async function purchase(cells: { col: number; row: number }[]) {
    if (buying || cells.length === 0) {
      return;
    }

    setBuying(true);
    setError(null);
    try {
      await buyGardenTiles(cells);
      setTiles(await listGardenTiles());
      setPickerOpen(false);
    } catch (buyError) {
      setError(errorText(buyError, 'Could not buy those plots'));
    } finally {
      setBuying(false);
    }
  }

  async function purchaseItem(item: ShopItem, copies: number) {
    if (buying || buyingItemId || copies < 1) {
      return;
    }

    setBuyingItemId(item.id);
    setError(null);
    setNotice(null);
    try {
      await buyShopItem(item.id, copies);
      setPendingItemId(null);
      setQuantity(1);
      setNotice(
        copies === 1
          ? `${item.name} added. Drag it onto a plot from the grid.`
          : `${copies} ${item.name} added. Drag them onto a plot from the grid.`,
      );
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
          <View style={styles.plotLead}>
            <View style={styles.plotMark}>
              <View style={[styles.plotSquare, { backgroundColor: theme.backgroundElement }]} />
              <View style={[styles.plotSquare, styles.plotSquareAdd, { borderColor: theme.primary }]}>
                <ThemedText type="smallBold" style={{ color: theme.primary }}>
                  +
                </ThemedText>
              </View>
            </View>
            <View style={styles.plotCopy}>
              <ThemedText type="smallBold">Garden plots</ThemedText>
              <ThemedText themeColor="textSecondary">
                Add land along the edge. Pick several at once, and each one costs more than the last.
              </ThemedText>
            </View>
          </View>
          <View style={styles.priceRow}>
            <View style={[styles.pricePill, { backgroundColor: theme.backgroundElement }]}>
              <View style={[styles.priceDot, { backgroundColor: theme.oxygen }]} />
              <ThemedText type="smallBold">{price.oxygen.toLocaleString()} mL</ThemedText>
            </View>
            <View style={[styles.pricePill, { backgroundColor: theme.backgroundElement }]}>
              <View style={[styles.priceDot, { backgroundColor: theme.pollen }]} />
              <ThemedText type="smallBold">{price.pollen.toLocaleString()} mg</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              next plot
            </ThemedText>
          </View>
          <FriendlyButton
            label={loading ? 'Loading…' : 'Choose plots'}
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
            const wide = item.footprint_cols * item.footprint_rows > 1;
            const lamp = item.slug === 'light';
            return (
              <GardenFrame key={item.id} contentStyle={styles.itemOffer}>
                {imageUrl ? (
                  <Image
                    source={{ uri: imageUrl }}
                    style={[
                      styles.itemImage,
                      wide ? styles.itemImageWide : null,
                      lamp ? styles.itemImageLamp : null,
                    ]}
                    contentFit={wide || lamp ? 'contain' : 'cover'}
                  />
                ) : null}
                <View style={styles.itemCopy}>
                  <ThemedText type="smallBold">{item.name}</ThemedText>
                  <ThemedText themeColor="textSecondary">{item.description}</ThemedText>
                  <ThemedText type="smallBold">
                    {pendingItemId === item.id
                      ? `${(item.oxygen_cost * quantity).toLocaleString()} mL oxygen`
                      : `${item.oxygen_cost.toLocaleString()} mL oxygen each`}
                  </ThemedText>
                  {pendingItemId === item.id ? (
                    <View style={styles.itemBuy}>
                      <View style={[styles.stepper, { borderColor: theme.border }]}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Buy one fewer"
                          disabled={buyingItemId !== null || quantity <= 1}
                          onPress={() => setQuantity((count) => Math.max(1, count - 1))}
                          style={styles.step}>
                          <ThemedText type="smallBold">−</ThemedText>
                        </Pressable>
                        <ThemedText type="smallBold" style={styles.stepCount}>
                          {quantity}
                        </ThemedText>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Buy one more"
                          disabled={buyingItemId !== null || quantity >= 36}
                          onPress={() => setQuantity((count) => Math.min(36, count + 1))}
                          style={styles.step}>
                          <ThemedText type="smallBold">+</ThemedText>
                        </Pressable>
                      </View>
                      <View style={styles.itemActions}>
                        <FriendlyButton
                          label="Cancel"
                          variant="ghost"
                          disabled={buyingItemId !== null}
                          onPress={() => {
                            setPendingItemId(null);
                            setQuantity(1);
                          }}
                        />
                        <FriendlyButton
                          label={buyingItemId === item.id ? 'Buying…' : `Buy ${quantity}`}
                          disabled={loading || buying || buyingItemId !== null}
                          onPress={() => {
                            void purchaseItem(item, quantity);
                          }}
                        />
                      </View>
                    </View>
                  ) : (
                    <FriendlyButton
                      label="Buy"
                      disabled={loading || buying || buyingItemId !== null}
                      onPress={() => {
                        setError(null);
                        setNotice(null);
                        setQuantity(1);
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
        windowWidth={windowWidth}
        windowHeight={windowHeight}
        onClose={() => {
          if (!buying) {
            setPickerOpen(false);
          }
        }}
        onBuy={(cells) => {
          void purchase(cells);
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
  windowWidth: number;
  windowHeight: number;
  onClose: () => void;
  onBuy: (cells: { col: number; row: number }[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const plantsById = useMemo(() => new Map(plants.map((plant) => [plant.id, plant])), [plants]);
  const slotMap = useMemo(() => new Map(slots.map((slot) => [tileKey(slot.col, slot.row), slot])), [slots]);
  const selectedCells = useMemo(
    () =>
      selected.map((key) => {
        const [col, row] = key.split(':').map(Number);
        return { col, row };
      }),
    [selected],
  );
  const land = useMemo(() => [...tiles, ...selectedCells], [selectedCells, tiles]);
  const bounds = useMemo(() => gardenViewBounds(land, 1), [land]);
  const viewColumns = bounds.maxCol - bounds.minCol + 1;
  const viewRows = bounds.maxRow - bounds.minRow + 1;
  const quote = gardenTilesPrice(tiles.length, selected.length);
  const boardSize = useMemo(() => {
    const horizontalPad = Spacing.four * 2 + 16;
    const verticalReserve = 280;
    return gardenBoardSize(
      Math.max(0, windowWidth - horizontalPad - GARDEN_SHAPE_BORDER * 2),
      Math.max(160, windowHeight - verticalReserve - GARDEN_SHAPE_BORDER * 2),
      viewColumns,
      viewRows,
    );
  }, [viewColumns, viewRows, windowHeight, windowWidth]);

  useEffect(() => {
    if (!visible) {
      setSelected([]);
    }
  }, [visible]);

  function toggle(key: string) {
    setSelected((current) => {
      if (current.includes(key)) {
        return connectedPlotKeys(
          tiles,
          current.filter((item) => item !== key),
        );
      }
      return [...current, key];
    });
  }

  const buyLabel =
    selected.length === 0
      ? 'Select plots'
      : buying
        ? 'Buying…'
        : `Buy ${selected.length} ${selected.length === 1 ? 'plot' : 'plots'}`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.picker}>
          <View style={styles.pickerHeader}>
            <ThemedText type="heading" style={{ color: GardenPalette.panelText }}>
              Add plots
            </ThemedText>
            <ThemedText type="small" style={{ color: GardenPalette.panelTextSecondary }}>
              Tap open ground along the edge. A later plot in this purchase costs more than an earlier one.
            </ThemedText>
          </View>

          {error ? (
            <ThemedText type="small" style={{ color: GardenPalette.panelDanger }}>
              {error}
            </ThemedText>
          ) : null}

          <ScrollView style={{ maxHeight: windowHeight * 0.46 }} contentContainerStyle={styles.boardCenter}>
            <View style={styles.lawn}>
              <View style={{ padding: GARDEN_SHAPE_BORDER }}>
                <View style={[styles.board, { width: boardSize.width, height: boardSize.height }]}>
                  <GardenBed
                    tiles={land}
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
                          const order = selected.indexOf(key);
                          const chosen = order >= 0;
                          const forSale = !owned && !chosen && isOutskirtsTile(land, col, row);
                          const occupant = slotMap.get(key);
                          const plant = occupant ? plantsById.get(occupant.plant_id) : undefined;

                          if (!owned && !forSale && !chosen) {
                            return <View key={key} style={{ width: boardSize.cell, height: boardSize.cell }} />;
                          }

                          return (
                            <View key={key} style={{ width: boardSize.cell, height: boardSize.cell }}>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={
                                  plant
                                    ? plantDisplayName(plant.info)
                                    : chosen
                                      ? `Plot ${order + 1}, tap to remove`
                                      : forSale
                                        ? 'Add this plot'
                                        : 'Owned plot'
                                }
                                disabled={(!forSale && !chosen) || buying}
                                onPress={() => toggle(key)}
                                style={({ pressed }) => [
                                  styles.slot,
                                  chosen ? styles.chosenSlot : null,
                                  forSale ? styles.buySlot : null,
                                  {
                                    backgroundColor: chosen
                                      ? GardenPalette.highlight
                                      : forSale
                                        ? 'rgba(242, 201, 76, 0.16)'
                                        : GardenPalette.plot,
                                    borderColor: GardenPalette.highlight,
                                  },
                                  (forSale || chosen) && styles.buyBorder,
                                  pressed && (forSale || chosen) && styles.pressed,
                                ]}>
                                {plant ? (
                                  <PlantToken plant={plant} />
                                ) : chosen ? (
                                  <ThemedText type="smallBold" style={{ color: GardenPalette.panelText }}>
                                    {order + 1}
                                  </ThemedText>
                                ) : forSale ? (
                                  <ThemedText type="smallBold" style={{ color: GardenPalette.highlight }}>
                                    +
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
          </ScrollView>

          <View style={styles.receipt}>
            {quote.lines.length === 0 ? (
              <ThemedText type="small" style={{ color: GardenPalette.panelTextSecondary }}>
                Nothing selected yet.
              </ThemedText>
            ) : (
              <ScrollView style={styles.receiptLines}>
                {quote.lines.map((line, index) => (
                  <View key={index} style={styles.receiptLine}>
                    <ThemedText type="smallBold" style={{ color: GardenPalette.panelText }}>
                      {index + 1}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: GardenPalette.panelTextSecondary }}>
                      {line.oxygen.toLocaleString()} mL oxygen · {line.pollen.toLocaleString()} mg pollen
                    </ThemedText>
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={styles.receiptTotal}>
              <ThemedText type="smallBold" style={{ color: GardenPalette.panelText }}>
                {quote.lines.length === 0
                  ? 'Total'
                  : `${quote.oxygen.toLocaleString()} mL · ${quote.pollen.toLocaleString()} mg`}
              </ThemedText>
            </View>
          </View>

          <FriendlyButton
            label={buyLabel}
            disabled={buying || selected.length === 0}
            onPress={() => onBuy(selectedCells)}
          />
          <FriendlyButton label="Close" variant="ghost" disabled={buying} onPress={onClose} />
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
    gap: Spacing.three,
  },
  plotLead: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
  },
  plotMark: {
    width: 72,
    height: 72,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  plotSquare: {
    width: 33,
    height: 33,
    borderRadius: Radius.sm,
  },
  plotSquareAdd: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  plotCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  pricePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  priceDot: {
    width: 8,
    height: 8,
    borderRadius: Radius.pill,
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
  itemImageLamp: {
    backgroundColor: 'transparent',
  },
  itemCopy: {
    flex: 1,
    gap: Spacing.two,
  },
  itemBuy: {
    gap: Spacing.two,
  },
  stepper: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  step: {
    width: 40,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCount: {
    minWidth: 28,
    textAlign: 'center',
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
    paddingVertical: Spacing.one,
  },
  lawn: {
    backgroundColor: GardenPalette.grass,
    borderRadius: Radius.lg,
    padding: Spacing.two,
  },
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
  chosenSlot: {
    borderStyle: 'solid',
  },
  receipt: {
    gap: Spacing.one,
    padding: Spacing.two,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(78, 51, 28, 0.06)',
  },
  receiptLines: {
    maxHeight: 96,
  },
  receiptLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  receiptTotal: {
    marginTop: Spacing.one,
    paddingTop: Spacing.one,
    borderTopWidth: 1,
    borderTopColor: GardenPalette.panelBorder,
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
