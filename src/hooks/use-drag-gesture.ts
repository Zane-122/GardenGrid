import { useMemo } from "react";
import { Platform } from "react-native";
import { Gesture } from "react-native-gesture-handler";

type DragGestureOptions = {
  enabled?: boolean;
  /** Board plots start a drag after a longer hold on touch screens, so panning still works. */
  onBoard?: boolean;
  onStart: (x: number, y: number) => void;
  onMove: (x: number, y: number) => void;
  onEnd: (x: number, y: number) => void;
};

/**
 * Pan gesture that reports window coordinates for dragging a tile or plant.
 * On web the end of the drag comes from a window pointer listener instead, so `onEnd` is native only.
 */
export function useDragGesture({ enabled = true, onBoard = false, onStart, onMove, onEnd }: DragGestureOptions) {
  return useMemo(() => {
    if (!enabled) {
      return null;
    }
    const pan = Gesture.Pan()
      .minDistance(Platform.OS === "web" ? (onBoard ? 6 : 4) : onBoard ? 14 : 8)
      .runOnJS(true);
    if (Platform.OS !== "web") {
      pan.activateAfterLongPress(onBoard ? 380 : 240);
    }
    return pan
      .onStart((event) => onStart(event.absoluteX, event.absoluteY))
      .onUpdate((event) => onMove(event.absoluteX, event.absoluteY))
      .onEnd((event) => {
        if (Platform.OS !== "web") {
          onEnd(event.absoluteX, event.absoluteY);
        }
      });
  }, [enabled, onBoard, onStart, onMove, onEnd]);
}
