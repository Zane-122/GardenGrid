import { Image, StyleSheet, View } from "react-native";

const GRASS = require("@/assets/images/decoritems/grass.jpg") as number;
/** Deep green wash over the texture so the grass reads darker. */
const GRASS_TINT = "rgba(8, 40, 14, 0.45)";

/** Fills its parent with the seamless grass pattern, tiled. */
export function GrassBackground() {
  return (
    <View pointerEvents="none" style={styles.root}>
      <Image source={GRASS} resizeMode="repeat" style={styles.fill} />
      <View style={styles.tint} />
    </View>
  );
}

/** Tiled grass that fills the rectangle it is given. */
export function GardenGrass({ width, height }: { width: number; height: number }) {
  return (
    <View pointerEvents="none" style={{ width, height }}>
      <Image source={GRASS} resizeMode="repeat" style={[styles.texture, { width, height }]} />
      <View style={styles.tint} />
    </View>
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
  },
  fill: {
    width: "100%",
    height: "100%",
  },
  tint: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: GRASS_TINT,
  },
  texture: {
    backgroundColor: "transparent",
  },
});
