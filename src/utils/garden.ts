import { supabase } from '@/utils/supabase';

export const GARDEN_COLUMNS = 4;
export const GARDEN_ROWS = 3;
export const GARDEN_SLOT_COUNT = GARDEN_COLUMNS * GARDEN_ROWS;
export const GARDEN_SLOT_GAP = 6;
export const GARDEN_MIN_CELL = 44;
export const GARDEN_MAX_CELL = 112;
export const GARDEN_FRAME_PAD = 10;
export const GARDEN_BED_PAD = 8;

export function gardenBoardSize(innerWidth: number, maxInnerHeight: number) {
  const gapX = GARDEN_SLOT_GAP * (GARDEN_COLUMNS - 1);
  const gapY = GARDEN_SLOT_GAP * (GARDEN_ROWS - 1);
  const fromWidth = (innerWidth - gapX) / GARDEN_COLUMNS;
  const fromHeight = (maxInnerHeight - gapY) / GARDEN_ROWS;
  const cell = Math.max(GARDEN_MIN_CELL, Math.min(GARDEN_MAX_CELL, fromWidth, fromHeight));

  return {
    cell,
    width: cell * GARDEN_COLUMNS + gapX,
    height: cell * GARDEN_ROWS + gapY,
  };
}

export type GardenSlot = {
  id: string;
  user_id: string;
  plant_id: string;
  slot_index: number;
  created_at: string;
};

export function isGardenSlotIndex(value: number) {
  return Number.isInteger(value) && value >= 0 && value < GARDEN_SLOT_COUNT;
}

export async function listGardenSlots() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }
  if (!user) {
    throw new Error('You need to be signed in to view your garden');
  }

  const { data, error } = await supabase
    .from('garden_slots')
    .select('id, user_id, plant_id, slot_index, created_at')
    .eq('user_id', user.id)
    .order('slot_index', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as GardenSlot[];
}

export async function assignPlantToSlot(plantId: string, slotIndex: number) {
  if (!isGardenSlotIndex(slotIndex)) {
    throw new Error('That garden slot does not exist');
  }

  const { error } = await supabase.rpc('assign_garden_slot', {
    target_plant_id: plantId,
    target_slot_index: slotIndex,
  });

  if (error) {
    throw error;
  }
}

export async function clearGardenSlot(slotIndex: number) {
  if (!isGardenSlotIndex(slotIndex)) {
    throw new Error('That garden slot does not exist');
  }

  const { error } = await supabase.rpc('clear_garden_slot', {
    target_slot_index: slotIndex,
  });

  if (error) {
    throw error;
  }
}

export function slotIndexForPlant(slots: GardenSlot[], plantId: string) {
  return slots.find((slot) => slot.plant_id === plantId)?.slot_index ?? null;
}
