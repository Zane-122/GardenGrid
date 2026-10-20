import { Image, StyleSheet, View } from "react-native";

const GRASS = require("@/assets/images/decoritems/grass.jpg") as number;

/** Fills its parent with the seamless grass pattern, tiled. */
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
  },
  fill: {
    width: "100%",
    height: "100%",
  },
  texture: {
    backgroundColor: "transparent",
  },
});
