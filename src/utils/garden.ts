import { Platform } from 'react-native';

import { notifyCurrencyChanged } from '@/utils/plants';
import { supabase } from '@/utils/supabase';

export const GARDEN_COLUMNS = 3;
export const GARDEN_ROWS = 4;
export const GARDEN_SLOT_COUNT = GARDEN_COLUMNS * GARDEN_ROWS;
/** Phone plots sit closer together so the gap does not swallow a small cell. */
export const GARDEN_SLOT_GAP = Platform.OS === 'web' ? 6 : 2;
export const GARDEN_MIN_CELL = 44;
export const GARDEN_FRAME_PAD = 10;
export const GARDEN_BED_PAD = 8;

const TILE_OXYGEN_BASE = 1000;
const TILE_OXYGEN_STEP = 250;
const TILE_POLLEN_BASE = 100;
const TILE_POLLEN_STEP = 25;

export function gardenBoardSize(innerWidth: number, maxInnerHeight: number, columns = GARDEN_COLUMNS, rows = GARDEN_ROWS) {
  const gapX = GARDEN_SLOT_GAP * Math.max(0, columns - 1);
  const gapY = GARDEN_SLOT_GAP * Math.max(0, rows - 1);
  const fromWidth = columns > 0 ? (innerWidth - gapX) / columns : GARDEN_MIN_CELL;
  const fromHeight = rows > 0 ? (maxInnerHeight - gapY) / rows : GARDEN_MIN_CELL;
  const fitted = Math.min(fromWidth, fromHeight);
  const cell = Number.isFinite(fitted) && fitted > 0 ? fitted : GARDEN_MIN_CELL;

  return {
    cell,
    width: cell * columns + gapX,
    height: cell * rows + gapY,
  };
}

export type GardenTile = {
  id: string;
  user_id: string;
  col: number;
  row: number;
};

export type GardenSlot = {
  id: string;
  user_id: string;
  plant_id: string;
  tile_id: string;
  col: number;
  row: number;
  created_at: string;
};

export function tileKey(col: number, row: number) {
  return `${col}:${row}`;
}

export function gardenTilePrice(ownedCount: number) {
  const purchased = Math.max(0, ownedCount - GARDEN_SLOT_COUNT);
  return {
    oxygen: TILE_OXYGEN_BASE + TILE_OXYGEN_STEP * purchased,
    pollen: TILE_POLLEN_BASE + TILE_POLLEN_STEP * purchased,
  };
}

/** Price of the next `count` plots, each one higher than the last. */
export function gardenTilesPrice(ownedCount: number, count: number) {
  const lines = Array.from({ length: Math.max(0, count) }, (_, index) => gardenTilePrice(ownedCount + index));
  return {
    oxygen: lines.reduce((sum, line) => sum + line.oxygen, 0),
    pollen: lines.reduce((sum, line) => sum + line.pollen, 0),
    lines,
  };
}

/** Keep selected plots that still touch the garden, in the order they were picked. */
export function connectedPlotKeys(owned: { col: number; row: number }[], selected: string[]) {
  const ownedKeys = new Set(owned.map((tile) => tileKey(tile.col, tile.row)));
  const selectedSet = new Set(selected);
  const reached = new Set<string>();
  const queue = [...ownedKeys];

  while (queue.length > 0) {
    const key = queue.pop();
    if (!key) {
      continue;
    }
    const [col, row] = key.split(':').map(Number);
    for (const next of [
      tileKey(col + 1, row),
      tileKey(col - 1, row),
      tileKey(col, row + 1),
      tileKey(col, row - 1),
    ]) {
      if (selectedSet.has(next) && !reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }

  return selected.filter((key) => reached.has(key));
}

export function isOutskirtsTile(tiles: Pick<GardenTile, 'col' | 'row'>[], col: number, row: number) {
  if (tiles.some((tile) => tile.col === col && tile.row === row)) {
    return false;
  }

  return tiles.some(
    (tile) =>
      (tile.col === col && Math.abs(tile.row - row) === 1) ||
      (tile.row === row && Math.abs(tile.col - col) === 1)
  );
}

/** Bounding box of owned plots. Pass padding to include the outskirts ring. */
export function gardenViewBounds(tiles: Pick<GardenTile, 'col' | 'row'>[], padding = 0) {
  if (tiles.length === 0) {
    return {
      minCol: 0 - padding,
      maxCol: GARDEN_COLUMNS - 1 + padding,
      minRow: 0 - padding,
      maxRow: GARDEN_ROWS - 1 + padding,
    };
  }

  const cols = tiles.map((tile) => tile.col);
  const rows = tiles.map((tile) => tile.row);
  return {
    minCol: Math.min(...cols) - padding,
    maxCol: Math.max(...cols) + padding,
    minRow: Math.min(...rows) - padding,
    maxRow: Math.max(...rows) + padding,
  };
}

async function requireUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }
  if (!user) {
    throw new Error('You need to be signed in to view your garden');
  }

  return user;
}

export async function listGardenTiles() {
  const user = await requireUser();
  const loaded = await selectGardenTiles(user.id);
  if (loaded.length > 0) {
    return loaded;
  }

  const { error } = await supabase.rpc('ensure_starter_garden');
  if (error) {
    throw error;
  }

  return selectGardenTiles(user.id);
}

async function selectGardenTiles(userId: string) {
  const { data, error } = await supabase
    .from('garden_tiles')
    .select('id, user_id, col, row')
    .eq('user_id', userId)
    .order('row', { ascending: true })
    .order('col', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id),
    col: Number(row.col),
    row: Number(row.row),
  })) satisfies GardenTile[];
}

export async function listGardenSlots() {
  const user = await requireUser();
  const { data, error } = await supabase
    .from('garden_slots')
    .select('id, user_id, plant_id, tile_id, created_at, tile:garden_tiles(col, row)')
    .eq('user_id', user.id);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => {
    const tile = Array.isArray(row.tile) ? row.tile[0] : row.tile;
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      plant_id: String(row.plant_id),
      tile_id: String(row.tile_id),
      col: Number(tile?.col),
      row: Number(tile?.row),
      created_at: String(row.created_at),
    };
  }) satisfies GardenSlot[];
}

export async function assignPlantToSlot(plantId: string, col: number, row: number) {
  const { error } = await supabase.rpc('assign_garden_slot', {
    target_plant_id: plantId,
    target_col: col,
    target_row: row,
  });

  if (error) {
    throw error;
  }
}

export async function clearGardenSlot(col: number, row: number) {
  const { error } = await supabase.rpc('clear_garden_slot', {
    target_col: col,
    target_row: row,
  });

  if (error) {
    throw error;
  }
}

export async function buyGardenTile(col: number, row: number) {
  await buyGardenTiles([{ col, row }]);
}

export async function buyGardenTiles(cells: { col: number; row: number }[]) {
  const { error } = await supabase.rpc('buy_garden_tiles', {
    targets: cells,
  });

  if (error) {
    throw error;
  }

  notifyCurrencyChanged();
}

export function slotForPlant(slots: GardenSlot[], plantId: string) {
  return slots.find((slot) => slot.plant_id === plantId) ?? null;
}
