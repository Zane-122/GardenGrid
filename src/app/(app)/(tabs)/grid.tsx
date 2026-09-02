import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GardenFrame } from '@/components/app/garden-frame';
import { PlantToken } from '@/components/grid/plant-token';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import {
  assignPlantToSlot,
  clearGardenSlot,
  GARDEN_BED_PAD,
  GARDEN_COLUMNS,
  GARDEN_FRAME_PAD,
  GARDEN_MIN_CELL,
  GARDEN_ROWS,
  GARDEN_SLOT_COUNT,
  GARDEN_SLOT_GAP,
  gardenBoardSize,
  listGardenSlots,
  slotIndexForPlant,
  type GardenSlot,
} from '@/utils/garden';
import { listUserPlants, plantDisplayName, type InventoryPlant } from '@/utils/plants';

type Frame = { x: number; y: number; width: number; height: number };
type DragState = { plantId: string; x: number; y: number };

function contains(frame: Frame, x: number, y: number) {
  return x >= frame.x && y >= frame.y && x <= frame.x + frame.width && y <= frame.y + frame.height;
}

function measureView(view: View, onFrame: (frame: Frame) => void) {
  view.measureInWindow((x, y, width, height) => {
    if (width > 0 && height > 0) {
      onFrame({ x, y, width, height });
    }
  });
}

function optimisticAssign(slots: GardenSlot[], plantId: string, slotIndex: number, userId: string) {
  const from = slots.find((slot) => slot.plant_id === plantId);
  const to = slots.find((slot) => slot.slot_index === slotIndex);
  if (from?.slot_index === slotIndex) {
    return slots;
  }

  const others = slots.filter((slot) => slot.plant_id !== plantId && slot.slot_index !== slotIndex);

  if (from && to) {
    return [...others, { ...from, slot_index: slotIndex }, { ...to, slot_index: from.slot_index }];
  }
  if (from) {
    return [...others, { ...from, slot_index: slotIndex }];
  }

  return [
    ...others,
    {
      id: to?.id ?? `local-${plantId}`,
      user_id: userId,
      plant_id: plantId,
      slot_index: slotIndex,
      created_at: to?.created_at ?? new Date().toISOString(),
    },
  ];
}

export default function GridScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const compact = windowWidth < 500 || windowHeight < 760;
  const framePad = compact ? 7 : GARDEN_FRAME_PAD;
  const bedPad = compact ? 6 : GARDEN_BED_PAD;
  const bed = {
    woodOuter: theme.woodOuter,
    wood: theme.wood,
    woodEdge: theme.woodEdge,
    soil: theme.soil,
    plot: theme.plot,
    plotLine: theme.plotLine,
    plotHover: theme.plotHover,
    label: theme.plotLabel,
    shadow: theme.shadow,
  };
  const { user } = useAuth();
  const [plants, setPlants] = useState<InventoryPlant[]>([]);
  const [slots, setSlots] = useState<GardenSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [boardArea, setBoardArea] = useState({ width: 0, height: 0 });
  const [headerHeight, setHeaderHeight] = useState(compact ? 64 : 84);

  const slotFrames = useRef<Partial<Record<number, Frame>>>({});
  const slotViews = useRef<Partial<Record<number, View | null>>>({});
  const trayFrame = useRef<Frame | null>(null);
  const trayRef = useRef<View>(null);
  const screenRef = useRef<View>(null);
  const screenOrigin = useRef({ x: 0, y: 0 });
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  function remasureDropTargets() {
    for (const [index, view] of Object.entries(slotViews.current)) {
      if (view) {
        measureView(view, (frame) => {
          slotFrames.current[Number(index)] = frame;
        });
      }
    }
    if (trayRef.current) {
      measureView(trayRef.current, (frame) => {
        trayFrame.current = frame;
      });
    }
    if (screenRef.current) {
      measureView(screenRef.current, (frame) => {
        screenOrigin.current = { x: frame.x, y: frame.y };
      });
    }
  }

  const plantsById = useMemo(() => new Map(plants.map((plant) => [plant.id, plant])), [plants]);
  const slotMap = useMemo(() => new Map(slots.map((slot) => [slot.slot_index, slot])), [slots]);

  const boardSize = useMemo(() => {
    const chrome = (framePad + bedPad + 3) * 2;
    const areaWidth = boardArea.width || windowWidth - (compact ? 32 : 48);
    const innerWidth = Math.max(0, areaWidth - chrome);
    const tabBar = 52 + insets.bottom;
    const trayFloor = compact ? 124 : 168;
    const chromeVertical = insets.top + tabBar + headerHeight + (compact ? 16 : 28) + trayFloor;
    const maxFrameHeight = Math.max(168, windowHeight - chromeVertical);
    const maxInnerHeight = Math.max(GARDEN_MIN_CELL * GARDEN_ROWS, maxFrameHeight - chrome);

    return gardenBoardSize(innerWidth, maxInnerHeight);
  }, [
    bedPad,
    boardArea.width,
    compact,
    framePad,
    headerHeight,
    insets.bottom,
    insets.top,
    windowHeight,
    windowWidth,
  ]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextPlants, nextSlots] = await Promise.all([listUserPlants(), listGardenSlots()]);
      setPlants(nextPlants);
      setSlots(nextSlots);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your garden');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function placePlant(plantId: string, slotIndex: number) {
    if (!user) {
      return;
    }

    const previous = slotsRef.current;
    setSlots(optimisticAssign(previous, plantId, slotIndex, user.id));
    setSelectedPlantId(null);
    setHoverSlot(null);
    try {
      await assignPlantToSlot(plantId, slotIndex);
      setSlots(await listGardenSlots());
    } catch (placeError) {
      setSlots(previous);
      setError(placeError instanceof Error ? placeError.message : 'Could not place that plant');
    }
  }

  async function removeFromSlot(slotIndex: number) {
    const previous = slotsRef.current;
    setSlots((current) => current.filter((slot) => slot.slot_index !== slotIndex));
    setSelectedPlantId(null);
    try {
      await clearGardenSlot(slotIndex);
    } catch (removeError) {
      setSlots(previous);
      setError(removeError instanceof Error ? removeError.message : 'Could not clear that slot');
    }
  }

  function slotAtPoint(x: number, y: number) {
    for (const [index, frame] of Object.entries(slotFrames.current)) {
      if (frame && contains(frame, x, y)) {
        return Number(index);
      }
    }
    return null;
  }

  function finishDrag(x: number, y: number, plantId: string) {
    const slotIndex = slotAtPoint(x, y);
    if (slotIndex != null) {
      void placePlant(plantId, slotIndex);
      return;
    }
    if (trayFrame.current && contains(trayFrame.current, x, y)) {
      const currentIndex = slotIndexForPlant(slotsRef.current, plantId);
      if (currentIndex != null) {
        void removeFromSlot(currentIndex);
      }
    }
  }

  const finishDragRef = useRef(finishDrag);
  finishDragRef.current = finishDrag;

  const startDrag = useCallback((plantId: string, x: number, y: number) => {
    remasureDropTargets();
    setSelectedPlantId(plantId);
    setDrag({ plantId, x, y });
  }, []);

  const moveDrag = useCallback((x: number, y: number) => {
    setDrag((current) => (current ? { ...current, x, y } : current));
    let nextHover: number | null = null;
    for (const [index, frame] of Object.entries(slotFrames.current)) {
      if (frame && contains(frame, x, y)) {
        nextHover = Number(index);
        break;
      }
    }
    setHoverSlot(nextHover);
  }, []);

  const endDrag = useCallback((x: number, y: number, plantId: string) => {
    setDrag(null);
    setHoverSlot(null);
    finishDragRef.current(x, y, plantId);
  }, []);

  function handleSlotPress(index: number) {
    if (selectedPlantId) {
      void placePlant(selectedPlantId, index);
      return;
    }
    const occupant = slotMap.get(index);
    if (occupant) {
      setSelectedPlantId(occupant.plant_id);
    }
  }

  const draggingPlant = drag ? plantsById.get(drag.plantId) : undefined;
  const placedCount = slots.length;

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
        <View
          style={[
            styles.content,
            {
              paddingTop: insets.top + (compact ? Spacing.two : Spacing.three),
              paddingHorizontal: compact ? Spacing.three : Spacing.four,
              gap: compact ? Spacing.one : Spacing.two,
            },
          ]}>
          <View
            style={styles.header}
            onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}>
            <ThemedText type="small" themeColor="textSecondary">
              Garden Grid
            </ThemedText>
            <ThemedText type="heading">Grid</ThemedText>
            {compact ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {loading ? 'Loading…' : `${placedCount}/${GARDEN_SLOT_COUNT} · drag onto a plot`}
              </ThemedText>
            ) : (
              <ThemedText themeColor="textSecondary">
                {loading
                  ? 'Loading garden…'
                  : `${placedCount} of ${GARDEN_SLOT_COUNT} slots filled. Drag a plant onto a plot.`}
              </ThemedText>
            )}
          </View>

          {error ? (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          ) : null}

          <View
            style={styles.boardArea}
            onLayout={(event) => {
              const { width } = event.nativeEvent.layout;
              setBoardArea({ width, height: event.nativeEvent.layout.height });
            }}>
            <View
              style={[
                styles.frameOuter,
                {
                  backgroundColor: bed.woodOuter,
                  borderColor: bed.woodEdge,
                  shadowColor: bed.shadow,
                },
              ]}>
              <View
                style={[
                  styles.frameInner,
                  { backgroundColor: bed.wood, borderColor: bed.woodEdge, padding: framePad },
                ]}>
                <View
                  style={[
                    styles.soilBed,
                    { backgroundColor: bed.soil, borderColor: bed.plotLine, padding: bedPad },
                  ]}>
                  <View style={[styles.board, { width: boardSize.width, height: boardSize.height }]}>
                    {Array.from({ length: GARDEN_ROWS }, (_, row) => (
                      <View key={row} style={styles.row}>
                        {Array.from({ length: GARDEN_COLUMNS }, (_, column) => {
                          const index = row * GARDEN_COLUMNS + column;
                          const occupant = slotMap.get(index);
                          const plant = occupant ? plantsById.get(occupant.plant_id) : undefined;
                          const highlighted = hoverSlot === index;

                          return (
                            <GardenSlotCell
                              key={index}
                              index={index}
                              plant={plant}
                              bed={bed}
                              selected={selectedPlantId != null && occupant?.plant_id === selectedPlantId}
                              highlighted={highlighted}
                              onLayoutView={(view) => {
                                slotViews.current[index] = view;
                                measureView(view, (frame) => {
                                  slotFrames.current[index] = frame;
                                });
                              }}
                              onPress={() => handleSlotPress(index)}
                              onLongPress={() => {
                                if (occupant) {
                                  void removeFromSlot(index);
                                }
                              }}
                              onDragStart={startDrag}
                              onDragMove={moveDrag}
                              onDragEnd={endDrag}
                            />
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          </View>

          <GardenFrame
            variant="bed"
            fill
            style={styles.tray}
            contentStyle={styles.trayInner}
            padded={false}>
            <View
              ref={trayRef}
              style={styles.trayContent}
              onLayout={() => {
                if (trayRef.current) {
                  measureView(trayRef.current, (frame) => {
                    trayFrame.current = frame;
                  });
                }
              }}>
              <ThemedText type="smallBold">Your plants</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {plants.length === 0
                  ? 'Add plants from the Add tab, then drag them up into the grid.'
                  : 'Drag a plant up onto a plot. Drag one off the grid to remove it.'}
              </ThemedText>
              <ScrollView
                horizontal
                scrollEnabled={!drag}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.trayList}>
                {plants.map((plant) => {
                  const placedIndex = slotIndexForPlant(slots, plant.id);
                  return (
                    <InventoryItem
                      key={plant.id}
                      plant={plant}
                      placed={placedIndex != null}
                      selected={selectedPlantId === plant.id}
                      dragging={drag?.plantId === plant.id}
                      onPress={() =>
                        setSelectedPlantId((current) => (current === plant.id ? null : plant.id))
                      }
                      onDragStart={startDrag}
                      onDragMove={moveDrag}
                      onDragEnd={endDrag}
                    />
                  );
                })}
              </ScrollView>
            </View>
          </GardenFrame>
        </View>

        {drag && draggingPlant ? (
          <View
            pointerEvents="none"
            style={[
              styles.dragGhost,
              {
                left: drag.x - screenOrigin.current.x - 52,
                top: drag.y - screenOrigin.current.y - 64,
              },
            ]}>
            <PlantToken plant={draggingPlant} compact />
          </View>
        ) : null}
      </View>
    </ThemedView>
  );
}

const GardenSlotCell = memo(function GardenSlotCell({
  index,
  plant,
  bed,
  selected,
  highlighted,
  onLayoutView,
  onPress,
  onLongPress,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  index: number;
  plant?: InventoryPlant;
  bed: {
    woodOuter: string;
    wood: string;
    woodEdge: string;
    soil: string;
    plot: string;
    plotLine: string;
    plotHover: string;
    label: string;
    shadow: string;
  };
  selected: boolean;
  highlighted: boolean;
  onLayoutView: (view: View) => void;
  onPress: () => void;
  onLongPress: () => void;
  onDragStart: (plantId: string, x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number, plantId: string) => void;
}) {
  const cellRef = useRef<View>(null);
  const plantId = plant?.id;

  const gesture = useMemo(() => {
    if (!plantId) {
      return null;
    }

    return Gesture.Pan()
      .minDistance(6)
      .runOnJS(true)
      .onStart((event) => onDragStart(plantId, event.absoluteX, event.absoluteY))
      .onUpdate((event) => onDragMove(event.absoluteX, event.absoluteY))
      .onEnd((event) => onDragEnd(event.absoluteX, event.absoluteY, plantId));
  }, [plantId, onDragStart, onDragMove, onDragEnd]);

  const body = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        plant ? `${plantDisplayName(plant.info)}, slot ${index}` : `Empty slot ${index}`
      }
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.slot,
        plant ? styles.slotFilled : null,
        {
          backgroundColor: highlighted ? bed.plotHover : bed.plot,
          borderColor: selected || highlighted ? bed.woodOuter : bed.plotLine,
        },
        (selected || highlighted) && { borderWidth: 2 },
        pressed && styles.pressed,
      ]}>
      {plant ? (
        <PlantToken plant={plant} selected={selected} />
      ) : (
        <ThemedText type="small" style={[styles.slotIndex, { color: bed.label }]}>
          {index}
        </ThemedText>
      )}
    </Pressable>
  );

  return (
    <View
      ref={cellRef}
      style={styles.slotWrap}
      onLayout={() => {
        if (cellRef.current) {
          onLayoutView(cellRef.current);
        }
      }}>
      {gesture ? (
        <View style={styles.fill}>
          <GestureDetector gesture={gesture}>{body}</GestureDetector>
        </View>
      ) : (
        body
      )}
    </View>
  );
});

const InventoryItem = memo(function InventoryItem({
  plant,
  placed,
  selected,
  dragging,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  plant: InventoryPlant;
  placed: boolean;
  selected: boolean;
  dragging: boolean;
  onPress: () => void;
  onDragStart: (plantId: string, x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number, plantId: string) => void;
}) {
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(4)
        .activeOffsetY([-4, 4])
        .failOffsetX([-48, 48])
        .runOnJS(true)
        .onStart((event) => onDragStart(plant.id, event.absoluteX, event.absoluteY))
        .onUpdate((event) => onDragMove(event.absoluteX, event.absoluteY))
        .onEnd((event) => onDragEnd(event.absoluteX, event.absoluteY, plant.id)),
    [plant.id, onDragStart, onDragMove, onDragEnd]
  );

  return (
    <GestureDetector gesture={gesture}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={plantDisplayName(plant.info)}
        onPress={onPress}
        style={({ pressed }) => [pressed && styles.pressed, dragging && styles.draggingSource]}>
        <PlantToken plant={plant} compact placed={placed} selected={selected} />
      </Pressable>
    </GestureDetector>
  );
});

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
    gap: Spacing.two,
  },
  header: {
    gap: Spacing.half,
  },
  boardArea: {
    width: '100%',
    alignSelf: 'stretch',
    paddingVertical: Spacing.one,
  },
  frameOuter: {
    width: '100%',
    padding: 3,
    borderWidth: 1,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 6,
  },
  frameInner: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 9,
  },
  soilBed: {
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 7,
  },
  board: {
    gap: GARDEN_SLOT_GAP,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: GARDEN_SLOT_GAP,
  },
  slotWrap: {
    flex: 1,
    aspectRatio: 1,
  },
  slot: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderWidth: 1,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotFilled: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },
  slotIndex: {
    fontVariant: ['tabular-nums'],
  },
  tray: {
    flex: 1,
    minHeight: 120,
  },
  trayInner: {
    flex: 1,
  },
  trayContent: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  trayList: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
    paddingRight: Spacing.two,
  },
  draggingSource: {
    opacity: 0.35,
  },
  dragGhost: {
    position: 'absolute',
    zIndex: 20,
  },
  fill: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  pressed: {
    opacity: 0.75,
  },
});
