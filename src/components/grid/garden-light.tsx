import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { GARDEN_SLOT_GAP } from "@/utils/garden";

type LightSpot = {
  id: string;
  col: number;
  row: number;
};

type Camera = {
  scaleSv: SharedValue<number>;
  txSv: SharedValue<number>;
  tySv: SharedValue<number>;
};

/**
 * Covers the whole garden view. Brightness follows the precalculated daylight,
 * and each lamp opens a pool that stays locked to that plot while you pan.
 */
export function GardenLight({
  index,
  lights,
  cell,
  minCol,
  minRow,
  inset,
  scaleSv,
  txSv,
  tySv,
  cursorX,
  cursorY,
  cursorOn,
}: {
  index: number;
  lights: LightSpot[];
  cell: number;
  minCol: number;
  minRow: number;
  inset: number;
  scaleSv: SharedValue<number>;
  txSv: SharedValue<number>;
  tySv: SharedValue<number>;
  cursorX: SharedValue<number>;
  cursorY: SharedValue<number>;
  cursorOn: SharedValue<number>;
}) {
  const darkness = Math.min(1, Math.max(0, 1 - index));
  const shade = 0.8 * darkness;
  const stride = cell + GARDEN_SLOT_GAP;
  const camera = { scaleSv, txSv, tySv };

  const shadeStyle = useAnimatedStyle(() => {
    const scale = scaleSv.value;
    const tx = txSv.value;
    const ty = tySv.value;
    const holes = lights.map((light) => {
      const centerX = tx + (inset + (light.col - minCol) * stride + cell / 2) * scale;
      const centerY = ty + (inset + (light.row - minRow) * stride + cell / 2) * scale;
      const inner = cell * (0.42 + 0.55 * darkness) * scale;
      const outer = cell * (1.25 + 2.35 * darkness) * scale;
      return `radial-gradient(circle at ${centerX}px ${centerY}px, transparent 0px, transparent ${inner}px, #000 ${outer}px)`;
    });
    if (cursorOn.value > 0) {
      holes.push(
        `radial-gradient(circle at ${cursorX.value}px ${cursorY.value}px, transparent 0px, transparent 28px, #000 130px)`,
      );
    }
    const style: ViewStyle = {
      backgroundColor: `rgba(6, 14, 10, ${shade})`,
    };
    if (holes.length === 1) {
      Object.assign(style, {
        maskImage: holes[0],
        WebkitMaskImage: holes[0],
      });
    } else if (holes.length > 1) {
      const mask = holes.join(", ");
      Object.assign(style, {
        maskImage: mask,
        WebkitMaskImage: mask,
        maskComposite: "intersect",
        WebkitMaskComposite: "source-in",
      });
    }
    return style;
  });

  return (
    <View pointerEvents="none" style={styles.cover}>
      {shade > 0.02 ? <Animated.View pointerEvents="none" style={[styles.cover, shadeStyle]} /> : null}
      {lights.map((light) => (
        <LightGlow
          key={light.id}
          col={light.col}
          row={light.row}
          cell={cell}
          minCol={minCol}
          minRow={minRow}
          inset={inset}
          darkness={darkness}
          camera={camera}
        />
      ))}
      <CursorGlow cursorX={cursorX} cursorY={cursorY} cursorOn={cursorOn} darkness={darkness} />
    </View>
  );
}

function LightGlow({
  col,
  row,
  cell,
  minCol,
  minRow,
  inset,
  darkness,
  camera,
}: {
  col: number;
  row: number;
  cell: number;
  minCol: number;
  minRow: number;
  inset: number;
  darkness: number;
  camera: Camera;
}) {
  const stride = cell + GARDEN_SLOT_GAP;
  const core = 0.2 + 0.55 * darkness;
  const style = useAnimatedStyle(() => {
    const scale = camera.scaleSv.value;
    const radius = cell * (1.15 + 2.15 * darkness) * scale;
    const centerX = camera.txSv.value + (inset + (col - minCol) * stride + cell / 2) * scale;
    const centerY = camera.tySv.value + (inset + (row - minRow) * stride + cell / 2) * scale;
    return {
      left: centerX - radius,
      top: centerY - radius,
      width: radius * 2,
      height: radius * 2,
      borderRadius: radius,
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.glow,
        style,
        {
          experimental_backgroundImage: `radial-gradient(circle, rgba(255, 244, 210, ${core}) 0%, rgba(255, 210, 120, ${core * 0.45}) 36%, rgba(255, 186, 70, 0) 70%)`,
        },
      ]}
    />
  );
}

function CursorGlow({
  cursorX,
  cursorY,
  cursorOn,
  darkness,
}: {
  cursorX: SharedValue<number>;
  cursorY: SharedValue<number>;
  cursorOn: SharedValue<number>;
  darkness: number;
}) {
  const radius = 120;
  const core = 0.28 + 0.45 * darkness;
  const style = useAnimatedStyle(() => ({
    left: cursorX.value - radius,
    top: cursorY.value - radius,
    width: radius * 2,
    height: radius * 2,
    borderRadius: radius,
    opacity: cursorOn.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.glow,
        style,
        {
          experimental_backgroundImage: `radial-gradient(circle, rgba(255, 244, 210, ${core}) 0%, rgba(255, 210, 120, ${core * 0.4}) 40%, rgba(255, 186, 70, 0) 72%)`,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  cover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 4,
  },
  glow: {
    position: "absolute",
    zIndex: 5,
    mixBlendMode: "screen",
  },
});
