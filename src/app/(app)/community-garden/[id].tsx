import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { FriendlyButton } from '@/components/app/friendly-button';
import { GardenFrame } from '@/components/app/garden-frame';
import { GardenGrass } from '@/components/app/grass-background';
import { GARDEN_SHAPE_BORDER, GardenBed } from '@/components/grid/garden-shape-border';
import { KitStack, OwnedTileFace } from '@/components/grid/kit-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GardenPalette, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { contains, measureView, useGardenCamera, type Frame } from '@/hooks/use-garden-camera';
import { useDragGesture } from '@/hooks/use-drag-gesture';
import { useTheme } from '@/hooks/use-theme';
import {
  buyCommunityPlots,
  donateItemToCommunity,
  getCommunityGarden,
  moveItemInCommunity,
  placePlantInCommunityGarden,
  removeItemFromCommunity,
  type CommunityGarden,
  type CommunityGardenItem,
  type CommunityKitItem,
  type CommunityKitPlant,
} from '@/utils/community-garden';
import {
  connectedPlotKeys,
  GARDEN_SLOT_GAP,
  gardenBoardSize,
  gardenTilesPrice,
  tileKey,
} from '@/utils/garden';
import { formatOxygenMl, getCurrencyBalances } from '@/utils/plants';
import { isStandingItem, itemCells, itemSpan, shopItemImageUrl } from '@/utils/shop-items';

type DragState = { kind: 'plant' | 'item'; id: string; x: number; y: number };

const KIT_HEIGHT_MIN = 210;
const KIT_HEIGHT_MAX = 280;

function errorText(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return error instanceof Error ? error.message : fallback;
}

export default function CommunityGardenScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string }>();
  const communityId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [garden, setGarden] = useState<CommunityGarden | null>(null);
  const [balances, setBalances] = useState({ oxygen: 0, pollen: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [selectedPlots, setSelectedPlots] = useState<string[]>([]);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const userId = user?.id ?? null;
  const kitHeight = Math.round(Math.min(KIT_HEIGHT_MAX, Math.max(KIT_HEIGHT_MIN, windowHeight * 0.34)));

  const gardenRef = useRef(garden);
  gardenRef.current = garden;
  const dragRef = useRef<DragState | null>(null);
  const stopTracking = useRef<(() => void) | null>(null);
  const screenRef = useRef<View>(null);
  const screenOrigin = useRef({ x: 0, y: 0 });
  const kitRef = useRef<View>(null);
  const kitFrame = useRef<Frame | null>(null);

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
      console.error('[community-garden] load failed', loadError);
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

  const itemAtCell = useMemo(() => {
    const map = new Map<string, CommunityGardenItem>();
    for (const item of garden?.items ?? []) {
      for (const cell of itemCells(item.col, item.row, footprint(item))) {
        map.set(tileKey(cell.col, cell.row), item);
      }
    }
    return map;
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
  const columns = bounds.maxCol - bounds.minCol + 1;
  const rows = bounds.maxRow - bounds.minRow + 1;

  const board = useMemo(() => {
    const chrome = GARDEN_SHAPE_BORDER * 2;
    return gardenBoardSize(
      Math.max(0, (viewport.width || windowWidth) - chrome),
      Math.max(0, (viewport.height || windowHeight) - chrome),
      columns,
      rows,
    );
  }, [columns, rows, viewport.height, viewport.width, windowHeight, windowWidth]);
  const stride = board.cell + GARDEN_SLOT_GAP;

  const camera = useGardenCamera({
    board,
    border: GARDEN_SHAPE_BORDER,
    bounds,
    tiles: garden?.tiles ?? [],
    hitsMovable: (x, y) => {
      const key = camera.cellAt(x, y);
      return key != null && itemAtCell.get(key)?.ownerId === userId;
    },
    isDragging: () => dragRef.current != null,
    onViewportLayout: setViewport,
  });
  const grassW = board.width + GARDEN_SHAPE_BORDER * 2 + camera.grassPad * 2;
  const grassH = board.height + GARDEN_SHAPE_BORDER * 2 + camera.grassPad * 2;

  const itemStacks = useMemo(() => {
    const stacks = new Map<string, CommunityKitItem[]>();
    for (const item of garden?.kitItems ?? []) {
      const key = `${item.slug}:${item.footprintCols}x${item.footprintRows}`;
      stacks.set(key, [...(stacks.get(key) ?? []), item]);
    }
    return [...stacks.entries()].map(([key, copies]) => ({ key, copies }));
  }, [garden?.kitItems]);

  const price = gardenTilesPrice(garden?.tiles.length ?? 0, selectedPlots.length);

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
      console.error('[community-garden] buy plots failed', buyError);
      setError(errorText(buyError, 'Could not buy those plots'));
    } finally {
      setBusy(false);
    }
  }

  async function placePlant(plantId: string, col: number, row: number) {
    if (!communityId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await placePlantInCommunityGarden(plantId, communityId, col, row);
      setSelectedPlantId(null);
      await load();
    } catch (placeError) {
      console.error('[community-garden] place plant failed', placeError);
      setError(errorText(placeError, 'Could not add that to the garden'));
    } finally {
      setBusy(false);
    }
  }

  async function donateItem(itemId: string, col: number, row: number) {
    if (!communityId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await donateItemToCommunity(itemId, communityId, col, row);
      setSelectedItemId(null);
      await load();
    } catch (placeError) {
      console.error('[community-garden] give item failed', placeError);
      setError(errorText(placeError, 'Could not add that to the garden'));
    } finally {
      setBusy(false);
    }
  }

  async function moveItem(itemId: string, col: number, row: number) {
    if (!communityId) {
      return;
    }
    setError(null);
    setGarden((current) =>
      current
        ? { ...current, items: current.items.map((item) => (item.id === itemId ? { ...item, col, row } : item)) }
        : current,
    );
    let failure: string | null = null;
    try {
      await moveItemInCommunity(itemId, communityId, col, row);
    } catch (moveError) {
      console.error('[community-garden] move item failed', { itemId, col, row }, moveError);
      failure = errorText(moveError, 'Could not move that');
    }
    await load();
    if (failure) {
      setError(failure);
    }
  }

  async function removeItem(itemId: string) {
    if (!communityId) {
      return;
    }
    setError(null);
    setGarden((current) =>
      current ? { ...current, items: current.items.filter((item) => item.id !== itemId) } : current,
    );
    let failure: string | null = null;
    try {
      await removeItemFromCommunity(itemId, communityId);
    } catch (removeError) {
      console.error('[community-garden] remove item failed', { itemId }, removeError);
      failure = errorText(removeError, 'Could not take that back');
    }
    await load();
    if (failure) {
      setError(failure);
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

  function pressCell(col: number, row: number) {
    const key = tileKey(col, row);
    const laid = itemAtCell.get(key);
    if (removing) {
      if (laid && laid.ownerId === userId) {
        void removeItem(laid.id);
      }
      return;
    }
    if (busy || plantAt.has(key) || laid) {
      return;
    }
    if (selectedPlantId) {
      void placePlant(selectedPlantId, col, row);
    } else if (selectedItemId) {
      void donateItem(selectedItemId, col, row);
    }
  }

  function finishDrag(x: number, y: number, current: DragState) {
    const key = camera.cellAt(x, y);
    const placed = gardenRef.current?.items.find((item) => item.id === current.id);
    console.log('[community-garden] drop', {
      kind: current.kind,
      id: current.id,
      cell: key,
      placed: Boolean(placed),
      onKit: Boolean(kitFrame.current && contains(kitFrame.current, x, y)),
    });
    if (key != null) {
      const [col, row] = key.split(':').map(Number);
      if (current.kind === 'plant') {
        void placePlant(current.id, col, row);
      } else if (placed) {
        if (placed.col !== col || placed.row !== row) {
          void moveItem(current.id, col, row);
        }
      } else {
        void donateItem(current.id, col, row);
      }
      return;
    }
    if (current.kind === 'item' && placed && kitFrame.current && contains(kitFrame.current, x, y)) {
      void removeItem(current.id);
    }
  }

  const finishDragRef = useRef(finishDrag);
  finishDragRef.current = finishDrag;
  const moveDragRef = useRef<(x: number, y: number) => void>(() => {});
  const endDragRef = useRef<(x: number, y: number) => void>(() => {});
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const startDrag = useCallback((kind: DragState['kind'], id: string, x: number, y: number) => {
    cameraRef.current.remeasure();
    if (kitRef.current) {
      measureView(kitRef.current, (frame) => {
        kitFrame.current = frame;
      });
    }
    if (screenRef.current) {
      measureView(screenRef.current, (frame) => {
        screenOrigin.current = { x: frame.x, y: frame.y };
      });
    }
    const next = { kind, id, x, y };
    dragRef.current = next;
    setDrag(next);
    setError(null);
    if (Platform.OS !== 'web') {
      return;
    }
    stopTracking.current?.();
    const move = (event: PointerEvent) => moveDragRef.current(event.clientX, event.clientY);
    const up = (event: PointerEvent) => {
      stopTracking.current?.();
      stopTracking.current = null;
      endDragRef.current(event.clientX, event.clientY);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    stopTracking.current = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);

  const moveDrag = useCallback((x: number, y: number) => {
    setDrag((current) => {
      if (!current) {
        return current;
      }
      const next = { ...current, x, y };
      dragRef.current = next;
      return next;
    });
    setHoverKey(cameraRef.current.cellAt(x, y));
  }, []);

  const endDrag = useCallback((x: number, y: number) => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    setHoverKey(null);
    if (current) {
      finishDragRef.current(x, y, current);
    }
  }, []);
  moveDragRef.current = moveDrag;
  endDragRef.current = endDrag;

  const draggingPlant =
    drag?.kind === 'plant' ? garden?.kitPlants.find((plant) => plant.id === drag.id) : undefined;
  const draggingItem =
    drag?.kind === 'item'
      ? (garden?.kitItems.find((item) => item.id === drag.id) ?? garden?.items.find((item) => item.id === drag.id))
      : undefined;

  const holding = Boolean(selectedPlantId || selectedItemId);
  const hint = buying
    ? `You have ${Math.round(balances.oxygen).toLocaleString()} oxygen and ${Math.round(balances.pollen).toLocaleString()} pollen.`
    : removing
      ? 'Tap one of your items to take it back. Items other members gave stay put.'
      : holding
        ? 'Tap an empty plot to give it. A plant can only live in one garden.'
        : 'Drag a plant or item onto a plot. Drag your own items to move them, or onto the kit to take them back.';

  return (
    <ThemedView style={styles.screen}>
      <View
        ref={screenRef}
        style={styles.screen}
        onLayout={() => {
          if (screenRef.current) {
            measureView(screenRef.current, (frame) => {
              screenOrigin.current = { x: frame.x, y: frame.y };
            });
          }
        }}>
        <View style={styles.header}>
          <FriendlyButton label="<" variant="ghost" onPress={() => router.back()} />
          <View style={styles.headerTitle}>
            <ThemedText type="heading" numberOfLines={1}>
              {garden?.name ?? 'Community garden'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {loading && !garden
                ? 'Loading the garden…'
                : `${formatOxygenMl(garden?.totalOxygen ?? 0)} produced in total`}
            </ThemedText>
          </View>
          <FriendlyButton
            label={showMembers ? 'Hide members' : 'Members'}
            variant="ghost"
            onPress={() => setShowMembers((current) => !current)}
          />
        </View>

        {showMembers ? (
          <GardenFrame contentStyle={styles.members}>
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
        ) : null}

        <View style={styles.actions}>
          <FriendlyButton
            label={buying ? 'Stop buying' : 'Buy plots'}
            variant={buying ? 'ghost' : 'primary'}
            disabled={busy || !garden}
            onPress={() => {
              setBuying((current) => !current);
              setRemoving(false);
              setSelectedPlots([]);
              setSelectedPlantId(null);
              setSelectedItemId(null);
            }}
          />
          <FriendlyButton
            label={removing ? 'Done removing' : 'Remove items'}
            variant={removing ? 'primary' : 'ghost'}
            disabled={busy || !garden}
            onPress={() => {
              setRemoving((current) => !current);
              setBuying(false);
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
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {hint}
        </ThemedText>
        {error ? (
          <ThemedText type="small" style={[styles.hint, { color: theme.danger }]}>
            {error}
          </ThemedText>
        ) : null}

        <View ref={camera.viewportRef} style={styles.viewport} {...camera.viewportProps}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.grassPlane,
              { left: -camera.grassPad, top: -camera.grassPad, width: grassW, height: grassH },
              camera.grassStyle,
            ]}>
            <GardenGrass width={grassW} height={grassH} />
          </Animated.View>
          <View pointerEvents="box-none" style={styles.cameraHost}>
            <Animated.View style={[styles.camera, camera.cameraStyle]}>
              <View style={{ padding: GARDEN_SHAPE_BORDER }}>
                <View style={{ width: board.width, height: board.height, position: 'relative' }}>
                  <GardenBed
                    tiles={garden?.tiles ?? []}
                    minCol={bounds.minCol}
                    minRow={bounds.minRow}
                    columns={columns}
                    rows={rows}
                  />
                  {cells.map((cell) => {
                    const key = tileKey(cell.col, cell.row);
                    const laid = itemAtCell.get(key) ?? null;
                    return (
                      <BoardCell
                        key={cell.owned ? cell.id : key}
                        left={(cell.col - bounds.minCol) * stride}
                        top={(cell.row - bounds.minRow) * stride}
                        size={board.cell}
                        owned={cell.owned}
                        selected={selectedPlots.includes(key)}
                        hovered={hoverKey === key && cell.owned}
                        disabled={busy || (cell.owned ? buying || (removing ? !(laid && laid.ownerId === userId) : false) : !buying)}
                        plant={plantAt.get(key) ?? null}
                        item={laid}
                        canDrag={cell.owned && !buying && !removing && laid?.ownerId === userId}
                        onPress={() => {
                          if (!cell.owned) {
                            togglePlot(cell.col, cell.row);
                            return;
                          }
                          pressCell(cell.col, cell.row);
                        }}
                        onDragStart={startDrag}
                        onDragMove={moveDrag}
                        onDragEnd={endDrag}
                      />
                    );
                  })}
                  {(garden?.items ?? []).map((item) => (
                    <ItemOverlay
                      key={item.id}
                      item={item}
                      cell={board.cell}
                      left={(item.col - bounds.minCol) * stride}
                      top={(item.row - bounds.minRow) * stride}
                      hidden={drag?.id === item.id}
                    />
                  ))}
                </View>
              </View>
            </Animated.View>
          </View>
        </View>

        <View ref={kitRef} style={[styles.kit, { height: kitHeight }]}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.kitList}
            nestedScrollEnabled>
            <View style={styles.kitSection}>
              <KitHeader title="Plants" count={garden?.kitPlants.length ?? 0} />
              {(garden?.kitPlants ?? []).length === 0 ? (
                <EmptyNote text="Every plant you own is already in a garden." />
              ) : (
                <View style={styles.tileGrid}>
                  {(garden?.kitPlants ?? []).map((plant) => (
                    <KitPlantTile
                      key={plant.id}
                      plant={plant}
                      selected={plant.id === selectedPlantId}
                      dragging={drag?.kind === 'plant' && drag.id === plant.id}
                      onPress={() => {
                        setBuying(false);
                        setRemoving(false);
                        setSelectedPlots([]);
                        setSelectedItemId(null);
                        setSelectedPlantId((current) => (current === plant.id ? null : plant.id));
                      }}
                      onDragStart={(x, y) => startDrag('plant', plant.id, x, y)}
                      onDragMove={moveDrag}
                      onDragEnd={endDrag}
                    />
                  ))}
                </View>
              )}
            </View>
            <View style={styles.kitSection}>
              <KitHeader title="Tiles" count={garden?.kitItems.length ?? 0} />
              {itemStacks.length === 0 ? (
                <EmptyNote text="Buy something from the shop, then give an unplaced copy here." />
              ) : (
                <View style={styles.tileGrid}>
                  {itemStacks.map(({ key, copies }) => {
                    const sample = copies[0];
                    const selected = copies.some((copy) => copy.id === selectedItemId);
                    return (
                      <KitItemTile
                        key={key}
                        item={sample}
                        count={copies.length}
                        selected={selected}
                        dragging={drag?.kind === 'item' && copies.some((copy) => copy.id === drag.id)}
                        onPress={() => {
                          setBuying(false);
                          setRemoving(false);
                          setSelectedPlots([]);
                          setSelectedPlantId(null);
                          setSelectedItemId(selected ? null : sample.id);
                        }}
                        onDragStart={(x, y) => startDrag('item', sample.id, x, y)}
                        onDragMove={moveDrag}
                        onDragEnd={endDrag}
                      />
                    );
                  })}
                </View>
              )}
            </View>
          </ScrollView>
        </View>

        {drag && (draggingPlant || draggingItem) ? (
          <View
            pointerEvents="none"
            style={[
              styles.dragGhost,
              { left: drag.x - screenOrigin.current.x - 36, top: drag.y - screenOrigin.current.y - 36 },
            ]}>
            {draggingPlant ? (
              <PlantTile name={draggingPlant.name} uri={draggingPlant.photoUrl ?? draggingPlant.imageUrl} />
            ) : draggingItem ? (
              <OwnedTileFace
                name={draggingItem.name}
                imageUrl={shopItemImageUrl(draggingItem.imagePath)}
                rotation={draggingItem.rotation}
                fit={
                  isStandingItem(draggingItem.slug) || draggingItem.footprintCols * draggingItem.footprintRows > 1
                    ? 'contain'
                    : 'cover'
                }
                lamp={draggingItem.slug === 'light'}
                decor={isStandingItem(draggingItem.slug)}
              />
            ) : null}
          </View>
        ) : null}
      </View>
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

function BoardCell({
  left,
  top,
  size,
  owned,
  selected,
  hovered,
  disabled,
  plant,
  item,
  canDrag,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  left: number;
  top: number;
  size: number;
  owned: boolean;
  selected: boolean;
  hovered: boolean;
  disabled: boolean;
  plant: CommunityGarden['plants'][number] | null;
  item: CommunityGardenItem | null;
  canDrag: boolean;
  onPress: () => void;
  onDragStart: (kind: DragState['kind'], id: string, x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
}) {
  const itemId = item?.id ?? null;
  const gesture = useDragGesture({
    enabled: canDrag && itemId != null,
    onBoard: true,
    onStart: useCallback((x, y) => itemId && onDragStart('item', itemId, x, y), [itemId, onDragStart]),
    onMove: onDragMove,
    onEnd: onDragEnd,
  });

  const span = item ? itemSpan(footprint(item)) : null;
  const single = span != null && span.cols === 1 && span.rows === 1;
  const standing = Boolean(item && isStandingItem(item.slug));
  const stone = Boolean(item && (standing || (span && (span.cols > 1 || span.rows > 1))));
  const lamp = item?.slug === 'light';
  const uri = item && single ? shopItemImageUrl(item.imagePath) : null;

  const body = (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.cell,
        owned
          ? { backgroundColor: GardenPalette.plot, borderWidth: selected ? 2 : 0, borderColor: GardenPalette.highlight }
          : {
              backgroundColor: selected ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)',
              borderWidth: 2,
              borderStyle: 'dashed',
              borderColor: selected ? GardenPalette.highlight : 'rgba(255,255,255,0.85)',
            },
      ]}>
      {owned ? (
        stone ? (
          <Image
            source={require('@/assets/images/decoritems/bench-ground.png')}
            style={styles.groundFill}
            contentFit="cover"
            pointerEvents="none"
          />
        ) : uri ? null : (
          <Image
            source={require('@/assets/images/decoritems/soil_tile.png')}
            style={styles.groundFill}
            contentFit="cover"
            pointerEvents="none"
          />
        )
      ) : null}
      {plant ? <PlantFace name={plant.name} uri={plant.photoUrl ?? plant.imageUrl} owner={plant.ownerName} /> : null}
      {uri && !lamp ? (
        <Image
          source={uri}
          style={standing ? styles.decor : styles.groundFill}
          contentFit={standing ? 'contain' : 'cover'}
          pointerEvents="none"
        />
      ) : null}
      {item && single ? (
        <ThemedText type="small" numberOfLines={1} style={styles.owner}>
          {item.ownerName}
        </ThemedText>
      ) : null}
      {hovered ? <View pointerEvents="none" style={[styles.groundFill, styles.hover]} /> : null}
    </Pressable>
  );

  return (
    <View style={[styles.cellWrap, { left, top, width: size, height: size }]}>
      {gesture ? (
        <View style={styles.fill}>
          <GestureDetector gesture={gesture}>{body}</GestureDetector>
        </View>
      ) : (
        body
      )}
    </View>
  );
}

/** Things that stand outside their plot: multi-plot pieces and street lamps. */
function ItemOverlay({
  item,
  cell,
  left,
  top,
  hidden,
}: {
  item: CommunityGardenItem;
  cell: number;
  left: number;
  top: number;
  hidden: boolean;
}) {
  if (hidden) {
    return null;
  }
  const span = itemSpan(footprint(item));
  const uri = shopItemImageUrl(item.imagePath);
  if (span.cols === 1 && span.rows === 1) {
    if (item.slug !== 'light' || !uri) {
      return null;
    }
    return (
      <View pointerEvents="none" style={[styles.streetLamp, { left, top, width: cell, height: cell }]}>
        <View style={styles.streetLampBox}>
          <Image source={uri} style={styles.streetLampImage} contentFit="contain" />
        </View>
      </View>
    );
  }
  const width = span.cols * cell + (span.cols - 1) * GARDEN_SLOT_GAP;
  const height = span.rows * cell + (span.rows - 1) * GARDEN_SLOT_GAP;
  const turned = item.rotation === 90 || item.rotation === 270;
  return (
    <View pointerEvents="none" style={[styles.piece, { left, top, width, height }]}>
      {uri ? (
        <Image
          source={uri}
          contentFit="contain"
          style={{
            position: 'absolute',
            width: turned ? height : width,
            height: turned ? width : height,
            left: turned ? (width - height) / 2 : 0,
            top: turned ? (height - width) / 2 : 0,
            transform: [{ rotate: `${item.rotation}deg` }],
          }}
        />
      ) : null}
      <ThemedText type="small" numberOfLines={1} style={styles.owner}>
        {item.ownerName}
      </ThemedText>
    </View>
  );
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

function PlantTile({ name, uri }: { name: string; uri: string | null }) {
  return (
    <View style={styles.plantTile} pointerEvents="none">
      {uri ? <Image source={{ uri }} style={styles.groundFill} contentFit="cover" /> : null}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.plantTileLabel}>
        {name}
      </ThemedText>
    </View>
  );
}

function KitPlantTile({
  plant,
  selected,
  dragging,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  plant: CommunityKitPlant;
  selected: boolean;
  dragging: boolean;
  onPress: () => void;
  onDragStart: (x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
}) {
  const gesture = useDragGesture({ onStart: onDragStart, onMove: onDragMove, onEnd: onDragEnd });
  const body = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.kitTile, selected && styles.kitTileSelected, dragging && styles.dragging]}>
      <PlantTile name={plant.name} uri={plant.photoUrl ?? plant.imageUrl} />
    </Pressable>
  );
  return <View style={styles.kitPlantWrap}>{gesture ? <GestureDetector gesture={gesture}>{body}</GestureDetector> : body}</View>;
}

function KitItemTile({
  item,
  count,
  selected,
  dragging,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  item: CommunityKitItem;
  count: number;
  selected: boolean;
  dragging: boolean;
  onPress: () => void;
  onDragStart: (x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
}) {
  const gesture = useDragGesture({ onStart: onDragStart, onMove: onDragMove, onEnd: onDragEnd });
  const wide = item.footprintCols * item.footprintRows > 1;
  const body = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.kitTile, selected && styles.kitTileSelected, dragging && styles.dragging]}>
      <OwnedTileFace
        name={item.name}
        imageUrl={shopItemImageUrl(item.imagePath)}
        rotation={item.rotation}
        fit={wide || isStandingItem(item.slug) ? 'contain' : 'cover'}
        lamp={item.slug === 'light'}
        decor={isStandingItem(item.slug)}
      />
    </Pressable>
  );
  return <KitStack count={count}>{gesture ? <GestureDetector gesture={gesture}>{body}</GestureDetector> : body}</KitStack>;
}

function KitHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.kitHeader}>
      <ThemedText type="smallBold" style={styles.kitTitle}>
        {title}
      </ThemedText>
      <View style={styles.countPill}>
        <ThemedText type="smallBold" style={styles.countPillText}>
          {count}
        </ThemedText>
      </View>
    </View>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <View style={styles.emptyNote}>
      <ThemedText type="small" style={styles.kitHint}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerTitle: { flex: 1 },
  members: { gap: Spacing.two },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  statName: { flex: 1 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  hint: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  viewport: {
    position: 'relative',
    flex: 1,
    alignSelf: 'stretch',
    overflow: 'hidden',
    backgroundColor: GardenPalette.grass,
  },
  grassPlane: {
    position: 'absolute',
    zIndex: 0,
    overflow: 'visible',
    backgroundColor: GardenPalette.grass,
  },
  cameraHost: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
  },
  camera: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 1,
    overflow: 'visible',
    transformOrigin: 'left top',
  },
  cellWrap: { position: 'absolute' },
  cell: {
    flex: 1,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  fill: { flex: 1, width: '100%', height: '100%' },
  groundFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  hover: { backgroundColor: GardenPalette.plotHover, opacity: 0.55 },
  decor: { position: 'absolute', width: '72%', height: '72%', left: '14%', top: '14%', zIndex: 1 },
  piece: { position: 'absolute', zIndex: 2 },
  /** Street lamp: base near the plot's bottom edge, standing about two plots tall. */
  streetLamp: { position: 'absolute', zIndex: 3 },
  streetLampBox: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '8%',
    height: '200%',
    alignItems: 'center',
  },
  streetLampImage: { height: '100%', aspectRatio: 49 / 332 },
  owner: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 2,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 3,
  },
  kit: {
    borderTopWidth: 1,
    borderColor: GardenPalette.panelBorder,
    backgroundColor: GardenPalette.panel,
  },
  kitList: { padding: Spacing.three, gap: Spacing.four },
  kitSection: { gap: Spacing.two },
  kitHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kitTitle: { color: GardenPalette.panelText },
  kitHint: { color: GardenPalette.panelTextSecondary },
  countPill: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: GardenPalette.bar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillText: { color: GardenPalette.barText },
  emptyNote: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: GardenPalette.panelBorder,
    borderRadius: Radius.sm,
    padding: Spacing.two,
  },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  kitPlantWrap: { paddingTop: 8 },
  kitTile: { borderWidth: 2, borderColor: 'transparent', borderRadius: Radius.sm, touchAction: 'none' },
  kitTileSelected: { borderColor: GardenPalette.highlight },
  dragging: { opacity: 0.35 },
  plantTile: {
    width: 72,
    height: 72,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: GardenPalette.plot,
    justifyContent: 'flex-end',
  },
  plantTileLabel: {
    color: '#FFFFFF',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
  },
  dragGhost: { position: 'absolute', zIndex: 20 },
});
