import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { FriendlyButton } from '@/components/app/friendly-button';
import { GardenFrame } from '@/components/app/garden-frame';
import { GardenGrass } from '@/components/app/grass-background';
import { GardenLoadingVeil, useGardenLoadGate } from '@/components/grid/garden-loading-veil';
import { GARDEN_SHAPE_BORDER, GardenBed } from '@/components/grid/garden-shape-border';
import { KitStack, OwnedTileFace } from '@/components/grid/kit-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GardenPalette, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { contains, measureView, useGardenCamera, type Frame } from '@/hooks/use-garden-camera';
import { useDragGesture } from '@/hooks/use-drag-gesture';
import { useTweenedNumber } from '@/hooks/use-tweened-number';
import { useTheme } from '@/hooks/use-theme';
import {
  buyCommunityPlots,
  donateItemToCommunity,
  getCommunityGarden,
  moveItemInCommunity,
  placePlantInCommunityGarden,
  removeItemFromCommunity,
  removePlantFromCommunity,
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
  gardenViewBounds,
  tileKey,
} from '@/utils/garden';
import { formatOxygenMl, formatPollenMg, getCurrencyBalances } from '@/utils/plants';
import { glowKindFor, ItemGlow } from '@/components/grid/item-glow';
import { isStandingItem, itemCells, itemSpan, shopItemImageUrl } from '@/utils/shop-items';

type DragState = { kind: 'plant' | 'item'; id: string; x: number; y: number };

/** Plots are drawn at the size a small garden gets, then zoomed out to fit, so the border keeps the same proportion. */
const BOARD_CELL = 96;
const SIDE_CLOSED = 56;
const SIDE_OPEN = 252;
const KIT_BOTTOM_BREAKPOINT = 720;

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
  const [dataReady, setDataReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [selectedPlots, setSelectedPlots] = useState<string[]>([]);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [, setViewport] = useState({ width: 0, height: 0 });

  const userId = user?.id ?? null;
  const [sideOpen, setSideOpen] = useState(false);
  const kitFromBottom = windowWidth < KIT_BOTTOM_BREAKPOINT;
  const sheetOpen = Math.round(Math.min(280, Math.max(210, windowHeight * 0.34)));
  const kitExtent = useTweenedNumber(sideOpen ? SIDE_OPEN : SIDE_CLOSED);
  const kitHeight = useSharedValue(SIDE_CLOSED);
  const sheetLimit = useSharedValue(sheetOpen);
  const sheetDragOrigin = useSharedValue(SIDE_CLOSED);
  const kitSheetStyle = useAnimatedStyle(() => ({ height: kitHeight.value }));

  useEffect(() => {
    sheetLimit.value = sheetOpen;
    if (!kitFromBottom) {
      return;
    }
    kitHeight.value = withTiming(sideOpen ? sheetOpen : SIDE_CLOSED, { duration: 220 });
  }, [kitFromBottom, kitHeight, sheetLimit, sheetOpen, sideOpen]);

  const sheetDrag = useMemo(
    () =>
      Gesture.Pan()
        .enabled(kitFromBottom)
        .minDistance(10)
        .onStart(() => {
          sheetDragOrigin.value = kitHeight.value;
        })
        .onUpdate((event) => {
          const next = sheetDragOrigin.value - event.translationY;
          kitHeight.value = Math.min(sheetLimit.value, Math.max(SIDE_CLOSED, next));
        })
        .onEnd((event) => {
          const limit = sheetLimit.value;
          const open =
            event.velocityY > 600
              ? false
              : event.velocityY < -600
                ? true
                : kitHeight.value > (limit + SIDE_CLOSED) / 2;
          kitHeight.value = withTiming(open ? limit : SIDE_CLOSED, { duration: 180 });
          runOnJS(setSideOpen)(open);
        }),
    [kitFromBottom, kitHeight, sheetDragOrigin, sheetLimit],
  );

  const gardenRef = useRef(garden);
  gardenRef.current = garden;
  const dragRef = useRef<DragState | null>(null);
  const stopTracking = useRef<(() => void) | null>(null);
  const screenRef = useRef<View>(null);
  const screenOrigin = useRef({ x: 0, y: 0 });
  const kitRef = useRef<View>(null);
  const kitFrame = useRef<Frame | null>(null);

  const load = useCallback(async (opts?: { veil?: boolean }) => {
    if (!communityId) {
      return;
    }
    setError(null);
    if (opts?.veil !== false) {
      setDataReady(false);
    }
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
      setDataReady(true);
    }
  }, [communityId]);

  useFocusEffect(
    useCallback(() => {
      // First open still veils (dataReady starts false). Returning to the screen refreshes quietly.
      void load({ veil: false });
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

  const selectedCells = useMemo(
    () =>
      selectedPlots.map((key) => {
        const [col, row] = key.split(':').map(Number);
        return { col, row };
      }),
    [selectedPlots],
  );

  /** Owned plots plus ones already picked in this purchase — the buy ring grows from this edge. */
  const land = useMemo(
    () => [...(garden?.tiles ?? []), ...selectedCells],
    [garden?.tiles, selectedCells],
  );

  const candidates = useMemo(() => {
    if (!garden || !buying) {
      return [] as { col: number; row: number }[];
    }
    const owned = new Set(garden.tiles.map((tile) => tileKey(tile.col, tile.row)));
    const picked = new Set(selectedPlots);
    const extra: { col: number; row: number }[] = [];
    const seen = new Set<string>();
    for (const tile of land) {
      for (const [colOffset, rowOffset] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        const col = tile.col + colOffset;
        const row = tile.row + rowOffset;
        const key = tileKey(col, row);
        if (owned.has(key) || picked.has(key) || seen.has(key)) {
          continue;
        }
        seen.add(key);
        extra.push({ col, row });
      }
    }
    return extra;
  }, [buying, garden, land, selectedPlots]);

  const cells = useMemo(() => {
    const owned = (garden?.tiles ?? []).map((tile) => ({ ...tile, owned: true as const }));
    const open = [
      ...selectedCells.map((tile) => ({ ...tile, id: tileKey(tile.col, tile.row), owned: false as const })),
      ...candidates.map((tile) => ({ ...tile, id: tileKey(tile.col, tile.row), owned: false as const })),
    ];
    return [...owned, ...open];
  }, [candidates, garden?.tiles, selectedCells]);

  const cellByKey = useMemo(() => new Map(cells.map((cell) => [tileKey(cell.col, cell.row), cell])), [cells]);

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
  const columns = Math.max(1, bounds.maxCol - bounds.minCol + 1);
  const rows = Math.max(1, bounds.maxRow - bounds.minRow + 1);

  /** Fit plot size to the owned garden only, so opening buy mode grows the board instead of shrinking plots. */
  const ownedFit = useMemo(() => {
    const ownedBounds = gardenViewBounds(garden?.tiles ?? []);
    const ownedColumns = Math.max(1, ownedBounds.maxCol - ownedBounds.minCol + 1);
    const ownedRows = Math.max(1, ownedBounds.maxRow - ownedBounds.minRow + 1);
    const chrome = GARDEN_SHAPE_BORDER * 2;
    return gardenBoardSize(
      Math.max(0, windowWidth - chrome),
      Math.max(0, windowHeight - chrome),
      ownedColumns,
      ownedRows,
    );
  }, [garden?.tiles, windowHeight, windowWidth]);

  const board = useMemo(() => {
    const gapX = GARDEN_SLOT_GAP * Math.max(0, columns - 1);
    const gapY = GARDEN_SLOT_GAP * Math.max(0, rows - 1);
    const cell = BOARD_CELL;
    return {
      cell,
      width: cell * columns + gapX,
      height: cell * rows + gapY,
    };
  }, [columns, rows]);
  const stride = board.cell + GARDEN_SLOT_GAP;

  const imageUrls = useMemo(
    () => [
      ...(garden?.plants ?? []).map((plant) => plant.photoUrl ?? plant.imageUrl),
      ...(garden?.items ?? []).map((item) => {
        const image = shopItemImageUrl(item.imagePath);
        return typeof image === 'object' && image ? image.uri : null;
      }),
      ...(garden?.kitPlants ?? []).map((plant) => plant.photoUrl ?? plant.imageUrl),
      ...(garden?.kitItems ?? []).map((item) => {
        const image = shopItemImageUrl(item.imagePath);
        return typeof image === 'object' && image ? image.uri : null;
      }),
    ],
    [garden],
  );
  const showVeil = useGardenLoadGate(dataReady, imageUrls);

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
    bindKey: communityId ?? null,
    initialScale: Math.min(1, Math.max(0.55, ownedFit.cell / BOARD_CELL)),
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
      await load({ veil: false });
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
      await load({ veil: false });
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
      await load({ veil: false });
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
    await load({ veil: false });
    if (failure) {
      setError(failure);
    }
  }

  async function removePlant(plantId: string) {
    if (!communityId) {
      return;
    }
    setError(null);
    setGarden((current) =>
      current ? { ...current, plants: current.plants.filter((plant) => plant.id !== plantId) } : current,
    );
    let failure: string | null = null;
    try {
      await removePlantFromCommunity(plantId, communityId);
    } catch (removeError) {
      console.error('[community-garden] remove plant failed', { plantId }, removeError);
      failure = errorText(removeError, 'Could not take that plant back');
    }
    await load({ veil: false });
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
    await load({ veil: false });
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
      const plant = plantAt.get(key);
      if (plant && plant.ownerId === userId) {
        void removePlant(plant.id);
        return;
      }
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
    const onKit = Boolean(kitFrame.current && contains(kitFrame.current, x, y));
    if (current.kind === 'plant' && onKit) {
      const planted = gardenRef.current?.plants.some((plant) => plant.id === current.id);
      if (planted) {
        void removePlant(current.id);
      }
      return;
    }
    if (key != null) {
      const [col, row] = key.split(':').map(Number);
      if (current.kind === 'plant') {
        const planted = gardenRef.current?.plants.find((plant) => plant.id === current.id);
        if (planted && planted.col === col && planted.row === row) {
          return;
        }
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
    if (current.kind === 'item' && placed && onKit) {
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
    drag?.kind === 'plant'
      ? (garden?.kitPlants.find((plant) => plant.id === drag.id) ??
        garden?.plants.find((plant) => plant.id === drag.id))
      : undefined;
  const draggingItem =
    drag?.kind === 'item'
      ? (garden?.kitItems.find((item) => item.id === drag.id) ?? garden?.items.find((item) => item.id === drag.id))
      : undefined;

  const holding = Boolean(selectedPlantId || selectedItemId);
  const hint = buying
    ? selectedPlots.length > 0
      ? `Buy ${selectedPlots.length} for ${price.oxygen.toLocaleString()} oxygen, ${price.pollen.toLocaleString()} pollen. You have ${Math.round(balances.oxygen).toLocaleString()} and ${Math.round(balances.pollen).toLocaleString()}.`
      : `You have ${Math.round(balances.oxygen).toLocaleString()} oxygen and ${Math.round(balances.pollen).toLocaleString()} pollen.`
    : removing
      ? 'Tap one of your plants or items to take it back. Things other members gave stay put.'
      : holding
        ? 'Tap an empty plot to give it. A plant can only live in one garden.'
        : 'Drag a plant or item onto a plot. Drag your own onto the kit to take them back.';

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
              {!dataReady && !garden
                ? 'Loading the garden…'
                : `${formatOxygenMl(garden?.totalOxygen ?? 0)} oxygen · ${formatPollenMg(garden?.totalPollen ?? 0)} pollen`}
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
            <ThemedText type="smallBold">From members</ThemedText>
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
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {formatOxygenMl(member.oxygenMl)} · {formatPollenMg(member.pollenMg)}
                  </ThemedText>
                </View>
              ))
            )}
          </GardenFrame>
        ) : null}

        <View style={styles.actions}>
          <FriendlyButton
            style={styles.smallButton}
            label={buying ? 'Stop' : 'Buy plots'}
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
            style={styles.smallButton}
            label={removing ? 'Done' : 'Take back'}
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
          <FriendlyButton
            style={styles.smallButton}
            label={showNames ? 'Hide names' : 'Names'}
            variant={showNames ? 'primary' : 'ghost'}
            onPress={() => setShowNames((current) => !current)}
          />
          {buying ? (
            <FriendlyButton
            style={styles.smallButton}
              label={busy ? 'Buying…' : selectedPlots.length === 0 ? 'Pick plots' : `Buy ${selectedPlots.length}`}
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

        <View style={styles.stage}>
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
          <View pointerEvents="box-none" style={[styles.cameraHost, showVeil ? styles.hiddenGarden : null]}>
            <Animated.View style={[styles.camera, camera.cameraStyle]}>
              <View style={{ padding: GARDEN_SHAPE_BORDER }}>
                <View style={[styles.board, { width: board.width, height: board.height }]}>
                  <GardenBed
                    tiles={land}
                    minCol={bounds.minCol}
                    minRow={bounds.minRow}
                    columns={columns}
                    rows={rows}
                    cellSize={board.cell}
                  />
                  {Array.from({ length: rows }, (_, rowOffset) => (
                    <View key={bounds.minRow + rowOffset} style={styles.row}>
                      {Array.from({ length: columns }, (_, columnOffset) => {
                    const cell = cellByKey.get(tileKey(bounds.minCol + columnOffset, bounds.minRow + rowOffset));
                    if (!cell) {
                      return <View key={columnOffset} style={{ width: board.cell, height: board.cell }} />;
                    }
                    const key = tileKey(cell.col, cell.row);
                    const laid = itemAtCell.get(key) ?? null;
                    const plant = plantAt.get(key) ?? null;
                    const yours = laid?.ownerId === userId || plant?.ownerId === userId;
                    return (
                      <BoardCell
                        size={board.cell}
                        key={cell.owned ? cell.id : key}
                        owned={cell.owned}
                        selected={selectedPlots.includes(key)}
                        hovered={hoverKey === key && cell.owned}
                        disabled={busy || (cell.owned ? buying || (removing && !yours) : !buying)}
                        plant={plant}
                        item={laid}
                        showNames={showNames}
                        canDrag={cell.owned && !buying && !removing && laid?.ownerId === userId}
                        canDragPlant={cell.owned && !buying && !removing && plant?.ownerId === userId}
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
                    </View>
                  ))}
                  {(garden?.items ?? []).map((item) => (
                    <ItemOverlay
                      key={item.id}
                      item={item}
                      cell={board.cell}
                      left={(item.col - bounds.minCol) * stride}
                      top={(item.row - bounds.minRow) * stride}
                      hidden={drag?.id === item.id}
                      showNames={showNames}
                    />
                  ))}
                </View>
              </View>
            </Animated.View>
          </View>
          <GardenLoadingVeil visible={showVeil} columns={columns} rows={rows} />
        </View>

        <Animated.View
          ref={kitRef}
          style={[
            styles.sidePanel,
            kitFromBottom ? styles.kitSheet : styles.kitSide,
            kitFromBottom ? kitSheetStyle : { width: kitExtent },
          ]}
          onLayout={() => {
            if (kitRef.current) {
              measureView(kitRef.current, (frame) => {
                kitFrame.current = frame;
              });
            }
          }}>
          <View
            style={[styles.drawer, kitFromBottom && { width: '100%', height: sheetOpen - SIDE_CLOSED }]}
            pointerEvents={sideOpen ? 'auto' : 'none'}>
          <View style={styles.drawerHeader}>
            <ThemedText type="smallBold" style={styles.kitTitle}>
              Plants and tiles
            </ThemedText>
            <ThemedText type="small" style={styles.kitHint}>
              Drag or tap a plant or tile, then a plot. Drag your own back here to take it.
            </ThemedText>
          </View>
          <ScrollView
            style={styles.sideScroll}
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
          <GestureDetector gesture={sheetDrag}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: sideOpen }}
              accessibilityLabel={sideOpen ? 'Collapse kit' : 'Expand kit'}
              onPress={() => setSideOpen((open) => !open)}
              style={({ pressed }) => [kitFromBottom ? styles.sheetBar : styles.rail, pressed && { opacity: 0.75 }]}>
              <ThemedText type="smallBold" style={styles.railChevron}>
                {kitFromBottom ? (sideOpen ? '▼' : '▲') : sideOpen ? '›' : '‹'}
              </ThemedText>
              {kitFromBottom ? (
                <ThemedText type="smallBold" style={styles.sheetLabel}>
                  Kit
                </ThemedText>
              ) : (
                <View style={styles.railLabelWrap}>
                  <ThemedText type="smallBold" style={styles.railLabel}>
                    Kit
                  </ThemedText>
                </View>
              )}
              <View style={kitFromBottom ? styles.sheetStats : undefined}>
                <View style={styles.railStat}>
                  <ThemedText type="smallBold" style={styles.railStatText}>
                    {garden?.kitPlants.length ?? 0}
                  </ThemedText>
                </View>
                <View style={styles.railStat}>
                  <ThemedText type="smallBold" style={styles.railStatText}>
                    {garden?.kitItems.length ?? 0}
                  </ThemedText>
                </View>
              </View>
            </Pressable>
          </GestureDetector>
        </Animated.View>
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
  size,
  owned,
  selected,
  hovered,
  disabled,
  plant,
  item,
  showNames,
  canDrag,
  canDragPlant = false,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  size: number;
  owned: boolean;
  selected: boolean;
  hovered: boolean;
  disabled: boolean;
  plant: CommunityGarden['plants'][number] | null;
  item: CommunityGardenItem | null;
  showNames: boolean;
  canDrag: boolean;
  canDragPlant?: boolean;
  onPress: () => void;
  onDragStart: (kind: DragState['kind'], id: string, x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
}) {
  const itemId = item?.id ?? null;
  const plantId = plant?.id ?? null;
  const dragKind: DragState['kind'] | null =
    canDrag && itemId ? 'item' : canDragPlant && plantId ? 'plant' : null;
  const dragId = dragKind === 'item' ? itemId : plantId;
  const gesture = useDragGesture({
    enabled: dragKind != null && dragId != null,
    onBoard: true,
    onStart: useCallback(
      (x, y) => {
        if (dragKind && dragId) {
          onDragStart(dragKind, dragId, x, y);
        }
      },
      [dragId, dragKind, onDragStart],
    ),
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
      {plant ? <PlantFace uri={plant.photoUrl ?? plant.imageUrl} owner={showNames ? plant.ownerName : null} /> : null}
      {uri && !lamp ? (
        <Image
          source={uri}
          style={standing ? styles.decor : styles.groundFill}
          contentFit={standing ? 'contain' : 'cover'}
          pointerEvents="none"
        />
      ) : null}
      {showNames && item && single ? (
        <ThemedText type="smallBold" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.owner}>
          {item.ownerName}
        </ThemedText>
      ) : null}
      {hovered ? <View pointerEvents="none" style={[styles.groundFill, styles.hover]} /> : null}
      {uri && glowKindFor(item?.slug) === 'fire' ? <ItemGlow kind="fire" anchor="middle" /> : null}
    </Pressable>
  );

  return (
    <View style={{ width: size, height: size }}>
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
  showNames,
}: {
  item: CommunityGardenItem;
  cell: number;
  left: number;
  top: number;
  hidden: boolean;
  showNames: boolean;
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
          <Image
            source={uri}
            style={styles.streetLampImage}
            contentFit="contain"
            priority="high"
            cachePolicy="memory-disk"
            loading="eager"
          />
        </View>
        <View pointerEvents="none" style={styles.lampGlowBox}>
          <ItemGlow kind="lamp" />
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
      {showNames ? (
        <ThemedText type="smallBold" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.owner}>
          {item.ownerName}
        </ThemedText>
      ) : null}
    </View>
  );
}

function PlantFace({ uri, owner }: { uri: string | null; owner: string | null }) {
  return (
    <View style={styles.fill}>
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.groundFill}
          contentFit="cover"
          priority="high"
          cachePolicy="memory-disk"
          loading="eager"
          pointerEvents="none"
        />
      ) : null}
      {owner ? (
        <ThemedText type="smallBold" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.owner}>
          {owner}
        </ThemedText>
      ) : null}
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
    gap: Spacing.one,
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
  hiddenGarden: {
    opacity: 0,
  },
  camera: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 1,
    overflow: 'visible',
    transformOrigin: 'left top',
  },
  board: { position: 'relative', gap: GARDEN_SLOT_GAP },
  row: { flexDirection: 'row', gap: GARDEN_SLOT_GAP },
  cell: {
    flex: 1,
    borderRadius: Platform.OS === 'web' ? Radius.sm : 5,
    overflow: 'hidden',
  },
  fill: { flex: 1, width: '100%', height: '100%' },
  groundFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  hover: { backgroundColor: GardenPalette.plotHover, opacity: 0.55 },
  decor: { position: 'absolute', width: '72%', height: '72%', left: '14%', top: '14%', zIndex: 1 },
  piece: { position: 'absolute', zIndex: 2 },
  /** Street lamp: base near the plot's bottom edge, standing about two plots tall. */
  streetLamp: { position: 'absolute', zIndex: 3, alignItems: 'center', justifyContent: 'flex-end' },
  lampGlowBox: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '200%' },
  streetLampBox: { height: '200%', aspectRatio: 49 / 332 },
  streetLampImage: { width: '100%', height: '100%' },
  owner: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
    color: '#FFFFFF',
    fontWeight: '700',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  stage: { flex: 1, position: 'relative' },
  smallButton: { flex: 1, minHeight: 36, paddingHorizontal: Spacing.two },
  sidePanel: {
    position: 'absolute',
    zIndex: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GardenPalette.panelBorder,
    backgroundColor: GardenPalette.panel,
    shadowColor: '#3B2A1A',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
  },
  kitSide: {
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderRadius: Radius.lg,
    shadowOffset: { width: -6, height: 0 },
  },
  kitSheet: {
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'column',
    justifyContent: 'flex-end',
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    shadowOffset: { width: 0, height: -6 },
  },
  drawer: { width: SIDE_OPEN - SIDE_CLOSED, height: '100%', flexShrink: 0 },
  drawerHeader: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.one,
    borderBottomWidth: 1,
    borderBottomColor: GardenPalette.panelBorder,
  },
  sideScroll: { flex: 1 },
  sheetBar: {
    height: SIDE_CLOSED,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    backgroundColor: GardenPalette.bar,
  },
  sheetLabel: { flex: 1, color: GardenPalette.barText },
  sheetStats: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rail: {
    width: SIDE_CLOSED,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    backgroundColor: GardenPalette.bar,
  },
  railChevron: { color: GardenPalette.barText, fontSize: 22, lineHeight: 24 },
  railLabelWrap: { height: 36, alignItems: 'center', justifyContent: 'center' },
  railLabel: {
    color: GardenPalette.barTextMuted,
    transform: [{ rotate: '-90deg' }],
    width: 36,
    textAlign: 'center',
  },
  railStat: {
    minWidth: 28,
    height: 28,
    borderRadius: Radius.pill,
    backgroundColor: GardenPalette.barPill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
  },
  railStatText: { color: GardenPalette.barText },
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
