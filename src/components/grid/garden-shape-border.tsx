import { StyleSheet, View } from 'react-native';

import { GardenPalette, Radius } from '@/constants/theme';
import { GARDEN_SLOT_GAP } from '@/utils/garden';

/** Visible brown margin outside a plot that has no neighbor. */
export const GARDEN_SHAPE_BORDER = 8;

const CORNER = Radius.lg;

type TilePoint = { col: number; row: number };

function owns(tiles: TilePoint[], col: number, row: number) {
  return tiles.some((tile) => tile.col === col && tile.row === row);
}

function reach(neighborOwned: boolean) {
  // Overlap the next plot so the fills meet in the gap and stay hidden under that plot.
  return neighborOwned ? GARDEN_SLOT_GAP + CORNER : GARDEN_SHAPE_BORDER;
}

/**
 * Inside corners of the garden are a 90° notch between two straight edges.
 * A disk centered on that notch rounds it the same way the outside corners are rounded.
 */
function ConcaveFillets({ tiles, col, row }: { tiles: TilePoint[]; col: number; row: number }) {
  if (owns(tiles, col, row)) {
    return null;
  }

  const inset = GARDEN_SHAPE_BORDER - GARDEN_SLOT_GAP;
  const size = CORNER * 2;
  const corners = [
    owns(tiles, col - 1, row - 1) && owns(tiles, col, row - 1) && owns(tiles, col - 1, row)
      ? { top: inset - CORNER, left: inset - CORNER }
      : null,
    owns(tiles, col + 1, row - 1) && owns(tiles, col, row - 1) && owns(tiles, col + 1, row)
      ? { top: inset - CORNER, right: inset - CORNER }
      : null,
    owns(tiles, col - 1, row + 1) && owns(tiles, col, row + 1) && owns(tiles, col - 1, row)
      ? { bottom: inset - CORNER, left: inset - CORNER }
      : null,
    owns(tiles, col + 1, row + 1) && owns(tiles, col, row + 1) && owns(tiles, col + 1, row)
      ? { bottom: inset - CORNER, right: inset - CORNER }
      : null,
  ].filter((corner) => corner != null);

  if (corners.length === 0) {
    return null;
  }

  return (
    <>
      {corners.map((corner, index) => (
        <View key={index} pointerEvents="none" style={[styles.fillet, { width: size, height: size }, corner]} />
      ))}
    </>
  );
}

/** Rounded brown fill behind one owned plot. Drawn for every plot, then the plot covers the middle. */
export function GardenShapeBorder({
  tiles,
  col,
  row,
}: {
  tiles: TilePoint[];
  col: number;
  row: number;
}) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.fill,
        {
          top: -reach(owns(tiles, col, row - 1)),
          right: -reach(owns(tiles, col + 1, row)),
          bottom: -reach(owns(tiles, col, row + 1)),
          left: -reach(owns(tiles, col - 1, row)),
        },
      ]}
    />
  );
}

/** Same grid as the plots, painted underneath so every plot gets a rounded brown fill. */
export function GardenBed({
  tiles,
  minCol,
  minRow,
  columns,
  rows,
  cellSize,
}: {
  tiles: TilePoint[];
  minCol: number;
  minRow: number;
  columns: number;
  rows: number;
  cellSize?: number;
}) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.bed]}>
      {Array.from({ length: rows }, (_, rowOffset) => (
        <View key={rowOffset} style={cellSize ? styles.fixedRow : styles.row}>
          {Array.from({ length: columns }, (_, columnOffset) => {
            const col = minCol + columnOffset;
            const row = minRow + rowOffset;
            const owned = owns(tiles, col, row);
            return (
              <View
                key={`${col}:${row}`}
                style={cellSize ? { width: cellSize, height: cellSize } : styles.cell}>
                {owned ? <GardenShapeBorder tiles={tiles} col={col} row={row} /> : <ConcaveFillets tiles={tiles} col={col} row={row} />}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bed: {
    gap: GARDEN_SLOT_GAP,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: GARDEN_SLOT_GAP,
  },
  fixedRow: {
    flexDirection: 'row',
    gap: GARDEN_SLOT_GAP,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
  },
  fill: {
    position: 'absolute',
    backgroundColor: GardenPalette.woodOuter,
    borderRadius: CORNER,
  },
  fillet: {
    position: 'absolute',
    backgroundColor: GardenPalette.woodOuter,
    borderRadius: CORNER,
  },
});
