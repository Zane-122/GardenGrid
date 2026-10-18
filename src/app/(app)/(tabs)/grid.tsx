import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { GardenFrame } from "@/components/app/garden-frame";
import { GrassBackground } from "@/components/app/grass-background";
import { PlantToken } from "@/components/grid/plant-token";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  GardenPalette,
  MaxContentWidth,
  Radius,
  Spacing,
} from "@/constants/theme";
import { useAuth } from "@/context/auth";
import { useTweenedNumber } from "@/hooks/use-tweened-number";
import { useTheme } from "@/hooks/use-theme";
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
} from "@/utils/garden";
import {
  listUserPlants,
  plantDisplayName,
  type InventoryPlant,
} from "@/utils/plants";
import { listLatestWateringDates, plantWateringSchedule } from "@/utils/watering";

const TRAY_COLLAPSED_HEIGHT = 56;
const TRAY_OPEN_HEIGHT = 270;
const TRAY_OPEN_HEIGHT_COMPACT = 260;

type Frame = { x: number; y: number; width: number; height: number };
type DragState = { plantId: string; x: number; y: number };

function contains(frame: Frame, x: number, y: number) {
  return (
    x >= frame.x &&
    y >= frame.y &&
    x <= frame.x + frame.width &&
    y <= frame.y + frame.height
  );
}

function measureView(view: View, onFrame: (frame: Frame) => void) {
  view.measureInWindow((x, y, width, height) => {
    if (width > 0 && height > 0) {
      onFrame({ x, y, width, height });
    }
  });
}

function optimisticAssign(
  slots: GardenSlot[],
  plantId: string,
  slotIndex: number,
  userId: string,
) {
  const from = slots.find((slot) => slot.plant_id === plantId);
  const to = slots.find((slot) => slot.slot_index === slotIndex);
  if (from?.slot_index === slotIndex) {
    return slots;
  }

  const others = slots.filter(
    (slot) => slot.plant_id !== plantId && slot.slot_index !== slotIndex,
  );

  if (from && to) {
    return [
      ...others,
      { ...from, slot_index: slotIndex },
      { ...to, slot_index: from.slot_index },
    ];
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const compact = windowWidth < 500 || windowHeight < 760;
  const framePad = 0;
  const bedPad = 0;
  const bed = {
    woodOuter: GardenPalette.woodOuter,
    wood: GardenPalette.highlight,
    woodEdge: GardenPalette.woodEdge,
    soil: GardenPalette.soil,
    plot: GardenPalette.plot,
    plotLine: GardenPalette.plotLine,
    plotHover: GardenPalette.plotHover,
    label: GardenPalette.plotLabel,
  };
  const { user } = useAuth();
  const [plants, setPlants] = useState<InventoryPlant[]>([]);
  const [latestWatered, setLatestWatered] = useState<Map<string, string>>(new Map());
  const [slots, setSlots] = useState<GardenSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [boardAreaWidth, setBoardAreaWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [errorHeight, setErrorHeight] = useState(0);
  const [trayOpen, setTrayOpen] = useState(false);

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

  const plantsById = useMemo(
    () => new Map(plants.map((plant) => [plant.id, plant])),
    [plants],
  );
  const slotMap = useMemo(
    () => new Map(slots.map((slot) => [slot.slot_index, slot])),
    [slots],
  );

  const trayTarget = trayOpen
    ? compact
      ? TRAY_OPEN_HEIGHT_COMPACT
      : TRAY_OPEN_HEIGHT
    : TRAY_COLLAPSED_HEIGHT;
  const trayHeight = useTweenedNumber(trayTarget);
  const trayExpanded = trayOpen || trayHeight > TRAY_COLLAPSED_HEIGHT + 1;

  // The board's height is whatever the tray leaves over, computed from
  // stable measurements so it follows the tray tween frame by frame.
  const contentGap = compact ? Spacing.one : Spacing.two;
  const contentPaddingTop = compact ? Spacing.two : Spacing.three;
  const boardAreaHeight =
    contentHeight > 0
      ? Math.max(
          0,
          contentHeight -
            contentPaddingTop -
            Spacing.two -
            headerHeight -
            trayHeight -
            contentGap * (error ? 3 : 2) -
            (error ? errorHeight : 0),
        )
      : windowHeight / 2;

  const boardSize = useMemo(() => {
    // frameOuter, frameInner and soilBed borders (1 each) per side
    const chrome = (framePad + bedPad + 3) * 2;
    const areaWidth = boardAreaWidth || windowWidth - (compact ? 32 : 48);
    const innerWidth = Math.max(0, areaWidth - chrome);
    const maxInnerHeight = Math.max(
      GARDEN_MIN_CELL * GARDEN_ROWS,
      boardAreaHeight - chrome,
    );

    return gardenBoardSize(innerWidth, maxInnerHeight);
  }, [bedPad, boardAreaHeight, boardAreaWidth, compact, framePad, windowWidth]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextPlants, nextSlots] = await Promise.all([
        listUserPlants(),
        listGardenSlots(),
      ]);
      setPlants(nextPlants);
      setSlots(nextSlots);
      try {
        setLatestWatered(await listLatestWateringDates());
      } catch (waterError) {
        setError(
          waterError instanceof Error
            ? waterError.message
            : "Could not load watering logs",
        );
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load your garden",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
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
      setError(
        placeError instanceof Error
          ? placeError.message
          : "Could not place that plant",
      );
    }
  }

  async function removeFromSlot(slotIndex: number) {
    const previous = slotsRef.current;
    setSlots((current) =>
      current.filter((slot) => slot.slot_index !== slotIndex),
    );
    setSelectedPlantId(null);
    try {
      await clearGardenSlot(slotIndex);
    } catch (removeError) {
      setSlots(previous);
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Could not clear that slot",
      );
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
    <ThemedView style={styles.root}>
      <GrassBackground />
      <View
        ref={screenRef}
        style={styles.screen}
        onLayout={() => {
          if (screenRef.current) {
            measureView(screenRef.current, (frame) => {
              screenOrigin.current = { x: frame.x, y: frame.y };
            });
          }
        }}
      >
        <View
          onLayout={(event) =>
            setContentHeight(event.nativeEvent.layout.height)
          }
          style={[
            styles.content,
            {
              paddingTop: contentPaddingTop,
              paddingHorizontal: compact ? Spacing.three : Spacing.four,
              gap: contentGap,
            },
          ]}
        >
          <View
            style={styles.header}
            onLayout={(event) =>
              setHeaderHeight(event.nativeEvent.layout.height)
            }
          >
            <ThemedText
              type="heading"
              style={{ color: GardenPalette.panelText }}
            >
              Your Grid
            </ThemedText>
            {compact ? (
              <>
                <ThemedText
                  type="small"
                  style={{ color: GardenPalette.panelTextSecondary }}
                  numberOfLines={1}
                >
                  {loading
                    ? "Loading…"
                    : `${placedCount}/${GARDEN_SLOT_COUNT} · drag onto a plot`}
                </ThemedText>
              </>
            ) : (
              <ThemedText style={{ color: GardenPalette.panelTextSecondary }}>
                {loading
                  ? "Loading garden…"
                  : `${placedCount} of ${GARDEN_SLOT_COUNT} slots filled. Drag a plant onto a plot.`}
              </ThemedText>
            )}
          </View>

          {error ? (
            <ThemedText
              type="small"
              style={[styles.errorText, { color: GardenPalette.panelDanger }]}
              onLayout={(event) =>
                setErrorHeight(event.nativeEvent.layout.height)
              }
            >
              {error}
            </ThemedText>
          ) : null}

          <View
            style={[styles.boardArea, { height: boardAreaHeight }]}
            onLayout={(event) =>
              setBoardAreaWidth(event.nativeEvent.layout.width)
            }
          >
            <View pointerEvents="box-none" style={styles.boardCenter}>
              <View
                style={[
                  styles.frameOuter,
                  {
                    backgroundColor: bed.woodOuter,
                    borderColor: bed.woodEdge,
                  },
                ]}
              >
                <View
                  style={[
                    styles.frameInner,
                    {
                      backgroundColor: bed.soil,
                      borderColor: bed.woodEdge,
                      padding: framePad,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.soilBed,
                      {
                        backgroundColor: bed.soil,
                        borderColor: bed.plotLine,
                        padding: bedPad,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.board,
                        { width: boardSize.width, height: boardSize.height },
                      ]}
                    >
                      {Array.from({ length: GARDEN_ROWS }, (_, row) => (
                        <View key={row} style={styles.row}>
                          {Array.from(
                            { length: GARDEN_COLUMNS },
                            (_, column) => {
                              const index = row * GARDEN_COLUMNS + column;
                              const occupant = slotMap.get(index);
                              const plant = occupant
                                ? plantsById.get(occupant.plant_id)
                                : undefined;
                              const highlighted = hoverSlot === index;

                              return (
                                <GardenSlotCell
                                  key={index}
                                  index={index}
                                  plant={plant}
                                  needsWater={
                                    plant != null &&
                                    plantWateringSchedule(
                                      plant,
                                      latestWatered.get(plant.id) ?? null,
                                    ).needsWater
                                  }
                                  bed={bed}
                                  selected={
                                    selectedPlantId != null &&
                                    occupant?.plant_id === selectedPlantId
                                  }
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
                            },
                          )}
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            </View>
          </View>

          <GardenFrame
            variant="bed"
            style={{
              height: trayHeight,
              backgroundColor: GardenPalette.panel,
              borderColor: GardenPalette.panelBorder,
            }}
            contentStyle={styles.trayInner}
            padded={false}
          >
            <View
              ref={trayRef}
              style={trayExpanded ? styles.trayContent : styles.trayCollapsed}
              onLayout={() => {
                if (trayRef.current) {
                  measureView(trayRef.current, (frame) => {
                    trayFrame.current = frame;
                  });
                }
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: trayOpen }}
                accessibilityLabel={
                  trayOpen ? "Hide your plants" : "Show your plants"
                }
                onPress={() => setTrayOpen((open) => !open)}
                style={({ pressed }) => [
                  styles.trayToggle,
                  pressed && styles.pressed,
                ]}
              >
                <ThemedText
                  type="smallBold"
                  style={{ color: GardenPalette.panelText }}
                >
                  Your plants{plants.length > 0 ? ` (${plants.length})` : ""}
                </ThemedText>
                <ThemedText
                  type="smallBold"
                  style={{ color: GardenPalette.panelText }}
                >
                  {trayOpen ? "▼" : "▲"}
                </ThemedText>
              </Pressable>
              {trayExpanded ? (
                <ThemedText
                  type="small"
                  style={{ color: GardenPalette.panelTextSecondary }}
                >
                  {plants.length === 0
                    ? "Add plants from the Add tab, then drag them up into the grid."
                    : "Drag a plant up onto a plot. Drag one off the grid to remove it."}
                </ThemedText>
              ) : null}
              {trayExpanded ? (
                <ScrollView
                  horizontal
                  scrollEnabled={!drag}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.trayList}
                >
                  {plants.map((plant) => {
                    const placedIndex = slotIndexForPlant(slots, plant.id);
                    return (
                      <InventoryItem
                        key={plant.id}
                        plant={plant}
                        needsWater={
                          plantWateringSchedule(plant, latestWatered.get(plant.id) ?? null)
                            .needsWater
                        }
                        placed={placedIndex != null}
                        selected={selectedPlantId === plant.id}
                        dragging={drag?.plantId === plant.id}
                        onPress={() =>
                          setSelectedPlantId((current) =>
                            current === plant.id ? null : plant.id,
                          )
                        }
                        onDragStart={startDrag}
                        onDragMove={moveDrag}
                        onDragEnd={endDrag}
                      />
                    );
                  })}
                </ScrollView>
              ) : null}
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
            ]}
          >
            <PlantToken
              plant={draggingPlant}
              compact
              needsWater={
                plantWateringSchedule(
                  draggingPlant,
                  latestWatered.get(draggingPlant.id) ?? null,
                ).needsWater
              }
            />
          </View>
        ) : null}
      </View>
    </ThemedView>
  );
}

const GardenSlotCell = memo(function GardenSlotCell({
  index,
  plant,
  needsWater = false,
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
  needsWater?: boolean;
  bed: {
    woodOuter: string;
    wood: string;
    woodEdge: string;
    soil: string;
    plot: string;
    plotLine: string;
    plotHover: string;
    label: string;
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
      .onStart((event) =>
        onDragStart(plantId, event.absoluteX, event.absoluteY),
      )
      .onUpdate((event) => onDragMove(event.absoluteX, event.absoluteY))
      .onEnd((event) => onDragEnd(event.absoluteX, event.absoluteY, plantId));
  }, [plantId, onDragStart, onDragMove, onDragEnd]);

  const body = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        plant
          ? `${plantDisplayName(plant.info)}, slot ${index}`
          : `Empty slot ${index}`
      }
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.slot,
        plant ? styles.slotFilled : null,
        {
          backgroundColor: highlighted ? bed.plotHover : bed.plot,
          borderColor: selected || highlighted ? bed.wood : bed.plotLine,
        },
        (selected || highlighted) && { borderWidth: 2 },
        pressed && styles.pressed,
      ]}
    >
      {plant ? (
        <PlantToken plant={plant} selected={selected} needsWater={needsWater} />
      ) : (
        <>
          <Image
            source={require("@/assets/images/soil_tile.png")}
            style={styles.slotSoil}
            contentFit="cover"
            pointerEvents="none"
          />
          {highlighted ? (
            <View
              pointerEvents="none"
              style={[styles.slotSoil, styles.slotHover]}
            />
          ) : null}
          <ThemedText
            type="small"
            style={[styles.slotIndex, { color: bed.label }]}
          >
            {index}
          </ThemedText>
        </>
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
      }}
    >
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
  needsWater = false,
  placed,
  selected,
  dragging,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  plant: InventoryPlant;
  needsWater?: boolean;
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
        .onStart((event) =>
          onDragStart(plant.id, event.absoluteX, event.absoluteY),
        )
        .onUpdate((event) => onDragMove(event.absoluteX, event.absoluteY))
        .onEnd((event) =>
          onDragEnd(event.absoluteX, event.absoluteY, plant.id),
        ),
    [plant.id, onDragStart, onDragMove, onDragEnd],
  );

  return (
    <GestureDetector gesture={gesture}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={plantDisplayName(plant.info)}
        onPress={onPress}
        style={({ pressed }) => [
          pressed && styles.pressed,
          dragging && styles.draggingSource,
        ]}
      >
        <PlantToken
          plant={plant}
          compact
          placed={placed}
          selected={selected}
          needsWater={needsWater}
        />
      </Pressable>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  screen: {
    flex: 1,
    width: "100%",
    alignItems: "center",
  },
  content: {
    flex: 1,
    flexDirection: "column",
    width: "100%",
    maxWidth: "100%",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  header: {
    alignSelf: "flex-start",
    gap: Spacing.half,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radius.sm,
    backgroundColor: GardenPalette.panel,
    borderWidth: 1,
    borderColor: GardenPalette.panelBorder,
  },
  boardArea: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radius.sm,
    backgroundColor: GardenPalette.panel,
    overflow: "hidden",
  },
  boardCenter: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  frameOuter: {
    alignSelf: "center",
    padding: 0,
    borderWidth: 1,
    borderRadius: 12,
  },
  frameInner: {
    borderWidth: 1,
    borderRadius: 9,
  },
  soilBed: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 7,
  },
  board: {
    gap: GARDEN_SLOT_GAP,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    gap: GARDEN_SLOT_GAP,
  },
  slotWrap: {
    flex: 1,
    aspectRatio: 1,
  },
  slot: {
    flex: 1,
    width: "100%",
    height: "100%",
    borderWidth: 1,
    borderRadius: Radius.sm,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  slotFilled: {
    alignItems: "stretch",
    justifyContent: "flex-start",
  },
  slotSoil: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  slotHover: {
    backgroundColor: GardenPalette.plotHover,
    opacity: 0.55,
  },
  slotIndex: {
    fontVariant: ["tabular-nums"],
  },
  trayCollapsed: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    justifyContent: "center",
  },
  trayToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 36,
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
    position: "absolute",
    zIndex: 20,
  },
  fill: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  pressed: {
    opacity: 0.75,
  },
});
