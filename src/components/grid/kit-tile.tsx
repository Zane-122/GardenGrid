import { Image } from "expo-image";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { GardenPalette, Radius, Spacing } from "@/constants/theme";
import type { ShopItemImage } from "@/utils/shop-items";

const KIT_TILE_SIZE = 72;

/** Square kit tile: stone ground for decor, the item art, and its name along the bottom. */
export function OwnedTileFace({
  name,
  imageUrl,
  rotation = 0,
  fit = "cover",
  lamp = false,
  decor = false,
}: {
  name: string;
  imageUrl: ShopItemImage | null;
  rotation?: number;
  fit?: "cover" | "contain";
  lamp?: boolean;
  decor?: boolean;
}) {
  return (
    <View style={styles.tile} pointerEvents="none">
      {lamp || decor ? (
        <Image
          source={require("@/assets/images/decoritems/bench-ground.png")}
          style={styles.fill}
          contentFit="cover"
          priority="high"
          cachePolicy="memory-disk"
          loading="eager"
          pointerEvents="none"
        />
      ) : null}
      {imageUrl ? (
        <Image
          source={imageUrl}
          style={
            lamp
              ? styles.lamp
              : decor
                ? styles.decor
                : [styles.fill, { transform: [{ rotate: `${rotation}deg` }] }]
          }
          contentFit={lamp || decor ? "contain" : fit}
          priority="high"
          cachePolicy="memory-disk"
          loading="eager"
          pointerEvents="none"
        />
      ) : null}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.label}>
        {name}
      </ThemedText>
    </View>
  );
}

/** Cards fanned out behind a kit tile, with the copy count on top. `below` sits under the stack. */
export function KitStack({
  count,
  below,
  children,
}: {
  count: number;
  below?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.stackWrap}>
        {count > 2 ? <View style={[styles.stackCard, styles.stackCardFar]} /> : null}
        {count > 1 ? <View style={[styles.stackCard, styles.stackCardNear]} /> : null}
        {children}
        {count > 1 ? (
          <View style={styles.stackBadge} pointerEvents="none">
            <ThemedText type="smallBold" style={styles.stackBadgeText}>
              {count}
            </ThemedText>
          </View>
        ) : null}
      </View>
      {below}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: KIT_TILE_SIZE,
    height: KIT_TILE_SIZE,
    borderRadius: Radius.sm,
    overflow: "hidden",
    backgroundColor: GardenPalette.plot,
    justifyContent: "flex-end",
  },
  fill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  lamp: {
    position: "absolute",
    top: "4%",
    bottom: "4%",
    left: 0,
    right: 0,
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
  label: {
    color: "#FFFFFF",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
  },
  stack: {
    alignItems: "center",
    gap: Spacing.one,
    paddingTop: 8,
  },
  stackWrap: {
    width: KIT_TILE_SIZE,
    height: KIT_TILE_SIZE,
  },
  stackCard: {
    position: "absolute",
    width: KIT_TILE_SIZE,
    height: KIT_TILE_SIZE,
    borderRadius: Radius.sm,
    backgroundColor: GardenPalette.woodOuter,
    borderWidth: 1,
    borderColor: GardenPalette.panelBorder,
  },
  stackCardNear: {
    top: -4,
    left: 4,
  },
  stackCardFar: {
    top: -8,
    left: 8,
  },
  stackBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: Radius.pill,
    backgroundColor: GardenPalette.bar,
    alignItems: "center",
    justifyContent: "center",
  },
  stackBadgeText: {
    color: GardenPalette.barText,
  },
});
