import { Image } from "expo-image";
import { StyleSheet, useWindowDimensions, View } from "react-native";

import { GardenPalette } from "@/constants/theme";

const TILE = 320;
const TEXTURE_OPACITY = 0.22;
const GRASS = require("@/assets/images/grass_tile_3.jpg") as number;

function GrassTiles({ columns, rows }: { columns: number; rows: number }) {
  return (
    <View style={styles.texture}>
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} style={styles.row}>
          {Array.from({ length: columns }, (_, column) => (
            <Image
              key={column}
              source={GRASS}
              style={styles.tile}
              contentFit="fill"
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Fills its parent with solid grass green plus the seamless grass pattern faintly on top. */
export function GrassBackground() {
  const { width, height } = useWindowDimensions();
  const columns = Math.ceil(width / TILE);
  const rows = Math.ceil(height / TILE);

  return (
    <View pointerEvents="none" style={styles.root}>
      <GrassTiles columns={columns} rows={rows} />
    </View>
  );
}

/** Tiled grass that fills the rectangle it is given. */
export function GardenGrass({ width, height }: { width: number; height: number }) {
  const columns = Math.ceil(Math.max(width, 1) / TILE);
  const rows = Math.ceil(Math.max(height, 1) / TILE);

  return (
    <View pointerEvents="none" style={styles.planeFill}>
      <GrassTiles columns={columns} rows={rows} />
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
    backgroundColor: GardenPalette.grass,
  },
  texture: {
    opacity: TEXTURE_OPACITY,
  },
  row: {
    flexDirection: "row",
  },
  tile: {
    width: TILE,
    height: TILE,
  },
  plane: {
    position: "absolute",
    zIndex: 0,
    overflow: "hidden",
    backgroundColor: GardenPalette.grass,
  },
  planeFill: {
    flex: 1,
    backgroundColor: GardenPalette.grass,
  },
});
