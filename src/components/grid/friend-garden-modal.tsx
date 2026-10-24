import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View, type ViewProps } from "react-native";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

import { GardenGrass } from "@/components/app/grass-background";
import { GardenLoadingVeil, useGardenLoadGate } from "@/components/grid/garden-loading-veil";
import { GARDEN_SHAPE_BORDER, GardenBed } from "@/components/grid/garden-shape-border";
import { PlantToken } from "@/components/grid/plant-token";
import { ThemedText } from "@/components/themed-text";
import { GardenPalette, Radius, Spacing } from "@/constants/theme";
import { glowKindFor, ItemGlow, type GlowKind } from "@/components/grid/item-glow";
import { useGardenCamera } from "@/hooks/use-garden-camera";
import { listFriendGarden } from "@/utils/friend-garden";
import {
  GARDEN_SLOT_GAP,
  gardenBoardSize,
  gardenViewBounds,
  tileKey,
  type GardenSlot,
  type GardenTile,
} from "@/utils/garden";
import { plantDisplayName, plantImageUrl, type InventoryPlant } from "@/utils/plants";
import {
  isStandingItem,
  itemCells,
  itemSpan,
  shopItemImageUrl,
  type OwnedShopItem,
  type ShopItemImage,
} from "@/utils/shop-items";

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
  const [dataReady, setDataReady] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!friend) {
      setDataReady(false);
      return;
    }
    let cancelled = false;
    setError(null);
    setDataReady(false);
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
        setDataReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not open that garden.");
          setDataReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [friend]);

  const imageUrls = useMemo(
    () => [
      ...plants.map((plant) => plantImageUrl(plant)),
      ...items.map((item) => {
        const image = shopItemImageUrl(item.image_path);
        return typeof image === "object" && image ? image.uri : null;
      }),
    ],
    [items, plants],
  );
  const showVeil = useGardenLoadGate(Boolean(friend) && dataReady, imageUrls);

  const bounds = useMemo(() => gardenViewBounds(tiles), [tiles]);
  const viewColumns = Math.max(1, bounds.maxCol - bounds.minCol + 1);
  const viewRows = Math.max(1, bounds.maxRow - bounds.minRow + 1);
  const board = useMemo(() => {
    const chrome = GARDEN_SHAPE_BORDER * 2;
    return gardenBoardSize(
      Math.max(0, (viewport.width || windowWidth) - chrome),
      Math.max(0, (viewport.height || windowHeight) - chrome),
      viewColumns,
      viewRows,
    );
  }, [viewColumns, viewRows, viewport.height, viewport.width, windowHeight, windowWidth]);

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
    const tileByKey = new Map(tiles.map((tile) => [tileKey(tile.col, tile.row), tile]));
    for (const item of items) {
      if (item.col == null || item.row == null) {
        continue;
      }
      for (const cell of itemCells(item.col, item.row, item)) {
        const plot = tileByKey.get(tileKey(cell.col, cell.row));
        if (plot) {
          map.set(plot.id, item);
        }
      }
    }
    return map;
  }, [items, tiles]);

  const camera = useGardenCamera({
    board,
    border: GARDEN_SHAPE_BORDER,
    bounds,
    tiles,
    hitsMovable: () => false,
    isDragging: () => false,
    onViewportLayout: setViewport,
    bindKey: friend?.id ?? null,
    handlerGestures: true,
  });
  const grassW = board.width + GARDEN_SHAPE_BORDER * 2 + camera.grassPad * 2;
  const grassH = board.height + GARDEN_SHAPE_BORDER * 2 + camera.grassPad * 2;

  const Viewport = (
        <View ref={camera.viewportRef} style={styles.viewport} {...camera.viewportProps}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.grassPlane,
              { left: -camera.grassPad, top: -camera.grassPad, width: grassW, height: grassH },
              camera.grassStyle,
            ]}
          >
            <GardenGrass width={grassW} height={grassH} />
          </Animated.View>
          <View
            pointerEvents="box-none"
            style={[styles.cameraHost, showVeil ? styles.hiddenGarden : null]}
          >
            <Animated.View style={[styles.camera, camera.cameraStyle]}>
              <View style={styles.frameOuter}>
                <View style={{ padding: GARDEN_SHAPE_BORDER }}>
                  <View style={[styles.board, { width: board.width, height: board.height }]}>
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
                            return (
                              <FriendPlot
                                key={plot.id}
                                plant={plant}
                                pathUrl={laid && single ? shopItemImageUrl(laid.image_path) : null}
                                imageFit={laid && isStandingItem(laid.slug) ? "contain" : "cover"}
                                lampArt={laid?.slug === "light"}
                                glow={glowKindFor(laid?.slug)}
                                stoneGround={Boolean(
                                  laid &&
                                    (isStandingItem(laid.slug) ||
                                      (span && (span.cols > 1 || span.rows > 1))),
                                )}
                              />
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
                        if (item.slug !== "light") {
                          return null;
                        }
                        const imageUrl = shopItemImageUrl(item.image_path);
                        if (!imageUrl) {
                          return null;
                        }
                        const cell = board.cell;
                        const left = (item.col - bounds.minCol) * (cell + GARDEN_SLOT_GAP);
                        const top = (item.row - bounds.minRow) * (cell + GARDEN_SLOT_GAP);
                        return (
                          <View
                            key={item.id}
                            pointerEvents="none"
                            style={[styles.streetLamp, { left, top, width: cell, height: cell }]}
                          >
                            <View style={styles.streetLampBox}>
                              <Image
                                source={imageUrl}
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
                      const imageUrl = shopItemImageUrl(item.image_path);
                      const cell = board.cell;
                      const left = (item.col - bounds.minCol) * (cell + GARDEN_SLOT_GAP);
                      const top = (item.row - bounds.minRow) * (cell + GARDEN_SLOT_GAP);
                      const width = span.cols * cell + (span.cols - 1) * GARDEN_SLOT_GAP;
                      const height = span.rows * cell + (span.rows - 1) * GARDEN_SLOT_GAP;
                      const turned = item.rotation === 90 || item.rotation === 270;
                      return (
                        <View
                          key={item.id}
                          pointerEvents="none"
                          style={[styles.piece, { left, top, width, height }]}
                        >
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
              </View>
            </Animated.View>
          </View>
          <GardenLoadingVeil visible={showVeil} columns={viewColumns} rows={viewRows} />
        </View>
  );

  return (
    <Modal visible={friend != null} animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.screen}>
        {camera.gesture ? <GestureDetector gesture={camera.gesture}>{Viewport}</GestureDetector> : Viewport}
        <View pointerEvents="box-none" style={styles.header}>
          <View style={styles.titleBlock}>
            <ThemedText type="heading" style={styles.title}>
              {friend ? `${friend.displayName}'s garden` : "Garden"}
            </ThemedText>
            <ThemedText type="small" style={styles.subtitle}>
              Look around. You can't change this garden.
            </ThemedText>
            {error ? (
              <ThemedText type="small" style={styles.error}>
                {error}
              </ThemedText>
            ) : null}
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <ThemedText type="smallBold" style={styles.closeText}>
              Close
            </ThemedText>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function FriendPlot({
  plant,
  pathUrl,
  imageFit,
  lampArt,
  glow,
  stoneGround,
}: {
  plant?: InventoryPlant;
  pathUrl: ShopItemImage | null;
  imageFit: "cover" | "contain";
  lampArt: boolean;
  glow: GlowKind | null;
  stoneGround: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  // Views only — Pressables would steal the pan gesture on phone and web.
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        plant
          ? plantDisplayName(plant.info)
          : stoneGround
            ? "Garden decoration"
            : pathUrl
              ? "Placed tile"
              : "Empty plot"
      }
      pointerEvents={Platform.OS === "web" ? "auto" : "none"}
      style={styles.slotWrap}
      {...(Platform.OS === "web"
        ? ({
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
          } as ViewProps)
        : null)}
    >
      <View
        pointerEvents="none"
        style={[styles.slot, plant ? styles.slotFilled : null, { backgroundColor: GardenPalette.plot }]}
      >
        {stoneGround ? (
          <Image
            source={require("@/assets/images/decoritems/bench-ground.png")}
            style={styles.slotSoil}
            contentFit="cover"
            priority="high"
            cachePolicy="memory-disk"
            loading="eager"
            pointerEvents="none"
          />
        ) : null}
        {pathUrl && !plant && !lampArt ? (
          <Image
            source={pathUrl}
            style={imageFit === "contain" ? styles.slotDecor : styles.slotSoil}
            contentFit={imageFit}
            priority="high"
            cachePolicy="memory-disk"
            loading="eager"
            pointerEvents="none"
          />
        ) : null}
        {plant ? (
          <PlantToken plant={plant} labelVisible={Platform.OS === "web" && hovered} />
        ) : stoneGround || pathUrl ? null : (
          <Image
            source={require("@/assets/images/decoritems/soil_tile.png")}
            style={styles.slotSoil}
            contentFit="cover"
            priority="high"
            cachePolicy="memory-disk"
            loading="eager"
            pointerEvents="none"
          />
        )}
      </View>
      {glow === "fire" && !plant ? <ItemGlow kind="fire" anchor="middle" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: GardenPalette.grass,
  },
  header: {
    position: "absolute",
    top: Spacing.three,
    left: Spacing.three,
    right: Spacing.three,
    zIndex: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
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
  },
  viewport: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: GardenPalette.grass,
  },
  grassPlane: {
    position: "absolute",
    zIndex: 0,
    overflow: "visible",
    backgroundColor: GardenPalette.grass,
  },
  cameraHost: {
    position: "absolute",
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
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 1,
    overflow: "visible",
    transformOrigin: "left top",
  },
  frameOuter: {
    zIndex: 1,
    alignSelf: "center",
    padding: 0,
  },
  board: {
    position: "relative",
    gap: GARDEN_SLOT_GAP,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    gap: GARDEN_SLOT_GAP,
  },
  slotWrap: {
    position: "relative",
    flex: 1,
    aspectRatio: 1,
  },
  slot: {
    position: "relative",
    flex: 1,
    width: "100%",
    height: "100%",
    borderRadius: Platform.OS === "web" ? Radius.sm : 5,
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
  slotDecor: {
    position: "absolute",
    width: "72%",
    height: "72%",
    left: "14%",
    top: "14%",
    zIndex: 1,
  },
  streetLamp: {
    position: "absolute",
    zIndex: 3,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  lampGlowBox: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "200%",
  },
  streetLampBox: {
    height: "200%",
    aspectRatio: 49 / 332,
  },
  streetLampImage: {
    width: "100%",
    height: "100%",
  },
  piece: {
    position: "absolute",
    zIndex: 2,
  },
});
