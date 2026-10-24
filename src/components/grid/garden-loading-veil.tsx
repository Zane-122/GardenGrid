import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { GardenPalette, Radius } from "@/constants/theme";
import { GARDEN_SLOT_GAP } from "@/utils/garden";

const MIN_VEIL_MS = 720;
const STAGGER_MS = 48;
const MAX_GRID = 220;

type GardenLoadingVeilProps = {
  visible: boolean;
  columns?: number;
  rows?: number;
};

/** Covers the garden while plots and photos finish loading. Blocks fade in one by one. */
export function GardenLoadingVeil({
  visible,
  columns = 3,
  rows = 4,
}: GardenLoadingVeilProps) {
  const [area, setArea] = useState({ width: 0, height: 0 });
  if (!visible) {
    return null;
  }

  // Square blocks sized to fit the covered area, so the grid stays centered at any phone size.
  const gaps = GARDEN_SLOT_GAP * (columns - 1);
  const rowGaps = GARDEN_SLOT_GAP * (rows - 1);
  const block = Math.max(
    6,
    Math.floor(
      Math.min(
        (Math.min(area.width * 0.6, MAX_GRID) - gaps) / columns,
        (Math.min(area.height * 0.6, MAX_GRID * 1.4) - rowGaps) / rows,
      ),
    ),
  );

  return (
    <View
      pointerEvents="auto"
      style={styles.cover}
      onLayout={(event) => setArea(event.nativeEvent.layout)}
    >
      <View style={[styles.grid, { gap: GARDEN_SLOT_GAP, opacity: area.width > 0 ? 1 : 0 }]}>
        {Array.from({ length: rows }, (_, row) => (
          <View key={row} style={[styles.row, { gap: GARDEN_SLOT_GAP }]}>
            {Array.from({ length: columns }, (_, col) => {
              const index = row * columns + col;
              return <FadeBlock key={index} size={block} delay={index * STAGGER_MS} />;
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function FadeBlock({ delay, size }: { delay: number; size: number }) {
  const opacity = useSharedValue(0.12);
  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }),
    );
  }, [delay, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.block, { width: size, height: size }, style]} />;
}

/** Prefetch remote garden art so plots do not pop in after the veil lifts. */
export async function prefetchGardenImages(urls: Array<string | null | undefined>) {
  const unique = [...new Set(urls.filter((url): url is string => Boolean(url)))];
  if (unique.length === 0) {
    return;
  }
  await Image.prefetch(unique, "memory-disk");
}

/**
 * Keeps the loading veil up until garden data is in and every photo URL has been
 * pulled into the image cache (plus a short beat so the block fade can finish).
 */
export function useGardenLoadGate(dataReady: boolean, urls: Array<string | null | undefined>) {
  const [revealed, setRevealed] = useState(false);
  const urlKey = useMemo(
    () =>
      [...new Set(urls.filter((url): url is string => Boolean(url)))]
        .sort()
        .join("|"),
    [urls],
  );

  useEffect(() => {
    if (!dataReady) {
      setRevealed(false);
      return;
    }
    let cancelled = false;
    const started = Date.now();
    void (async () => {
      try {
        await prefetchGardenImages(urlKey.length > 0 ? urlKey.split("|") : []);
      } catch {
        // Still lift the veil if a CDN image fails; the plot can fall back later.
      }
      const wait = Math.max(0, MIN_VEIL_MS - (Date.now() - started));
      await new Promise((resolve) => setTimeout(resolve, wait));
      if (!cancelled) {
        setRevealed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataReady, urlKey]);

  return !revealed;
}

const styles = StyleSheet.create({
  cover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GardenPalette.grass,
  },
  grid: {
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
  },
  block: {
    borderRadius: Radius.sm,
    backgroundColor: GardenPalette.woodOuter,
  },
});
