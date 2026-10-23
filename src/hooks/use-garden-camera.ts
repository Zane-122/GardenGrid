import { useCallback, useEffect, useMemo, useRef } from "react";
import { Gesture } from "react-native-gesture-handler";
import {
  PanResponder,
  Platform,
  useWindowDimensions,
  type LayoutChangeEvent,
  type View,
} from "react-native";
import { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { GARDEN_SLOT_GAP, tileKey } from "@/utils/garden";

export const MIN_ZOOM = 0.45;
export const MAX_ZOOM = 2.75;
/** On-screen plot size a phone opens at, so a wide garden is not a field of tiny tiles. */
const PHONE_CELL = 70;
/** How much of the garden must stay on screen while panning. */
const KEEP_VISIBLE = 72;

export type Frame = { x: number; y: number; width: number; height: number };

export function contains(frame: Frame, x: number, y: number) {
  return (
    x >= frame.x &&
    y >= frame.y &&
    x <= frame.x + frame.width &&
    y <= frame.y + frame.height
  );
}

export function measureView(view: View, onFrame: (frame: Frame) => void) {
  view.measureInWindow((x, y, width, height) => {
    if (width > 0 && height > 0) {
      onFrame({ x, y, width, height });
    }
  });
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

type GardenCameraOptions = {
  board: { width: number; height: number; cell: number };
  /** Brown margin around the board, per side. */
  border: number;
  bounds: { minCol: number; maxCol: number; minRow: number; maxRow: number };
  /** Plots that can receive a drop. */
  tiles: { col: number; row: number }[];
  /** True when a pointer at this window point is on something the user can drag, so the web camera should not pan. */
  hitsMovable: (x: number, y: number) => boolean;
  isDragging: () => boolean;
  onViewportLayout: (size: { width: number; height: number }) => void;
  /** Resets the "user has moved the camera" flag when a modal opens onto a different garden. */
  bindKey?: string | number | null;
  /**
   * Modals render outside the app gesture root, so PanResponder never receives the touch.
   * Use react-native-gesture-handler pan and pinch on those screens instead.
   */
  handlerGestures?: boolean;
};

/**
 * Pan and zoom for a garden board: drag or one-finger pan, pinch, and the mouse wheel on web.
 * It also keeps the on-screen frame of every plot, so a drag can find the plot under the pointer.
 */
export function useGardenCamera({
  board,
  border,
  bounds,
  tiles,
  hitsMovable,
  isDragging,
  onViewportLayout,
  bindKey = null,
  handlerGestures = false,
}: GardenCameraOptions) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const scaleSv = useSharedValue(1);
  const txSv = useSharedValue(0);
  const tySv = useSharedValue(0);

  const hostRef = useRef<View | null>(null);
  const viewportSize = useRef({ width: 0, height: 0 });
  const viewportWindow = useRef<Frame | null>(null);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const userMovedCamera = useRef(false);
  const panOrigin = useRef({ x: 0, y: 0 });
  const pinchStart = useRef({ scale: 1, x: 0, y: 0, fx: 0, fy: 0, distance: 1 });
  const pinching = useRef(false);
  const frames = useRef<Partial<Record<string, Frame>>>({});
  const unbindWeb = useRef<(() => void) | null>(null);

  const boardRef = useRef(board);
  const borderRef = useRef(border);
  const boundsRef = useRef(bounds);
  const tilesRef = useRef(tiles);
  const hitsMovableRef = useRef(hitsMovable);
  const isDraggingRef = useRef(isDragging);
  boardRef.current = board;
  borderRef.current = border;
  boundsRef.current = bounds;
  tilesRef.current = tiles;
  hitsMovableRef.current = hitsMovable;
  isDraggingRef.current = isDragging;

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

  function applyCamera(nextScale: number, nextX: number, nextY: number) {
    const viewport = viewportSize.current;
    const pad = borderRef.current * 2;
    const boardW = ((boardRef.current.cell > 0 ? boardRef.current.width : 0) + pad) * nextScale;
    const boardH = ((boardRef.current.cell > 0 ? boardRef.current.height : 0) + pad) * nextScale;
    let x = nextX;
    let y = nextY;
    if (viewport.width > 0 && viewport.height > 0 && boardW > pad && boardH > pad) {
      x = Math.min(viewport.width - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - boardW, nextX));
      y = Math.min(viewport.height - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - boardH, nextY));
    }
    scaleRef.current = nextScale;
    translateRef.current = { x, y };
    scaleSv.value = nextScale;
    txSv.value = x;
    tySv.value = y;
  }

  function publishFrames() {
    const viewport = viewportWindow.current;
    if (!viewport) {
      return;
    }
    const { cell } = boardRef.current;
    const scale = scaleRef.current;
    const pad = borderRef.current * scale;
    const originX = viewport.x + translateRef.current.x + pad;
    const originY = viewport.y + translateRef.current.y + pad;
    const stride = (cell + GARDEN_SLOT_GAP) * scale;
    const screenCell = cell * scale;
    const { minCol, minRow } = boundsRef.current;
    const next: Partial<Record<string, Frame>> = {};
    for (const tile of tilesRef.current) {
      next[tileKey(tile.col, tile.row)] = {
        x: originX + (tile.col - minCol) * stride,
        y: originY + (tile.row - minRow) * stride,
        width: screenCell,
        height: screenCell,
      };
    }
    frames.current = next;
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
    publishFrames();
  }

  const api = useRef({ apply: applyCamera, publish: publishFrames, zoomAt });
  api.current = { apply: applyCamera, publish: publishFrames, zoomAt };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (event, gesture) => {
          if (isDraggingRef.current()) {
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
          if (isDraggingRef.current()) {
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
            api.current.apply(nextScale, fx - boardX * nextScale, fy - boardY * nextScale);
            return;
          }
          if (pinching.current) {
            pinching.current = false;
            panOrigin.current = {
              x: translateRef.current.x - gesture.dx,
              y: translateRef.current.y - gesture.dy,
            };
          }
          api.current.apply(
            scaleRef.current,
            panOrigin.current.x + gesture.dx,
            panOrigin.current.y + gesture.dy,
          );
        },
        onPanResponderRelease: () => {
          pinching.current = false;
          api.current.publish();
        },
        onPanResponderTerminate: () => {
          pinching.current = false;
          api.current.publish();
        },
      }),
    [],
  );

  const seenBindKey = useRef(bindKey);
  // Re-center when the board changes size, unless the user has moved the camera and it is still in view.
  useEffect(() => {
    if (seenBindKey.current !== bindKey) {
      seenBindKey.current = bindKey;
      userMovedCamera.current = false;
    }
    const viewport = viewportSize.current;
    if (viewport.width <= 0 || viewport.height <= 0 || board.width <= 0) {
      return;
    }
    const pad = border * 2;
    const tx = translateRef.current.x;
    const ty = translateRef.current.y;
    const shownScale = scaleRef.current || 1;
    const shownW = (board.width + pad) * shownScale;
    const shownH = (board.height + pad) * shownScale;
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
        : clampZoom(Math.max(1, PHONE_CELL / board.cell));
    const visualW = (board.width + pad) * scale;
    const visualH = (board.height + pad) * scale;
    applyCamera(scale, (viewport.width - visualW) / 2, (viewport.height - visualH) / 2);
    publishFrames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.height, board.width, bindKey]);

  // Frames also change when plots are added, so republish.
  useEffect(() => {
    publishFrames();
  }, [tiles, bounds.minCol, bounds.minRow]);

  // Modal content mounts a frame after `visible` flips, so an effect that reads the ref
  // on that first commit finds nothing. Bind when the node itself is attached.
  const viewportRef = useCallback((node: View | null) => {
    unbindWeb.current?.();
    unbindWeb.current = null;
    hostRef.current = node;
    if (Platform.OS !== "web" || node == null) {
      return;
    }
    const element = node as unknown as HTMLElement;
    if (typeof element.addEventListener !== "function") {
      return;
    }
    element.style.touchAction = "none";
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      api.current.zoomAt(event.clientX, event.clientY, factor);
    };
    let panning = false;
    let originX = 0;
    let originY = 0;
    let originTx = 0;
    let originTy = 0;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || isDraggingRef.current()) {
        return;
      }
      if (hitsMovableRef.current(event.clientX, event.clientY)) {
        return;
      }
      panning = true;
      originX = event.clientX;
      originY = event.clientY;
      originTx = translateRef.current.x;
      originTy = translateRef.current.y;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!panning || isDraggingRef.current()) {
        return;
      }
      const dx = event.clientX - originX;
      const dy = event.clientY - originY;
      if (dx * dx + dy * dy < 16) {
        return;
      }
      userMovedCamera.current = true;
      api.current.apply(scaleRef.current, originTx + dx, originTy + dy);
    };
    const onPointerUp = () => {
      if (!panning) {
        return;
      }
      panning = false;
      api.current.publish();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    unbindWeb.current = () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .maxPointers(1)
      .runOnJS(true)
      .onBegin(() => {
        panOrigin.current = { x: translateRef.current.x, y: translateRef.current.y };
      })
      .onUpdate((event) => {
        if (isDraggingRef.current() || event.numberOfPointers > 1 || pinching.current) {
          return;
        }
        const dx = event.translationX;
        const dy = event.translationY;
        if (dx * dx + dy * dy < 16) {
          return;
        }
        userMovedCamera.current = true;
        api.current.apply(scaleRef.current, panOrigin.current.x + dx, panOrigin.current.y + dy);
      })
      .onFinalize(() => {
        api.current.publish();
      });
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin((event) => {
        userMovedCamera.current = true;
        pinching.current = true;
        pinchStart.current = {
          scale: scaleRef.current,
          x: translateRef.current.x,
          y: translateRef.current.y,
          fx: event.focalX,
          fy: event.focalY,
          distance: 1,
        };
      })
      .onUpdate((event) => {
        const start = pinchStart.current;
        const nextScale = clampZoom(start.scale * event.scale);
        const boardX = (start.fx - start.x) / start.scale;
        const boardY = (start.fy - start.y) / start.scale;
        api.current.apply(nextScale, event.focalX - boardX * nextScale, event.focalY - boardY * nextScale);
      })
      .onFinalize(() => {
        pinching.current = false;
        api.current.publish();
      });
    return Gesture.Simultaneous(pan, pinch);
  }, []);

  function onLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    viewportSize.current = { width, height };
    onViewportLayout({ width, height });
    if (!hostRef.current) {
      return;
    }
    measureView(hostRef.current, (frame) => {
      viewportWindow.current = frame;
      publishFrames();
    });
  }

  /** Re-reads where the viewport is in the window. Call before a drag starts. */
  function remeasure() {
    if (hostRef.current) {
      measureView(hostRef.current, (frame) => {
        viewportWindow.current = frame;
        publishFrames();
      });
    }
  }

  function cellAt(x: number, y: number) {
    for (const [key, frame] of Object.entries(frames.current)) {
      if (frame && contains(frame, x, y)) {
        return key;
      }
    }
    return null;
  }

  return {
    viewportRef,
    gesture: handlerGestures && Platform.OS !== "web" ? gesture : null,
    viewportProps: {
      onLayout,
      collapsable: false as const,
      ...(Platform.OS === "web" || handlerGestures ? {} : panResponder.panHandlers),
    },
    cameraStyle,
    grassStyle,
    grassPad,
    cellAt,
    remeasure,
    frames,
  };
}
