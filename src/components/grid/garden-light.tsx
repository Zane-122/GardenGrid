import { useId, useLayoutEffect, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, G, Image as SvgImage, Mask, Rect } from "react-native-svg";

import { GARDEN_SLOT_GAP } from "@/utils/garden";

const LAMP_MASK = require("../../../assets/images/lamp-mask.png");
/** Extra shade around the screen so a pan can move the cached mask instead of redrawing it. */
const SHADE_MARGIN = 360;
const SHADE_DRAW_SCALE = 1;

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

  if (Platform.OS !== "web") {
    if (shade <= 0.02) {
      return null;
    }
    return (
      <NativeShade
        shade={shade}
        darkness={darkness}
        lights={lights}
        cell={cell}
        minCol={minCol}
        minRow={minRow}
        inset={inset}
        camera={camera}
      />
    );
  }

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

function NativeShade({
  shade,
  darkness,
  lights,
  cell,
  minCol,
  minRow,
  inset,
  camera,
}: {
  shade: number;
  darkness: number;
  lights: LightSpot[];
  cell: number;
  minCol: number;
  minRow: number;
  inset: number;
  camera: Camera;
}) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const maskId = `gardenShade${rawId}`;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [snap, setSnap] = useState({
    scale: camera.scaleSv.value,
    tx: camera.txSv.value,
    ty: camera.tySv.value,
    ready: true,
  });
  const snapScale = useSharedValue(camera.scaleSv.value);
  const snapTx = useSharedValue(camera.txSv.value);
  const snapTy = useSharedValue(camera.tySv.value);
  const snapReady = useSharedValue(false);
  const snapLock = useSharedValue(false);
  const outer = 1.25 + 2.35 * darkness;
  const stride = cell + GARDEN_SLOT_GAP;
  const planeW = size.width + SHADE_MARGIN * 2;
  const planeH = size.height + SHADE_MARGIN * 2;
  const drawW = planeW * SHADE_DRAW_SCALE;
  const drawH = planeH * SHADE_DRAW_SCALE;

  useLayoutEffect(() => {
    if (!snap.ready) {
      const next = {
        scale: camera.scaleSv.value,
        tx: camera.txSv.value,
        ty: camera.tySv.value,
        ready: true,
      };
      snapScale.value = next.scale;
      snapTx.value = next.tx;
      snapTy.value = next.ty;
      snapReady.value = true;
      setSnap(next);
      return;
    }
    snapScale.value = snap.scale;
    snapTx.value = snap.tx;
    snapTy.value = snap.ty;
    snapReady.value = true;
    snapLock.value = false;
  }, [camera.scaleSv, camera.txSv, camera.tySv, snap, snapLock, snapReady, snapScale, snapTx, snapTy]);

  useAnimatedReaction(
    () => ({
      scale: camera.scaleSv.value,
      tx: camera.txSv.value,
      ty: camera.tySv.value,
    }),
    (next) => {
      if (!snapReady.value || snapLock.value || snapScale.value === 0) {
        return;
      }
      const zoom = next.scale / snapScale.value;
      const drifted =
        Math.abs(zoom - 1) > 0.12 ||
        Math.abs(next.tx - snapTx.value) > SHADE_MARGIN * 0.8 ||
        Math.abs(next.ty - snapTy.value) > SHADE_MARGIN * 0.8;
      if (!drifted) {
        return;
      }
      snapLock.value = true;
      runOnJS(setSnap)({ scale: next.scale, tx: next.tx, ty: next.ty, ready: true });
    },
  );

  const planeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: camera.txSv.value - snapTx.value },
      { translateY: camera.tySv.value - snapTy.value },
    ],
  }));

  return (
    <View
      pointerEvents="none"
      style={styles.cover}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((current) =>
          current.width === width && current.height === height ? current : { width, height },
        );
      }}
    >
      {size.width > 0 && size.height > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.shadePlane, { width: drawW, height: drawH }, planeStyle]}
        >
          <Svg width={drawW} height={drawH}>
            <Defs>
              {lights.map((light, index) => {
                const radius = cell * outer * snap.scale * SHADE_DRAW_SCALE;
                const centerX =
                  (snap.tx + (inset + (light.col - minCol) * stride + cell / 2) * snap.scale) *
                  SHADE_DRAW_SCALE;
                const centerY =
                  (snap.ty + (inset + (light.row - minRow) * stride + cell / 2) * snap.scale) *
                  SHADE_DRAW_SCALE;
                return (
                  <Mask
                    key={light.id}
                    id={`${maskId}-${index}`}
                    x={0}
                    y={0}
                    width={drawW}
                    height={drawH}
                    maskUnits="userSpaceOnUse"
                    maskContentUnits="userSpaceOnUse"
                  >
                    <Rect x={0} y={0} width={drawW} height={drawH} fill="#ffffff" />
                    <SvgImage
                      x={centerX - radius + SHADE_MARGIN * SHADE_DRAW_SCALE}
                      y={centerY - radius + SHADE_MARGIN * SHADE_DRAW_SCALE}
                      width={radius * 2}
                      height={radius * 2}
                      href={LAMP_MASK}
                      preserveAspectRatio="none"
                    />
                  </Mask>
                );
              })}
            </Defs>
            {lights.reduceRight<ReactNode>(
              (child, _light, index) => (
                <G key={index} mask={`url(#${maskId}-${index})`}>
                  {child}
                </G>
              ),
              <Rect x={0} y={0} width={drawW} height={drawH} fill={`rgba(6, 14, 10, ${shade})`} />,
            )}
          </Svg>
        </Animated.View>
      ) : null}
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
  shadePlane: {
    position: "absolute",
    left: -SHADE_MARGIN,
    top: -SHADE_MARGIN,
    transformOrigin: "left top",
  },
  glow: {
    position: "absolute",
    zIndex: 5,
    mixBlendMode: "screen",
  },
});
