import { Image, StyleSheet, View } from "react-native";

import { GardenPalette } from "@/constants/theme";

const TEXTURE_OPACITY = 0.22;
const GRASS = require("@/assets/images/grass_tile_3.jpg") as number;

/** Fills its parent with solid grass green plus the seamless grass pattern faintly on top. */
export function GrassBackground() {
  return (
    <View pointerEvents="none" style={styles.root}>
      <Image source={GRASS} resizeMode="repeat" style={styles.fill} />
    </View>
  );
}

/** Tiled grass that fills the rectangle it is given. */
export function GardenGrass({ width, height }: { width: number; height: number }) {
  return (
    <Image
      pointerEvents="none"
      source={GRASS}
      resizeMode="repeat"
      style={[styles.texture, { width, height }]}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
    backgroundColor: GardenPalette.grass,
  },
  fill: {
    width: "100%",
    height: "100%",
    opacity: TEXTURE_OPACITY,
  },
  texture: {
    opacity: TEXTURE_OPACITY,
    backgroundColor: GardenPalette.grass,
  },
});
