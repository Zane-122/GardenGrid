import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { GardenGrass } from "@/components/app/grass-background";
import { GardenLight } from "@/components/grid/garden-light";
import { GARDEN_SHAPE_BORDER, GardenBed } from "@/components/grid/garden-shape-border";
import { PlantToken } from "@/components/grid/plant-token";
import { ThemedText } from "@/components/themed-text";
import { GardenPalette, Radius, Spacing } from "@/constants/theme";
import { useGardenLightIndex } from "@/hooks/use-garden-light-index";
import { listFriendGarden } from "@/utils/friend-garden";
import {
  GARDEN_SLOT_GAP,
  gardenBoardSize,
  gardenViewBounds,
  tileKey,
  type GardenSlot,
  type GardenTile,
} from "@/utils/garden";
import { plantImageUrl, type InventoryPlant } from "@/utils/plants";
import { isLightSource, isStandingItem, itemCells, itemSpan, shopItemImageUrl, type OwnedShopItem } from "@/utils/shop-items";

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.75;

type FriendGardenModalProps = {
  friend: { id: string; displayName: string } | null;
  onClose: () => void;
};

export function FriendGardenModal({ friend, onClose }: FriendGardenModalProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [tiles, setTiles] = useState<GardenTile[]>([]);
  const [slots, setSlots] = useState<GardenSlot[]>([]);
  const [plants, setPlants] = useState<InventoryPlant[]>([]);
  const [items, setItems] = useState<OwnedShopItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const lightIndex = useGardenLightIndex();
  const scaleSv = useSharedValue(1);
  const txSv = useSharedValue(0);
  const tySv = useSharedValue(0);
  const cursorX = useSharedValue(-1000);
  const cursorY = useSharedValue(-1000);
  const cursorOn = useSharedValue(0);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const viewportRef = useRef<View>(null);

  useEffect(() => {
    if (!friend) {
      return;
    }
    let cancelled = false;
    setError(null);
    setTiles([]);
    setSlots([]);
    setPlants([]);
    setItems([]);
    void listFriendGarden(friend.id)
      .then((garden) => {
        if (cancelled) {
          return;
        }
        setTiles(garden.tiles);
        setSlots(garden.slots);
        setPlants(garden.plants);
        setItems(garden.items);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not open that garden.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [friend]);

  const bounds = useMemo(() => gardenViewBounds(tiles), [tiles]);
  const viewColumns = Math.max(1, bounds.maxCol - bounds.minCol + 1);
  const viewRows = Math.max(1, bounds.maxRow - bounds.minRow + 1);
  const boardSize = useMemo(() => {
    const innerWidth = Math.max(0, (mapSize.width || windowWidth) - GARDEN_SHAPE_BORDER * 2);
    const innerHeight = Math.max(0, (mapSize.height || windowHeight) - GARDEN_SHAPE_BORDER * 2);
    return gardenBoardSize(innerWidth, innerHeight, viewColumns, viewRows);
  }, [mapSize.height, mapSize.width, viewColumns, viewRows, windowHeight, windowWidth]);

  const plantsById = useMemo(() => new Map(plants.map((plant) => [plant.id, plant])), [plants]);
  const slotByKey = useMemo(() => {
    const map = new Map<string, GardenSlot>();
    for (const slot of slots) {
      map.set(tileKey(slot.col, slot.row), slot);
    }
    return map;
  }, [slots]);
  const itemByTile = useMemo(() => {
    const map = new Map<string, OwnedShopItem>();
    for (const item of items) {
      if (item.col == null || item.row == null) {
        continue;
      }
      for (const cell of itemCells(item.col, item.row, item)) {
        const tile = tiles.find((plot) => plot.col === cell.col && plot.row === cell.row);
        if (tile) {
          map.set(tile.id, item);
        }
      }
    }
    return map;
  }, [items, tiles]);
  const placedLights = useMemo(
    () =>
      items.flatMap((item) =>
        isLightSource(item.slug) && item.col != null && item.row != null
          ? [{ id: item.id, col: item.col, row: item.row }]
          : [],
      ),
    [items],
  );

  const grassPad = Math.ceil(Math.max(windowWidth, windowHeight, 1) / MIN_ZOOM);
  const grassW = boardSize.width + GARDEN_SHAPE_BORDER * 2 + grassPad * 2;
  const grassH = boardSize.height + GARDEN_SHAPE_BORDER * 2 + grassPad * 2;

  useEffect(() => {
    const urls = [
      ...plants.map((plant) => plantImageUrl(plant)),
      ...items.map((item) => {
        const image = shopItemImageUrl(item.image_path);
        return typeof image === "object" && image ? image.uri : null;
      }),
    ].filter((url): url is string => Boolean(url));
    if (urls.length > 0) {
      void Image.prefetch(urls, "memory-disk");
    }
  }, [items, plants]);
  const cameraStyle = useAnimatedStyle(() => ({
    transformOrigin: "left top",
    transform: [{ translateX: txSv.value }, { translateY: tySv.value }, { scale: scaleSv.value }],
  }));
  const grassStyle = useAnimatedStyle(() => {
    const scale = scaleSv.value;
    return {
      transformOrigin: "left top",
      transform: [
        { translateX: txSv.value + grassPad * (1 - scale) },
        { translateY: tySv.value + grassPad * (1 - scale) },
        { scale },
      ],
    };
  });

  function applyCamera(scale: number, x: number, y: number) {
    const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
    scaleRef.current = nextScale;
    translateRef.current = { x, y };
    scaleSv.value = nextScale;
    txSv.value = x;
    tySv.value = y;
  }

  useEffect(() => {
    if (mapSize.width <= 0 || boardSize.width <= 0) {
      return;
    }
    const pad = GARDEN_SHAPE_BORDER * 2;
    applyCamera(
      1,
      (mapSize.width - boardSize.width - pad) / 2,
      (mapSize.height - boardSize.height - pad) / 2,
    );
  }, [boardSize.height, boardSize.width, friend?.id, mapSize.height, mapSize.width]);

  useEffect(() => {
    const node = viewportRef.current as unknown as HTMLElement | null;
    if (!friend || !node || typeof node.addEventListener !== "function") {
      return;
    }
    node.style.touchAction = "none";
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      const rect = node.getBoundingClientRect();
      const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scaleRef.current * factor));
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const boardX = (px - translateRef.current.x) / scaleRef.current;
      const boardY = (py - translateRef.current.y) / scaleRef.current;
      applyCamera(nextScale, px - boardX * nextScale, py - boardY * nextScale);
    };
    let panning = false;
    let originX = 0;
    let originY = 0;
    let originTx = 0;
    let originTy = 0;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      panning = true;
      originX = event.clientX;
      originY = event.clientY;
      originTx = translateRef.current.x;
      originTy = translateRef.current.y;
    };
    const onCursor = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      cursorOn.value = inside ? 1 : 0;
      if (inside) {
        cursorX.value = x;
        cursorY.value = y;
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!panning) {
        return;
      }
      applyCamera(scaleRef.current, originTx + event.clientX - originX, originTy + event.clientY - originY);
    };
    const onPointerUp = () => {
      panning = false;
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onCursor);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onCursor);
      cursorOn.value = 0;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [friend]);

  return (
    <Modal visible={friend != null} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <ThemedText type="heading" style={styles.title}>
              {friend ? `${friend.displayName}'s garden` : "Garden"}
            </ThemedText>
            <ThemedText type="small" style={styles.subtitle}>
              Look around. You can't change this garden.
            </ThemedText>
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <ThemedText type="smallBold" style={styles.closeText}>
              Close
            </ThemedText>
          </Pressable>
        </View>
        {error ? (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}
        <View
          ref={viewportRef}
          style={styles.viewport}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setMapSize({ width, height });
          }}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              styles.grassPlane,
              { left: -grassPad, top: -grassPad, width: grassW, height: grassH },
              grassStyle,
            ]}
          >
            <GardenGrass width={grassW} height={grassH} />
          </Animated.View>
          <Animated.View style={[styles.camera, cameraStyle]}>
            <View style={{ padding: GARDEN_SHAPE_BORDER }}>
              <View style={{ width: boardSize.width, height: boardSize.height, position: "relative" }}>
                <GardenBed
                  tiles={tiles}
                  minCol={bounds.minCol}
                  minRow={bounds.minRow}
                  columns={viewColumns}
                  rows={viewRows}
                />
                {Array.from({ length: viewRows }, (_, rowOffset) => {
                  const row = bounds.minRow + rowOffset;
                  return (
                    <View key={row} style={styles.row}>
                      {Array.from({ length: viewColumns }, (_, columnOffset) => {
                        const col = bounds.minCol + columnOffset;
                        const plot = tiles.find((tile) => tile.col === col && tile.row === row);
                        if (!plot) {
                          return <View key={tileKey(col, row)} style={styles.slotWrap} />;
                        }
                        const slot = slotByKey.get(tileKey(col, row));
                        const plant = slot ? plantsById.get(slot.plant_id) : undefined;
                        const laid = itemByTile.get(plot.id);
                        const span = laid ? itemSpan(laid) : null;
                        const single = span != null && span.cols === 1 && span.rows === 1;
                        const lamp = laid?.slug === "light";
                        const standing = Boolean(laid && isStandingItem(laid.slug));
                        const stone = Boolean(laid && (standing || (span && (span.cols > 1 || span.rows > 1))));
                        const imageUrl = laid && single ? shopItemImageUrl(laid.image_path) : null;
                        return (
                          <View key={plot.id} style={styles.slotWrap}>
                            <View style={styles.slot}>
                              {stone ? (
                                <Image
                                  source={require("@/assets/images/decoritems/bench-ground.png")}
                                  style={styles.fillImage}
                                  contentFit="cover"
                                  priority="high"
                                  cachePolicy="memory-disk"
                                  loading="eager"
                                />
                              ) : null}
                              {imageUrl ? (
                                <Image
                                  source={imageUrl}
                                  style={lamp ? styles.lamp : standing ? styles.decor : styles.fillImage}
                                  contentFit={standing ? "contain" : "cover"}
                                  priority="high"
                                  cachePolicy="memory-disk"
                                  loading="eager"
                                />
                              ) : null}
                              {plant ? (
                                <PlantToken plant={plant} labelVisible={false} />
                              ) : stone || imageUrl ? null : (
                                <Image
                                  source={require("@/assets/images/decoritems/soil_tile.png")}
                                  style={styles.fillImage}
                                  contentFit="cover"
                                  priority="high"
                                  cachePolicy="memory-disk"
                                  loading="eager"
                                />
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
                {items.map((item) => {
                  if (item.col == null || item.row == null) {
                    return null;
                  }
                  const span = itemSpan(item);
                  if (span.cols === 1 && span.rows === 1) {
                    return null;
                  }
                  const imageUrl = shopItemImageUrl(item.image_path);
                  const cell = boardSize.cell;
                  const left = (item.col - bounds.minCol) * (cell + GARDEN_SLOT_GAP);
                  const top = (item.row - bounds.minRow) * (cell + GARDEN_SLOT_GAP);
                  const width = span.cols * cell + (span.cols - 1) * GARDEN_SLOT_GAP;
                  const height = span.rows * cell + (span.rows - 1) * GARDEN_SLOT_GAP;
                  const turned = item.rotation === 90 || item.rotation === 270;
                  return (
                    <View key={item.id} pointerEvents="none" style={[styles.piece, { left, top, width, height }]}>
                      {imageUrl ? (
                        <Image
                          source={imageUrl}
                          contentFit="contain"
                          priority="high"
                          cachePolicy="memory-disk"
                          loading="eager"
                          style={{
                            position: "absolute",
                            width: turned ? height : width,
                            height: turned ? width : height,
                            left: turned ? (width - height) / 2 : 0,
                            top: turned ? (height - width) / 2 : 0,
                            transform: [{ rotate: `${item.rotation}deg` }],
                          }}
                        />
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          </Animated.View>
          <GardenLight
            index={lightIndex}
            lights={placedLights}
            cell={boardSize.cell}
            minCol={bounds.minCol}
            minRow={bounds.minRow}
            inset={GARDEN_SHAPE_BORDER}
            scaleSv={scaleSv}
            txSv={txSv}
            tySv={tySv}
            cursorX={cursorX}
            cursorY={cursorY}
            cursorOn={cursorOn}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: GardenPalette.grass,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    backgroundColor: GardenPalette.panel,
  },
  titleBlock: {
    flex: 1,
    gap: Spacing.half,
  },
  title: {
    color: GardenPalette.panelText,
  },
  subtitle: {
    color: GardenPalette.panelTextSecondary,
  },
  close: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: GardenPalette.bar,
  },
  closeText: {
    color: GardenPalette.barText,
  },
  error: {
    color: GardenPalette.panelDanger,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  viewport: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: GardenPalette.grass,
  },
  grassPlane: {
    position: "absolute",
    overflow: "visible",
    backgroundColor: GardenPalette.grass,
  },
  camera: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 1,
    transformOrigin: "left top",
  },
  row: {
    flexDirection: "row",
    gap: GARDEN_SLOT_GAP,
  },
  slotWrap: {
    flex: 1,
    aspectRatio: 1,
  },
  slot: {
    flex: 1,
    borderRadius: Radius.sm,
    overflow: "hidden",
    backgroundColor: GardenPalette.plot,
  },
  fillImage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  lamp: {
    position: "absolute",
    width: "54%",
    height: "54%",
    left: "23%",
    top: "23%",
    zIndex: 1,
  },
  decor: {
    position: "absolute",
    width: "72%",
    height: "72%",
    left: "14%",
    top: "14%",
    zIndex: 1,
  },
  piece: {
    position: "absolute",
    zIndex: 2,
  },
});
