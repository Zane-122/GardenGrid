import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, runOnJS } from "react-native-reanimated";

import { GardenGrass } from "@/components/app/grass-background";
import { GARDEN_SHAPE_BORDER, GardenBed } from "@/components/grid/garden-shape-border";
import { KitStack, OwnedTileFace } from "@/components/grid/kit-tile";
import { PlantToken } from "@/components/grid/plant-token";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  GardenPalette,
  Radius,
  Spacing,
} from "@/constants/theme";
import { useAuth } from "@/context/auth";
import { useTweenedNumber } from "@/hooks/use-tweened-number";
import {
  assignPlantToSlot,
  clearGardenSlot,
  GARDEN_SLOT_GAP,
  gardenBoardSize,
  gardenViewBounds,
  listGardenSlots,
  listGardenTiles,
  slotForPlant,
  tileKey,
  type GardenSlot,
  type GardenTile,
} from "@/utils/garden";
import {
  listUserPlants,
  plantDisplayName,
  plantImageUrl,
  type InventoryPlant,
} from "@/utils/plants";
import {
  clearOwnedShopItem,
  itemCells,
  itemCovers,
  itemSpan,
  listOwnedShopItems,
  placeOwnedShopItem,
  rotateOwnedShopItem,
  isStandingItem,
  shopItemImageUrl,
  type ShopItemImage,
  type OwnedShopItem,
} from "@/utils/shop-items";
import { listLatestWateringDates, plantWateringSchedule } from "@/utils/watering";

const SIDE_CLOSED = 56;
const SIDE_OPEN = 252;
const KIT_BOTTOM_BREAKPOINT = 720;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.75;
/** On-screen plot size the phone opens at, so a wide garden is not a field of tiny tiles. */
const PHONE_CELL = 70;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

type Frame = { x: number; y: number; width: number; height: number };
type DragState = { kind: "plant" | "item"; id: string; x: number; y: number };

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
  col: number,
  row: number,
  tileId: string,
  userId: string,
) {
  const from = slots.find((slot) => slot.plant_id === plantId);
  const to = slots.find((slot) => slot.col === col && slot.row === row);
  if (from?.col === col && from.row === row) {
    return slots;
  }

  const others = slots.filter(
    (slot) => slot.plant_id !== plantId && !(slot.col === col && slot.row === row),
  );

  if (from && to) {
    return [
      ...others,
      { ...from, col, row, tile_id: tileId },
      { ...to, col: from.col, row: from.row, tile_id: from.tile_id },
    ];
  }
  if (from) {
    return [...others, { ...from, col, row, tile_id: tileId }];
  }

  return [
    ...others,
    {
      id: to?.id ?? `local-${plantId}`,
      user_id: userId,
      plant_id: plantId,
      tile_id: tileId,
      col,
      row,
      created_at: to?.created_at ?? new Date().toISOString(),
    },
  ];
}

export default function GridScreen() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
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
  const [tiles, setTiles] = useState<GardenTile[]>([]);
  const [slots, setSlots] = useState<GardenSlot[]>([]);
  const [ownedItems, setOwnedItems] = useState<OwnedShopItem[]>([]);
  const [, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [selectedShopItemId, setSelectedShopItemId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [aimKey, setAimKey] = useState<string | null>(null);
  const [hoverSlot, setHoverSlot] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [boardAreaWidth, setBoardAreaWidth] = useState(0);
  const [mapHeight, setMapHeight] = useState(0);
  const [sideOpen, setSideOpen] = useState(false);
  const kitFromBottom = windowWidth < KIT_BOTTOM_BREAKPOINT;
  const sheetOpen = Math.round(Math.min(280, Math.max(210, windowHeight * 0.34)));
  const kitExtent = useTweenedNumber(sideOpen ? SIDE_OPEN : SIDE_CLOSED);
  const kitHeight = useSharedValue(SIDE_CLOSED);
  const sheetLimit = useSharedValue(sheetOpen);
  const sheetDragOrigin = useSharedValue(SIDE_CLOSED);
  const scaleSv = useSharedValue(1);
  const txSv = useSharedValue(0);
  const tySv = useSharedValue(0);
  const cameraStyle = useAnimatedStyle(() => ({
    transformOrigin: "left top",
    transform: [
      { translateX: txSv.value },
      { translateY: tySv.value },
      { scale: scaleSv.value },
    ],
  }));
  const grassPad = Math.ceil(Math.max(windowWidth, windowHeight, 1) / MIN_ZOOM);
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
  const kitSheetStyle = useAnimatedStyle(() => ({
    height: kitHeight.value,
  }));

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

  const slotFrames = useRef<Partial<Record<string, Frame>>>({});
  const slotViews = useRef<Partial<Record<string, View | null>>>({});
  const boardRef = useRef<View>(null);
  const boardCellRef = useRef(0);
  const boundsRef = useRef({ minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 });
  const tilesRef = useRef(tiles);
  const itemsRef = useRef(ownedItems);
  const viewportRef = useRef<View>(null);
  const viewportWindow = useRef<Frame | null>(null);
  const viewportSize = useRef({ width: 0, height: 0 });
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const userMovedCamera = useRef(false);
  const panTouch = useRef({ x: 0, y: 0, onItem: false });
  const panOrigin = useRef({ x: 0, y: 0 });
  const pinchStart = useRef({ scale: 1, x: 0, y: 0, fx: 0, fy: 0, distance: 1 });
  const pinching = useRef(false);
  const stopTracking = useRef<(() => void) | null>(null);
  const trayFrame = useRef<Frame | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const trayRef = useRef<View>(null);
  const screenRef = useRef<View>(null);
  const screenOrigin = useRef({ x: 0, y: 0 });
  const slotsRef = useRef(slots);
  const placeQueue = useRef(Promise.resolve());
  slotsRef.current = slots;

  function remasureDropTargets() {
    for (const [index, view] of Object.entries(slotViews.current)) {
      if (view) {
        measureView(view, (frame) => {
          slotFrames.current[index] = frame;
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
    if (viewportRef.current) {
      measureView(viewportRef.current, (frame) => {
        viewportWindow.current = frame;
        publishBoardFrames();
      });
    }
  }

  const plantsById = useMemo(
    () => new Map(plants.map((plant) => [plant.id, plant])),
    [plants],
  );
  const slotMap = useMemo(
    () => new Map(slots.map((slot) => [tileKey(slot.col, slot.row), slot])),
    [slots],
  );
  const itemByTile = useMemo(() => {
    const map = new Map<string, OwnedShopItem>();
    const tileByKey = new Map(tiles.map((tile) => [tileKey(tile.col, tile.row), tile]));
    for (const item of ownedItems) {
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
  }, [ownedItems, tiles]);
  const bounds = useMemo(() => gardenViewBounds(tiles), [tiles]);
  const viewColumns = bounds.maxCol - bounds.minCol + 1;
  const viewRows = bounds.maxRow - bounds.minRow + 1;
  boundsRef.current = bounds;
  tilesRef.current = tiles;
  itemsRef.current = ownedItems;

  const boardAreaHeight = mapHeight > 0 ? mapHeight : windowHeight;

  const boardSize = useMemo(() => {
    const chrome = (framePad + bedPad + GARDEN_SHAPE_BORDER) * 2;
    const areaWidth = boardAreaWidth || windowWidth;
    const innerWidth = Math.max(0, areaWidth - chrome);
    const maxInnerHeight = Math.max(0, boardAreaHeight - chrome);

    return gardenBoardSize(innerWidth, maxInnerHeight, viewColumns, viewRows);
  }, [bedPad, boardAreaHeight, boardAreaWidth, framePad, viewColumns, viewRows, windowWidth]);
  boardCellRef.current = boardSize.cell;
  const grassFrame = (framePad + bedPad + GARDEN_SHAPE_BORDER) * 2;
  const grassW = boardSize.width + grassFrame + grassPad * 2;
  const grassH = boardSize.height + grassFrame + grassPad * 2;

  useEffect(() => {
    const urls = [
      ...plants.map((plant) => plantImageUrl(plant)),
      ...ownedItems.map((item) => {
        const image = shopItemImageUrl(item.image_path);
        return typeof image === "object" && image ? image.uri : null;
      }),
    ].filter((url): url is string => Boolean(url));
    if (urls.length > 0) {
      void Image.prefetch(urls, "memory-disk");
    }
  }, [ownedItems, plants]);

  function applyCamera(nextScale: number, nextX: number, nextY: number) {
    const viewport = viewportSize.current;
    const pad = (framePad + bedPad + GARDEN_SHAPE_BORDER) * 2;
    const boardW = ((boardCellRef.current > 0 ? boardSize.width : 0) + pad) * nextScale;
    const boardH = ((boardCellRef.current > 0 ? boardSize.height : 0) + pad) * nextScale;
    let x = nextX;
    let y = nextY;
    if (viewport.width > 0 && viewport.height > 0 && boardW > pad && boardH > pad) {
      const keep = 72;
      x = Math.min(viewport.width - keep, Math.max(keep - boardW, nextX));
      y = Math.min(viewport.height - keep, Math.max(keep - boardH, nextY));
    }
    scaleRef.current = nextScale;
    translateRef.current = { x, y };
    scaleSv.value = nextScale;
    txSv.value = x;
    tySv.value = y;
  }

  function publishBoardFrames() {
    const viewport = viewportWindow.current;
    if (!viewport) {
      return;
    }
    const cell = boardCellRef.current;
    const scale = scaleRef.current;
    const pad = (framePad + bedPad + GARDEN_SHAPE_BORDER) * scale;
    const originX = viewport.x + translateRef.current.x + pad;
    const originY = viewport.y + translateRef.current.y + pad;
    const stride = (cell + GARDEN_SLOT_GAP) * scale;
    const screenCell = cell * scale;
    const { minCol, minRow, maxCol, maxRow } = boundsRef.current;
    const columns = maxCol - minCol + 1;
    const rows = maxRow - minRow + 1;
    const next: Partial<Record<string, Frame>> = {};
    for (let rowOffset = 0; rowOffset < rows; rowOffset += 1) {
      for (let colOffset = 0; colOffset < columns; colOffset += 1) {
        const col = minCol + colOffset;
        const row = minRow + rowOffset;
        if (!tilesRef.current.some((tile) => tile.col === col && tile.row === row)) {
          continue;
        }
        next[tileKey(col, row)] = {
          x: originX + colOffset * stride,
          y: originY + rowOffset * stride,
          width: screenCell,
          height: screenCell,
        };
      }
    }
    slotFrames.current = next;
  }

  function pointHitsMovable(x: number, y: number) {
    for (const [key, frame] of Object.entries(slotFrames.current)) {
      if (!frame || !contains(frame, x, y)) {
        continue;
      }
      if (slotsRef.current.some((slot) => tileKey(slot.col, slot.row) === key)) {
        return true;
      }
      const [col, row] = key.split(":").map(Number);
      return itemsRef.current.some((item) => itemCovers(item, col, row));
    }
    return false;
  }

  function zoomAt(clientX: number, clientY: number, factor: number) {
    const viewport = viewportWindow.current;
    if (!viewport || scaleRef.current === 0) {
      return;
    }
    userMovedCamera.current = true;
    const scale = scaleRef.current;
    const nextScale = clampZoom(scale * factor);
    const px = clientX - viewport.x;
    const py = clientY - viewport.y;
    const boardX = (px - translateRef.current.x) / scale;
    const boardY = (py - translateRef.current.y) / scale;
    applyCamera(nextScale, px - boardX * nextScale, py - boardY * nextScale);
    publishBoardFrames();
  }

  const cameraApi = useRef({
    apply: applyCamera,
    publish: publishBoardFrames,
    hitsMovable: pointHitsMovable,
    zoomAt,
  });
  cameraApi.current = {
    apply: applyCamera,
    publish: publishBoardFrames,
    hitsMovable: pointHitsMovable,
    zoomAt,
  };

  const gardenPan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (event, gesture) => {
          if (dragRef.current) {
            return false;
          }
          if (event.nativeEvent.touches.length >= 2) {
            return true;
          }
          return gesture.dx * gesture.dx + gesture.dy * gesture.dy > 36;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (_event, gesture) => {
          userMovedCamera.current = true;
          pinching.current = false;
          panOrigin.current = {
            x: translateRef.current.x - gesture.dx,
            y: translateRef.current.y - gesture.dy,
          };
        },
        onPanResponderMove: (event, gesture) => {
          if (dragRef.current) {
            return;
          }
          const touches = event.nativeEvent.touches;
          const viewport = viewportWindow.current;
          if (touches.length >= 2 && viewport) {
            const [a, b] = touches;
            const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
            const fx = (a.pageX + b.pageX) / 2 - viewport.x;
            const fy = (a.pageY + b.pageY) / 2 - viewport.y;
            if (!pinching.current) {
              pinching.current = true;
              pinchStart.current = {
                scale: scaleRef.current,
                x: translateRef.current.x,
                y: translateRef.current.y,
                fx,
                fy,
                distance: Math.max(distance, 1),
              };
            }
            const start = pinchStart.current;
            const nextScale = clampZoom(start.scale * (distance / start.distance));
            const boardX = (start.fx - start.x) / start.scale;
            const boardY = (start.fy - start.y) / start.scale;
            cameraApi.current.apply(nextScale, fx - boardX * nextScale, fy - boardY * nextScale);
            return;
          }
          if (pinching.current) {
            pinching.current = false;
            panOrigin.current = {
              x: translateRef.current.x - gesture.dx,
              y: translateRef.current.y - gesture.dy,
            };
          }
          cameraApi.current.apply(
            scaleRef.current,
            panOrigin.current.x + gesture.dx,
            panOrigin.current.y + gesture.dy,
          );
        },
        onPanResponderRelease: () => {
          pinching.current = false;
          cameraApi.current.publish();
        },
        onPanResponderTerminate: () => {
          pinching.current = false;
          cameraApi.current.publish();
        },
      }),
    [],
  );

  useEffect(() => {
    const viewport = viewportSize.current;
    if (viewport.width <= 0 || viewport.height <= 0 || boardSize.width <= 0) {
      return;
    }
    const pad = (framePad + bedPad + GARDEN_SHAPE_BORDER) * 2;
    const tx = translateRef.current.x;
    const ty = translateRef.current.y;
    const shownScale = scaleRef.current || 1;
    const shownW = (boardSize.width + pad) * shownScale;
    const shownH = (boardSize.height + pad) * shownScale;
    const gardenOffScreen =
      tx > viewport.width - 8 ||
      ty > viewport.height - 8 ||
      tx + shownW < 8 ||
      ty + shownH < 8;
    if (userMovedCamera.current && !gardenOffScreen) {
      return;
    }
    const scale =
      Platform.OS === "web" || userMovedCamera.current
        ? scaleRef.current || 1
        : clampZoom(Math.max(1, PHONE_CELL / boardSize.cell));
    const visualW = (boardSize.width + pad) * scale;
    const visualH = (boardSize.height + pad) * scale;
    applyCamera(scale, (viewport.width - visualW) / 2, (viewport.height - visualH) / 2);
    publishBoardFrames();
  }, [boardSize.height, boardSize.width]);

  useEffect(() => {
    const node = viewportRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") {
      return;
    }
    node.style.touchAction = "none";
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      cameraApi.current.zoomAt(event.clientX, event.clientY, factor);
    };
    let panning = false;
    let originX = 0;
    let originY = 0;
    let originTx = 0;
    let originTy = 0;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || dragRef.current) {
        return;
      }
      if (cameraApi.current.hitsMovable(event.clientX, event.clientY)) {
        return;
      }
      panning = true;
      originX = event.clientX;
      originY = event.clientY;
      originTx = translateRef.current.x;
      originTy = translateRef.current.y;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!panning || dragRef.current) {
        return;
      }
      const dx = event.clientX - originX;
      const dy = event.clientY - originY;
      if (dx * dx + dy * dy < 16) {
        return;
      }
      userMovedCamera.current = true;
      cameraApi.current.apply(
        scaleRef.current,
        originTx + event.clientX - originX,
        originTy + event.clientY - originY,
      );
    };
    const onPointerUp = () => {
      if (!panning) {
        return;
      }
      panning = false;
      cameraApi.current.publish();
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [boardSize.width, boardSize.height]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [plantsResult, tilesResult, slotsResult, itemsResult] = await Promise.allSettled([
        listUserPlants(),
        listGardenTiles(),
        listGardenSlots(),
        listOwnedShopItems(),
      ]);
      if (plantsResult.status === "fulfilled") {
        setPlants(plantsResult.value);
      }
      if (tilesResult.status === "fulfilled") {
        setTiles(tilesResult.value);
      }
      if (slotsResult.status === "fulfilled") {
        setSlots(slotsResult.value);
      }
      if (itemsResult.status === "fulfilled") {
        setOwnedItems(itemsResult.value);
      }
      const failed = [plantsResult, tilesResult, slotsResult, itemsResult].find(
        (result) => result.status === "rejected",
      );
      if (failed?.status === "rejected") {
        throw failed.reason;
      }
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

  async function placePlant(plantId: string, col: number, row: number) {
    if (!user) {
      return;
    }

    const tile = tiles.find((item) => item.col === col && item.row === row);
    if (!tile) {
      return;
    }

    const previous = slotsRef.current;
    const previousItems = ownedItems;
    const from = previous.find((slot) => slot.plant_id === plantId);
    const targetHasPlant = previous.some(
      (slot) => slot.tile_id === tile.id && slot.plant_id !== plantId,
    );
    setSlots(optimisticAssign(previous, plantId, col, row, tile.id, user.id));
    setOwnedItems((current) =>
      current.map((item) => {
        if (!itemCovers(item, col, row)) {
          return item;
        }
        const span = itemSpan(item);
        if (span.cols * span.rows === 1 && from && from.tile_id !== tile.id && !targetHasPlant) {
          return { ...item, garden_tile_id: from.tile_id, col: from.col, row: from.row };
        }
        return { ...item, garden_tile_id: null, col: null, row: null };
      }),
    );
    setSelectedPlantId(null);
    setHoverSlot(null);
    try {
      await assignPlantToSlot(plantId, col, row);
      const [nextSlots, nextItems] = await Promise.all([
        listGardenSlots(),
        listOwnedShopItems(),
      ]);
      setSlots(nextSlots);
      setOwnedItems(nextItems);
    } catch (placeError) {
      setSlots(previous);
      setOwnedItems(previousItems);
      setError(
        placeError instanceof Error
          ? placeError.message
          : "Could not place that plant",
      );
    }
  }

  async function removeFromSlot(col: number, row: number) {
    const previous = slotsRef.current;
    const next = previous.filter((slot) => !(slot.col === col && slot.row === row));
    slotsRef.current = next;
    setSlots(next);
    setSelectedPlantId(null);
    try {
      await clearGardenSlot(col, row);
    } catch (removeError) {
      slotsRef.current = previous;
      setSlots(previous);
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Could not clear that slot",
      );
    }
  }

  async function placeOwnedItem(ownedId: string, col: number, row: number) {
    const previous = itemsRef.current;
    const previousSlots = slotsRef.current;
    const moving = previous.find((item) => item.id === ownedId);
    const anchor = tiles.find((item) => item.col === col && item.row === row);
    if (!moving || !anchor) {
      return;
    }

    const cells = itemCells(col, row, moving);
    if (!cells.every((cell) => tiles.some((tile) => tile.col === cell.col && tile.row === cell.row))) {
      setError("That does not fit on your garden");
      return;
    }

    const targetIds = new Set(
      cells.flatMap((cell) => {
        const plot = tiles.find((tile) => tile.col === cell.col && tile.row === cell.row);
        return plot ? [plot.id] : [];
      }),
    );
    const oldInside = moving.garden_tile_id != null && targetIds.has(moving.garden_tile_id);
    const plantsOnTarget = previousSlots.filter((slot) => targetIds.has(slot.tile_id));
    const others = previous.filter(
      (item) =>
        item.id !== ownedId &&
        item.col != null &&
        item.row != null &&
        itemCells(item.col, item.row, item).some((cell) => {
          const plot = tiles.find((tile) => tile.col === cell.col && tile.row === cell.row);
          return plot != null && targetIds.has(plot.id);
        }),
    );
    const otherIsSingle =
      others.length === 1 && itemSpan(others[0]).cols * itemSpan(others[0]).rows === 1;
    const canSwap =
      moving.garden_tile_id != null &&
      moving.col != null &&
      moving.row != null &&
      !oldInside &&
      ((plantsOnTarget.length === 1 && others.length === 0) ||
        (plantsOnTarget.length === 0 && otherIsSingle));

    const nextSlots =
      canSwap && plantsOnTarget.length === 1
        ? previousSlots.map((slot) =>
            slot.id === plantsOnTarget[0].id
              ? {
                  ...slot,
                  tile_id: moving.garden_tile_id!,
                  col: moving.col!,
                  row: moving.row!,
                }
              : slot,
          )
        : previousSlots.filter((slot) => !targetIds.has(slot.tile_id));
    const nextItems = previous.map((item) => {
      if (item.id === ownedId) {
        return { ...item, garden_tile_id: anchor.id, col, row };
      }
      if (canSwap && otherIsSingle && item.id === others[0].id) {
        return {
          ...item,
          garden_tile_id: moving.garden_tile_id,
          col: moving.col,
          row: moving.row,
        };
      }
      if (others.some((other) => other.id === item.id)) {
        return { ...item, garden_tile_id: null, col: null, row: null };
      }
      return item;
    });
    slotsRef.current = nextSlots;
    itemsRef.current = nextItems;
    setSlots(nextSlots);
    setOwnedItems(nextItems);

    try {
      await placeOwnedShopItem(ownedId, col, row);
      const [loadedSlots, loadedItems] = await Promise.all([
        listGardenSlots(),
        listOwnedShopItems(),
      ]);
      slotsRef.current = loadedSlots;
      itemsRef.current = loadedItems;
      setSlots(loadedSlots);
      setOwnedItems(loadedItems);
    } catch (placeError) {
      slotsRef.current = previousSlots;
      itemsRef.current = previous;
      setSlots(previousSlots);
      setOwnedItems(previous);
      setError(
        placeError instanceof Error ? placeError.message : "Could not lay that tile",
      );
    }
  }

  async function turnOwnedItem(ownedId: string) {
    const previous = ownedItems;
    setOwnedItems((current) =>
      current.map((item) =>
        item.id === ownedId
          ? { ...item, rotation: ((item.rotation + 90) % 360) as OwnedShopItem["rotation"] }
          : item,
      ),
    );
    try {
      await rotateOwnedShopItem(ownedId);
      setOwnedItems(await listOwnedShopItems());
    } catch (turnError) {
      setOwnedItems(previous);
      setError(
        turnError instanceof Error ? turnError.message : "Not enough room to turn that",
      );
    }
  }

  async function clearOwnedItem(ownedId: string) {
    const previous = itemsRef.current;
    const next = previous.map((item) =>
      item.id === ownedId ? { ...item, garden_tile_id: null, col: null, row: null } : item,
    );
    itemsRef.current = next;
    setOwnedItems(next);
    try {
      await clearOwnedShopItem(ownedId);
      const loaded = await listOwnedShopItems();
      itemsRef.current = loaded;
      setOwnedItems(loaded);
    } catch (clearError) {
      itemsRef.current = previous;
      setOwnedItems(previous);
      setError(
        clearError instanceof Error ? clearError.message : "Could not pick that tile back up",
      );
    }
  }

  function slotAtPoint(x: number, y: number) {
    for (const [key, frame] of Object.entries(slotFrames.current)) {
      if (frame && contains(frame, x, y)) {
        return key;
      }
    }
    return null;
  }

  function finishDrag(x: number, y: number, current: DragState) {
    const key = slotAtPoint(x, y);
    if (key != null) {
      const [col, row] = key.split(":").map(Number);
      if (current.kind === "plant") {
        void placePlant(current.id, col, row);
      } else {
        void placeOwnedItem(current.id, col, row);
      }
      return;
    }
    if (trayFrame.current && contains(trayFrame.current, x, y)) {
      if (current.kind === "plant") {
        const placed = slotForPlant(slotsRef.current, current.id);
        if (placed) {
          void removeFromSlot(placed.col, placed.row);
        }
      } else {
        const placed = ownedItems.find((item) => item.id === current.id);
        if (placed?.garden_tile_id) {
          void clearOwnedItem(current.id);
        }
      }
    }
  }

  const finishDragRef = useRef(finishDrag);
  finishDragRef.current = finishDrag;
  const moveDragRef = useRef<(x: number, y: number) => void>(() => {});
  const endDragRef = useRef<(x: number, y: number) => void>(() => {});

  const startDrag = useCallback((kind: DragState["kind"], id: string, x: number, y: number) => {
    remasureDropTargets();
    if (kind === "plant") {
      setSelectedPlantId(id);
    }
    const next = { kind, id, x, y };
    dragRef.current = next;
    setDrag(next);
    if (Platform.OS !== "web") {
      return;
    }
    stopTracking.current?.();
    const move = (event: PointerEvent) => moveDragRef.current(event.clientX, event.clientY);
    const up = (event: PointerEvent) => {
      stopTracking.current?.();
      stopTracking.current = null;
      endDragRef.current(event.clientX, event.clientY);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    stopTracking.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
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
    let nextHover: string | null = null;
    for (const [key, frame] of Object.entries(slotFrames.current)) {
      if (frame && contains(frame, x, y)) {
        nextHover = key;
        break;
      }
    }
    setHoverSlot(nextHover);
  }, []);

  const endDrag = useCallback((x: number, y: number) => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    setHoverSlot(null);
    if (current) {
      finishDragRef.current(x, y, current);
    }
  }, []);
  moveDragRef.current = moveDrag;
  endDragRef.current = endDrag;

  function stampTile(shopItemId: string, col: number, row: number) {
    const next = itemsRef.current.find(
      (item) => item.shop_item_id === shopItemId && item.garden_tile_id == null,
    );
    if (!next) {
      setError("No more of those tiles are left in your kit");
      return Promise.resolve();
    }
    setError(null);
    return placeOwnedItem(next.id, col, row);
  }

  function erasePlot(col: number, row: number) {
    const item = itemsRef.current.find((owned) => itemCovers(owned, col, row));
    if (item) {
      setError(null);
      return clearOwnedItem(item.id);
    }
    const slot = slotsRef.current.find((entry) => entry.col === col && entry.row === row);
    if (slot) {
      setError(null);
      return removeFromSlot(col, row);
    }
    return Promise.resolve();
  }

  function handleSlotPress(col: number, row: number) {
    if (deleting) {
      placeQueue.current = placeQueue.current.catch(() => undefined).then(() => erasePlot(col, row));
      return;
    }
    if (selectedShopItemId) {
      const shopItemId = selectedShopItemId;
      placeQueue.current = placeQueue.current
        .catch(() => undefined)
        .then(() => stampTile(shopItemId, col, row));
      return;
    }
    if (selectedPlantId) {
      void placePlant(selectedPlantId, col, row);
      return;
    }
    const occupant = slotMap.get(tileKey(col, row));
    if (occupant) {
      setSelectedPlantId(occupant.plant_id);
    }
  }

  const stampItem = selectedShopItemId
    ? ownedItems.find(
        (item) => item.shop_item_id === selectedShopItemId && item.garden_tile_id == null,
      ) ?? null
    : null;
  const aimCells = useMemo(() => {
    if (!stampItem || !aimKey || deleting) {
      return new Set<string>();
    }
    const [col, row] = aimKey.split(":").map(Number);
    return new Set(itemCells(col, row, stampItem).map((cell) => tileKey(cell.col, cell.row)));
  }, [aimKey, deleting, stampItem]);
  const eraseCells = useMemo(() => {
    if (!deleting || !aimKey) {
      return new Set<string>();
    }
    const [col, row] = aimKey.split(":").map(Number);
    const item = ownedItems.find((owned) => itemCovers(owned, col, row));
    if (item?.col != null && item.row != null) {
      return new Set(itemCells(item.col, item.row, item).map((cell) => tileKey(cell.col, cell.row)));
    }
    return new Set([aimKey]);
  }, [aimKey, deleting, ownedItems]);
  const tileStacks = useMemo(() => {
    const groups = new Map<string, OwnedShopItem[]>();
    for (const item of ownedItems) {
      const copies = groups.get(item.shop_item_id) ?? [];
      copies.push(item);
      groups.set(item.shop_item_id, copies);
    }
    return [...groups.values()].map((copies) => {
      const unplaced = copies.filter((item) => item.garden_tile_id == null);
      return {
        shopItemId: copies[0].shop_item_id,
        sample: unplaced[0] ?? copies[0],
        count: copies.length,
        unplacedCount: unplaced.length,
      };
    });
  }, [ownedItems]);
  const draggingPlant = drag?.kind === "plant" ? plantsById.get(drag.id) : undefined;
  const draggingItem = drag?.kind === "item" ? ownedItems.find((item) => item.id === drag.id) : undefined;
  return (
    <ThemedView style={styles.root}>
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
          <View style={styles.stage}>
          <View
            style={styles.boardArea}
            onLayout={(event) =>
              setBoardAreaWidth(event.nativeEvent.layout.width)
            }
          >
            <View
              ref={viewportRef}
              style={styles.viewport}
              {...(Platform.OS === "web" ? {} : gardenPan.panHandlers)}
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                viewportSize.current = { width, height };
                setMapHeight(height);
                if (viewportRef.current) {
                  measureView(viewportRef.current, (frame) => {
                    viewportWindow.current = frame;
                    if (!userMovedCamera.current && boardSize.width > 0) {
                      const pad = (framePad + bedPad + GARDEN_SHAPE_BORDER) * 2;
                      applyCamera(
                        1,
                        (viewportSize.current.width - boardSize.width - pad) / 2,
                        (viewportSize.current.height - boardSize.height - pad) / 2,
                      );
                    }
                    publishBoardFrames();
                  });
                }
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
            <View pointerEvents="box-none" style={styles.cameraHost}>
            <Animated.View style={[styles.camera, cameraStyle]}>
              <View style={styles.frameOuter}>
                <View style={[styles.frameInner, { padding: framePad + GARDEN_SHAPE_BORDER }]}>
                  <View style={[styles.soilBed, { padding: bedPad }]}>
                    <View
                      ref={boardRef}
                      onLayout={() => {
                        publishBoardFrames();
                      }}
                      style={[
                        styles.board,
                        { width: boardSize.width, height: boardSize.height },
                      ]}
                    >
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
                          {Array.from(
                            { length: viewColumns },
                            (_, columnOffset) => {
                              const col = bounds.minCol + columnOffset;
                              const key = tileKey(col, row);
                              const owned = tiles.some(
                                (tile) => tile.col === col && tile.row === row,
                              );
                              const occupant = slotMap.get(key);
                              const plant = occupant
                                ? plantsById.get(occupant.plant_id)
                                : undefined;
                              const highlighted =
                                hoverSlot === key || aimCells.has(key) || eraseCells.has(key);
                              const plot = tiles.find(
                                (item) => item.col === col && item.row === row,
                              );
                              const laid = plot ? itemByTile.get(plot.id) : undefined;
                              const laidSpan = laid ? itemSpan(laid) : null;
                              const laidSingle =
                                laidSpan != null && laidSpan.cols === 1 && laidSpan.rows === 1;
                              const isDragSource =
                                (drag?.kind === "plant" && drag.id === plant?.id) ||
                                (drag?.kind === "item" && drag.id === laid?.id);

                              return (
                                <GardenSlotCell
                                  key={key}
                                  mode={owned ? "plot" : "gap"}
                                  plant={plant}
                                  laidItemId={laid?.id ?? null}
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
                                  danger={deleting && eraseCells.has(key)}
                                  sourceDragging={isDragSource}
                                  dragLocked={drag != null && !isDragSource}
                                  onLayoutView={(view) => {
                                    if (!owned) {
                                      return;
                                    }
                                    slotViews.current[key] = view;
                                  }}
                                  onPress={() => {
                                    if (owned) {
                                      handleSlotPress(col, row);
                                    }
                                  }}
                                  onAim={
                                    owned && (stampItem || deleting)
                                      ? () => setAimKey(key)
                                      : undefined
                                  }
                                  onAimEnd={
                                    owned && (stampItem || deleting)
                                      ? () => setAimKey((current) => (current === key ? null : current))
                                      : undefined
                                  }
                                  onLongPress={() => {
                                    if (occupant) {
                                      void removeFromSlot(col, row);
                                    }
                                  }}
                                  pathUrl={
                                    laid && laidSingle ? shopItemImageUrl(laid.image_path) : null
                                  }
                                  imageFit={laid && isStandingItem(laid.slug) ? "contain" : "cover"}
                                  lampArt={laid?.slug === "light"}
                                  stoneGround={Boolean(
                                    laid &&
                                      (isStandingItem(laid.slug) ||
                                        (laidSpan && (laidSpan.cols > 1 || laidSpan.rows > 1))),
                                  )}
                                  onDragStart={startDrag}
                                  onDragMove={moveDrag}
                                  onDragEnd={endDrag}
                                  showTurn={Boolean(laid && laidSpan && (laidSpan.cols > 1 || laidSpan.rows > 1))}
                                  onTurn={() => {
                                    if (laid) {
                                      void turnOwnedItem(laid.id);
                                    }
                                  }}
                                />
                              );
                            },
                          )}
                        </View>
                        );
                      })}
                      {ownedItems.map((item) => {
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
                          <View
                            key={item.id}
                            pointerEvents="box-none"
                            style={[styles.piece, { left, top, width, height }]}
                          >
                            {imageUrl ? (
                              <Image
                                pointerEvents="none"
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
              </View>
            </Animated.View>
            </View>
            </View>
          </View>

          {error ? (
            <ThemedText
              type="small"
              style={[styles.errorText, { color: GardenPalette.panelDanger }]}
            >
              {error}
            </ThemedText>
          ) : null}

          <Animated.View
            ref={trayRef}
            style={[
              styles.sidePanel,
              kitFromBottom ? styles.kitSheet : styles.kitSide,
              kitFromBottom ? kitSheetStyle : { width: kitExtent },
            ]}
            onLayout={() => {
              if (trayRef.current) {
                measureView(trayRef.current, (frame) => {
                  trayFrame.current = frame;
                });
              }
            }}
          >
            <View
              style={[styles.drawer, kitFromBottom && { width: "100%", height: sheetOpen - SIDE_CLOSED }]}
              pointerEvents={sideOpen ? "auto" : "none"}
            >
              <View style={styles.drawerHeader}>
                <ThemedText type="smallBold" style={styles.drawerTitle}>
                  Plants and tiles
                </ThemedText>
                <ThemedText type="small" style={styles.drawerHint}>
                  {deleting
                    ? "Tap plots to pick up what's there. Tap Delete again when you are done."
                    : selectedShopItemId
                      ? stampItem
                        ? `Tap plots to keep laying ${stampItem.name}. Tap that tile again when you are done.`
                        : "Those tiles are all placed. Tap the tile again to stop."
                      : "Tap a stack, then tap plots to lay copies. Delete works the same way."}
                </ThemedText>
              </View>
              <ScrollView
                style={styles.sideScroll}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.sideList}
                nestedScrollEnabled
              >
                <View style={styles.sideSection}>
                  <View style={styles.sideSectionHeader}>
                    <ThemedText type="smallBold" style={styles.drawerTitle}>
                      Plants
                    </ThemedText>
                    <View style={styles.countPill}>
                      <ThemedText type="smallBold" style={styles.countPillText}>
                        {plants.length}
                      </ThemedText>
                    </View>
                  </View>
                  {plants.length === 0 ? (
                    <View style={styles.emptyNote}>
                      <ThemedText type="small" style={styles.drawerHint}>
                        Add some from the Add tab.
                      </ThemedText>
                    </View>
                  ) : (
                    <View style={styles.tileGrid}>
                    {plants.map((plant) => {
                      const placedIndex = slotForPlant(slots, plant.id);
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
                          dragging={drag?.kind === "plant" && drag.id === plant.id}
                          onPress={() => {
                            setDeleting(false);
                            setSelectedShopItemId(null);
                            setAimKey(null);
                            setSelectedPlantId((current) =>
                              current === plant.id ? null : plant.id,
                            );
                          }}
                          onDragStart={(plantId, x, y) => startDrag("plant", plantId, x, y)}
                          onDragMove={moveDrag}
                          onDragEnd={(x, y) => endDrag(x, y)}
                        />
                      );
                    })}
                    </View>
                  )}
                </View>
                <View style={styles.sideSection}>
                  <View style={styles.sideSectionHeader}>
                    <ThemedText type="smallBold" style={styles.drawerTitle}>
                      Tiles
                    </ThemedText>
                    <View style={styles.tileHeaderActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: deleting }}
                        accessibilityLabel={deleting ? "Stop deleting" : "Delete from the garden"}
                        onPress={() => {
                          setSelectedPlantId(null);
                          setSelectedShopItemId(null);
                          setAimKey(null);
                          setDeleting((on) => !on);
                        }}
                        style={[styles.deleteButton, deleting && styles.deleteButtonOn]}
                      >
                        <ThemedText type="smallBold" style={styles.deleteButtonText}>
                          Delete
                        </ThemedText>
                      </Pressable>
                      <View style={styles.countPill}>
                        <ThemedText type="smallBold" style={styles.countPillText}>
                          {ownedItems.length}
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                  {ownedItems.length === 0 ? (
                    <View style={styles.emptyNote}>
                      <ThemedText type="small" style={styles.drawerHint}>
                        Buy a path or some decorations from the Shop.
                      </ThemedText>
                    </View>
                  ) : (
                    <View style={styles.tileGrid}>
                      {tileStacks.map((stack) => (
                        <KitTile
                          key={stack.shopItemId}
                          item={stack.sample}
                          count={stack.count}
                          selected={stack.shopItemId === selectedShopItemId}
                          dragging={
                            drag?.kind === "item" &&
                            ownedItems.some(
                              (owned) => owned.id === drag.id && owned.shop_item_id === stack.shopItemId,
                            )
                          }
                          onPress={() => {
                            setDeleting(false);
                            setSelectedPlantId(null);
                            setAimKey(null);
                            setSelectedShopItemId((current) =>
                              current === stack.shopItemId ? null : stack.shopItemId,
                            );
                          }}
                          onDragStart={(x, y) => {
                            const next = itemsRef.current.find(
                              (owned) =>
                                owned.shop_item_id === stack.shopItemId && owned.garden_tile_id == null,
                            );
                            if (next) {
                              startDrag("item", next.id, x, y);
                            }
                          }}
                          onDragMove={moveDrag}
                          onDragEnd={endDrag}
                          onTurn={() => {
                            const next = itemsRef.current.find(
                              (owned) =>
                                owned.shop_item_id === stack.shopItemId && owned.garden_tile_id == null,
                            );
                            if (next) {
                              void turnOwnedItem(next.id);
                            }
                          }}
                        />
                      ))}
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
            <GestureDetector gesture={sheetDrag}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: sideOpen }}
              accessibilityLabel={sideOpen ? "Collapse kit" : "Expand kit"}
              onPress={() => setSideOpen((open) => !open)}
              style={({ pressed }) => [
                kitFromBottom ? styles.sheetBar : styles.rail,
                pressed && styles.pressed,
              ]}
            >
              <ThemedText type="smallBold" style={kitFromBottom ? styles.sheetChevron : styles.railChevron}>
                {kitFromBottom ? (sideOpen ? "▼" : "▲") : sideOpen ? "›" : "‹"}
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
                    {plants.length}
                  </ThemedText>
                </View>
                <View style={styles.railStat}>
                  <ThemedText type="smallBold" style={styles.railStatText}>
                    {ownedItems.length}
                  </ThemedText>
                </View>
              </View>
            </Pressable>
            </GestureDetector>
          </Animated.View>
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
              labelVisible={false}
              needsWater={
                plantWateringSchedule(
                  draggingPlant,
                  latestWatered.get(draggingPlant.id) ?? null,
                ).needsWater
              }
            />
          </View>
        ) : null}
        {drag && draggingItem ? (
          <View
            pointerEvents="none"
            style={[
              styles.dragGhost,
              {
                left: drag.x - screenOrigin.current.x - 36,
                top: drag.y - screenOrigin.current.y - 36,
              },
            ]}
          >
            <OwnedTileFace
              name={draggingItem.name}
              imageUrl={shopItemImageUrl(draggingItem.image_path)}
              rotation={draggingItem.rotation}
              fit={
                isStandingItem(draggingItem.slug) ||
                draggingItem.footprint_cols * draggingItem.footprint_rows > 1
                  ? "contain"
                  : "cover"
              }
              lamp={draggingItem.slug === "light"}
              decor={isStandingItem(draggingItem.slug)}
            />
          </View>
        ) : null}
      </View>
    </ThemedView>
  );
}

function useHoverFlag() {
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    setHovered(true);
  }, []);
  const hide = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setHovered(false), 160);
  }, []);
  return { hovered, show, hide };
}

const GardenSlotCell = memo(function GardenSlotCell({
  mode,
  plant,
  needsWater = false,
  bed,
  selected,
  highlighted,
  danger = false,
  pathUrl = null,
  imageFit = "cover",
  lampArt = false,
  stoneGround = false,
  laidItemId = null,
  sourceDragging = false,
  dragLocked = false,
  onLayoutView,
  onPress,
  onLongPress,
  onDragStart,
  onDragMove,
  onDragEnd,
  onAim,
  onAimEnd,
  showTurn = false,
  onTurn,
}: {
  mode: "plot" | "gap";
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
  danger?: boolean;
  pathUrl?: ShopItemImage | null;
  imageFit?: "cover" | "contain";
  lampArt?: boolean;
  stoneGround?: boolean;
  laidItemId?: string | null;
  sourceDragging?: boolean;
  dragLocked?: boolean;
  onLayoutView: (view: View) => void;
  onPress: () => void;
  onLongPress: () => void;
  onDragStart: (kind: DragState["kind"], id: string, x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  onAim?: () => void;
  onAimEnd?: () => void;
  showTurn?: boolean;
  onTurn?: () => void;
}) {
  const cellRef = useRef<View>(null);
  const { hovered, show, hide } = useHoverFlag();
  const reveal = hovered || Platform.OS !== "web";
  const plantId = plant?.id;
  const dragKind: DragState["kind"] | null = plantId ? "plant" : laidItemId ? "item" : null;
  const dragId = plantId ?? laidItemId;

  const gesture = useMemo(() => {
    if (!dragKind || !dragId || dragLocked) {
      return null;
    }

    const pan = Gesture.Pan()
      .minDistance(Platform.OS === "web" ? 6 : 14)
      .runOnJS(true);
    if (Platform.OS !== "web") {
      pan.activateAfterLongPress(380);
    }
    return pan
      .onStart((event) =>
        onDragStart(dragKind, dragId, event.absoluteX, event.absoluteY),
      )
      .onUpdate((event) => onDragMove(event.absoluteX, event.absoluteY))
      .onEnd((event) => {
        if (Platform.OS !== "web") {
          onDragEnd(event.absoluteX, event.absoluteY);
        }
      });
  }, [dragKind, dragId, dragLocked, onDragStart, onDragMove, onDragEnd]);

  if (mode === "gap") {
    return <View style={styles.slotWrap} />;
  }

  const body = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        plant
          ? plantDisplayName(plant.info)
          : stoneGround
            ? "Garden decoration"
            : pathUrl
                ? "Placed tile"
                : "Empty plot"
      }
      onPress={onPress}
      onHoverIn={() => {
        show();
        onAim?.();
      }}
      onHoverOut={() => {
        hide();
        onAimEnd?.();
      }}
      onLongPress={Platform.OS === "web" && mode === "plot" ? onLongPress : undefined}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.slot,
        plant ? styles.slotFilled : null,
        {
          backgroundColor: highlighted ? (danger ? "#E7C4B8" : bed.plotHover) : bed.plot,
          borderColor: danger && highlighted ? GardenPalette.panelDanger : bed.wood,
        },
        (selected || highlighted) && { borderWidth: 2 },
        sourceDragging && styles.draggingSource,
        pressed && styles.pressed,
      ]}
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
        <PlantToken
          plant={plant}
          selected={selected}
          needsWater={needsWater}
          labelVisible={Platform.OS === "web" && hovered}
        />
      ) : stoneGround || pathUrl ? null : (
        <>
          <Image
            source={require("@/assets/images/decoritems/soil_tile.png")}
            style={styles.slotSoil}
            contentFit="cover"
            priority="high"
            cachePolicy="memory-disk"
            loading="eager"
            pointerEvents="none"
          />
          {highlighted ? (
            <View
              pointerEvents="none"
              style={[styles.slotSoil, styles.slotHover]}
            />
          ) : null}
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
      {lampArt && pathUrl && !plant ? (
        <View pointerEvents="none" style={styles.streetLamp}>
          <Image
            source={pathUrl}
            style={styles.streetLampImage}
            contentFit="contain"
            priority="high"
            cachePolicy="memory-disk"
            loading="eager"
            pointerEvents="none"
          />
        </View>
      ) : null}
      {Platform.OS === "web" && reveal && showTurn ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Turn bench"
          onHoverIn={show}
          onHoverOut={hide}
          onPress={onTurn}
          style={styles.turnChip}
        >
          <ThemedText type="smallBold" style={styles.turnChipText}>
            Turn
          </ThemedText>
        </Pressable>
      ) : null}
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
  const [hovered, setHovered] = useState(false);
  const reveal = hovered || Platform.OS !== "web";
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(Platform.OS === "web" ? 4 : 8)
        .activateAfterLongPress(Platform.OS === "web" ? 0 : 240)
        .runOnJS(true)
        .onStart((event) =>
          onDragStart(plant.id, event.absoluteX, event.absoluteY),
        )
        .onUpdate((event) => onDragMove(event.absoluteX, event.absoluteY))
        .onEnd((event) => {
          if (Platform.OS !== "web") {
            onDragEnd(event.absoluteX, event.absoluteY, plant.id);
          }
        }),
    [plant.id, onDragStart, onDragMove, onDragEnd],
  );

  return (
    <GestureDetector gesture={gesture}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={plantDisplayName(plant.info)}
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={({ pressed }) => [
          styles.kitPlant,
          pressed && styles.pressed,
          dragging && styles.draggingSource,
        ]}
      >
        <PlantToken
          plant={plant}
          compact
          fillWidth
          placed={placed}
          selected={selected}
          needsWater={needsWater}
          labelVisible={Platform.OS === "web" && hovered}
        />
      </Pressable>
    </GestureDetector>
  );
});

const OwnedTile = memo(function OwnedTile({
  name,
  imageUrl,
  placed,
  dragging,
  rotation = 0,
  fit = "cover",
  lamp = false,
  decor = false,
  selected = false,
  onPress,
  onHoverIn,
  onHoverOut,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  name: string;
  imageUrl: ShopItemImage | null;
  placed: boolean;
  dragging: boolean;
  rotation?: number;
  fit?: "cover" | "contain";
  lamp?: boolean;
  decor?: boolean;
  selected?: boolean;
  onPress?: () => void;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
  onDragStart: (x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
}) {
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(Platform.OS === "web" ? 4 : 8)
        .activateAfterLongPress(Platform.OS === "web" ? 0 : 240)
        .runOnJS(true)
        .onStart((event) => onDragStart(event.absoluteX, event.absoluteY))
        .onUpdate((event) => onDragMove(event.absoluteX, event.absoluteY))
        .onEnd((event) => {
          if (Platform.OS !== "web") {
            onDragEnd(event.absoluteX, event.absoluteY);
          }
        }),
    [onDragStart, onDragMove, onDragEnd],
  );

  return (
    <GestureDetector gesture={gesture}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onHoverIn={onHoverIn}
        onHoverOut={onHoverOut}
        style={[
          styles.dragHandle,
          placed && styles.placedTile,
          dragging && styles.draggingSource,
          selected && styles.armedTile,
        ]}
      >
        <OwnedTileFace
          name={name}
          imageUrl={imageUrl}
          rotation={rotation}
          fit={fit}
          lamp={lamp}
          decor={decor}
        />
      </Pressable>
    </GestureDetector>
  );
});

function KitTile({
  item,
  count,
  selected,
  dragging,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTurn,
}: {
  item: OwnedShopItem;
  count: number;
  selected: boolean;
  dragging: boolean;
  onPress: () => void;
  onDragStart: (x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  onTurn: () => void;
}) {
  const { hovered, show, hide } = useHoverFlag();
  const wide = item.footprint_cols * item.footprint_rows > 1;
  const reveal = hovered || Platform.OS !== "web";
  const inKit = item.garden_tile_id == null;

  return (
    <KitStack
      count={count}
      below={
        wide && inKit && reveal ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Turn ${item.name}`}
            onHoverIn={show}
            onHoverOut={hide}
            onPress={onTurn}
            style={styles.turnButton}
          >
            <ThemedText type="smallBold" style={styles.turnChipText}>
              Turn
            </ThemedText>
          </Pressable>
        ) : null
      }
    >
      <OwnedTile
        name={item.name}
        imageUrl={shopItemImageUrl(item.image_path)}
        placed={!inKit}
        rotation={item.rotation}
        fit={wide || isStandingItem(item.slug) ? "contain" : "cover"}
        lamp={item.slug === "light"}
        decor={isStandingItem(item.slug)}
        selected={selected}
        dragging={dragging}
        onPress={onPress}
        onHoverIn={show}
        onHoverOut={hide}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      />
    </KitStack>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  screen: {
    flex: 1,
    width: "100%",
  },
  stage: {
    flex: 1,
    position: "relative",
  },
  boardArea: {
    flex: 1,
    alignSelf: "stretch",
  },
  viewport: {
    position: "relative",
    flex: 1,
    alignSelf: "stretch",
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
  camera: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 1,
    overflow: "visible",
    transformOrigin: "left top",
  },
  sidePanel: {
    position: "absolute",
    zIndex: 6,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: GardenPalette.panelBorder,
    backgroundColor: GardenPalette.panel,
    shadowColor: "#3B2A1A",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
  },
  kitSide: {
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "flex-end",
    borderRadius: Radius.lg,
    shadowOffset: { width: -6, height: 0 },
  },
  kitSheet: {
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "column",
    justifyContent: "flex-end",
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    shadowOffset: { width: 0, height: -6 },
  },
  sheetBar: {
    height: SIDE_CLOSED,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    backgroundColor: GardenPalette.bar,
  },
  sheetChevron: {
    color: GardenPalette.barText,
    fontSize: 22,
    lineHeight: 24,
  },
  sheetLabel: {
    flex: 1,
    color: GardenPalette.barText,
  },
  sheetStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  drawer: {
    width: SIDE_OPEN - SIDE_CLOSED,
    height: "100%",
    flexShrink: 0,
  },
  drawerHeader: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.one,
    borderBottomWidth: 1,
    borderBottomColor: GardenPalette.panelBorder,
  },
  drawerTitle: {
    color: GardenPalette.panelText,
  },
  drawerHint: {
    color: GardenPalette.panelTextSecondary,
  },
  sideScroll: {
    flex: 1,
  },
  sideList: {
    padding: Spacing.three,
    gap: Spacing.four,
  },
  sideSection: {
    gap: Spacing.two,
  },
  sideSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  countPill: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: GardenPalette.bar,
    alignItems: "center",
    justifyContent: "center",
  },
  countPillText: {
    color: GardenPalette.barText,
  },
  emptyNote: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: GardenPalette.panelBorder,
    borderRadius: Radius.sm,
    padding: Spacing.two,
  },
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  kitPlant: {
    width: "47%",
  },
  rail: {
    width: SIDE_CLOSED,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    backgroundColor: GardenPalette.bar,
  },
  railChevron: {
    color: GardenPalette.barText,
    fontSize: 22,
    lineHeight: 24,
  },
  railLabelWrap: {
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  railLabel: {
    color: GardenPalette.barTextMuted,
    transform: [{ rotate: "-90deg" }],
    width: 36,
    textAlign: "center",
  },
  railStat: {
    minWidth: 28,
    height: 28,
    borderRadius: Radius.pill,
    backgroundColor: GardenPalette.barPill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.one,
  },
  railStatText: {
    color: GardenPalette.barText,
  },
  errorText: {
    position: "absolute",
    top: Spacing.three,
    left: Spacing.three,
    zIndex: 7,
    maxWidth: 360,
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
    zIndex: 1,
    alignSelf: "center",
    padding: 0,
  },
  frameInner: {},
  soilBed: {
    alignItems: "center",
  },
  board: {
    position: "relative",
    gap: GARDEN_SLOT_GAP,
  },
  piece: {
    position: "absolute",
    zIndex: 2,
  },
  tileHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  deleteButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radius.pill,
    backgroundColor: GardenPalette.bar,
  },
  deleteButtonOn: {
    backgroundColor: GardenPalette.panelDanger,
  },
  deleteButtonText: {
    color: GardenPalette.barText,
  },
  turnButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: GardenPalette.bar,
  },
  turnChip: {
    position: "absolute",
    top: 4,
    right: 4,
    zIndex: 3,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: GardenPalette.bar,
  },
  turnChipText: {
    color: GardenPalette.barText,
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
  /** Street lamp: base near the tile's bottom edge, standing about two tiles tall. */
  streetLamp: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: "-35%",
    height: "200%",
    alignItems: "center",
    zIndex: 2,
  },
  streetLampImage: {
    height: "100%",
    aspectRatio: 49 / 332,
  },
  slotDecor: {
    position: "absolute",
    width: "72%",
    height: "72%",
    left: "14%",
    top: "14%",
    zIndex: 1,
  },
  slotHover: {
    backgroundColor: GardenPalette.plotHover,
    opacity: 0.55,
  },
  draggingSource: {
    opacity: 0.35,
  },
  dragGhost: {
    position: "absolute",
    zIndex: 20,
  },
  dragHandle: {
    touchAction: "none",
  },
  armedTile: {
    borderWidth: 2,
    borderColor: GardenPalette.highlight,
    borderRadius: Radius.sm,
  },
  placedTile: {
    opacity: 0.72,
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
