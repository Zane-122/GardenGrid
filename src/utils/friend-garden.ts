import {
  PLANT_PHOTOS_BUCKET,
  type InventoryPlant,
  type PlantBasicInfo,
} from "@/utils/plants";
import type { GardenSlot, GardenTile } from "@/utils/garden";
import { type ItemRotation, type OwnedShopItem } from "@/utils/shop-items";
import { supabase } from "@/utils/supabase";

const PHOTO_TTL_SECONDS = 60 * 60;

/** A friend's placed garden. Unplaced plants and tiles are not included. */
export async function listFriendGarden(userId: string) {
  const [tilesResult, slotsResult, plantsResult, itemsResult] = await Promise.all([
    supabase
      .from("garden_tiles")
      .select("id, user_id, col, row, garden:gardens!inner(kind)")
      .eq("user_id", userId)
      .eq("garden.kind", "personal")
      .order("row", { ascending: true })
      .order("col", { ascending: true }),
    supabase
      .from("garden_slots")
      .select("id, user_id, plant_id, tile_id, created_at, tile:garden_tiles!inner(col, row, garden:gardens!inner(kind))")
      .eq("user_id", userId)
      .eq("tile.garden.kind", "personal"),
    supabase
      .from("plants")
      .select(
        "id, user_id, plant_id, created_at, photo_path, last_recalibrated_at, current_x_position, flower_ratio, pollen_per_flower_mg, flower_count, flower_count_updated_at, oxygen_ml, pollen_mg, info:plant_basic_info(*)",
      )
      .eq("user_id", userId),
    supabase
      .from("user_shop_items")
      .select(
        "id, user_id, shop_item_id, garden_tile_id, rotation, item:shop_items(slug, name, image_path, footprint_cols, footprint_rows), tile:garden_tiles!user_shop_items_garden_tile_id_fkey(col, row, garden:gardens(kind))",
      )
      .eq("user_id", userId),
  ]);

  if (tilesResult.error) {
    throw tilesResult.error;
  }
  if (slotsResult.error) {
    throw slotsResult.error;
  }
  if (plantsResult.error) {
    throw plantsResult.error;
  }
  if (itemsResult.error) {
    throw itemsResult.error;
  }

  const tiles = (tilesResult.data ?? []).map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id),
    col: Number(row.col),
    row: Number(row.row),
  })) satisfies GardenTile[];

  const slots = (slotsResult.data ?? []).map((row) => {
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

  const plantRows = plantsResult.data ?? [];
  const photoPaths = plantRows
    .map((row) => row.photo_path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);
  const signed = await signPhotos(photoPaths);

  const plants = plantRows.map((row) => {
    const photoPath = (row.photo_path as string | null) ?? null;
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      plant_id: String(row.plant_id),
      created_at: String(row.created_at),
      photo_path: photoPath,
      last_recalibrated_at: (row.last_recalibrated_at as string | null) ?? null,
      current_x_position: (row.current_x_position as number | null) ?? null,
      flower_ratio: (row.flower_ratio as number | null) ?? null,
      pollen_per_flower_mg: (row.pollen_per_flower_mg as number | null) ?? null,
      flower_count: (row.flower_count as number | null) ?? null,
      flower_count_updated_at: (row.flower_count_updated_at as string | null) ?? null,
      oxygen_ml: Number(row.oxygen_ml ?? 0),
      pollen_mg: Number(row.pollen_mg ?? 0),
      info: (Array.isArray(row.info) ? row.info[0] : row.info) as PlantBasicInfo | null,
      photo_url: photoPath ? (signed.get(photoPath) ?? null) : null,
    };
  }) satisfies InventoryPlant[];

  const items = (itemsResult.data ?? []).map((row) => {
    const item = Array.isArray(row.item) ? row.item[0] : row.item;
    const tile = Array.isArray(row.tile) ? row.tile[0] : row.tile;
    const garden = Array.isArray(tile?.garden) ? tile.garden[0] : tile?.garden;
    const onPersonalGarden = garden?.kind === "personal";
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      shop_item_id: String(row.shop_item_id),
      garden_tile_id: row.garden_tile_id ? String(row.garden_tile_id) : null,
      col: onPersonalGarden && tile?.col != null ? Number(tile.col) : null,
      row: onPersonalGarden && tile?.row != null ? Number(tile.row) : null,
      name: String(item?.name ?? "Item"),
      slug: String(item?.slug ?? ""),
      image_path: String(item?.image_path ?? ""),
      footprint_cols: Number(item?.footprint_cols ?? 1),
      footprint_rows: Number(item?.footprint_rows ?? 1),
      rotation: (Number(row.rotation ?? 0) % 360) as ItemRotation,
    };
  }) satisfies OwnedShopItem[];

  return { tiles, slots, plants, items };
}

async function signPhotos(paths: string[]) {
  const unique = [...new Set(paths)];
  if (unique.length === 0) {
    return new Map<string, string>();
  }
  const { data, error } = await supabase.storage
    .from(PLANT_PHOTOS_BUCKET)
    .createSignedUrls(unique, PHOTO_TTL_SECONDS);
  if (error || !data) {
    return new Map<string, string>();
  }
  return new Map(
    data
      .filter((item) => item.path && item.signedUrl && !item.error)
      .map((item) => [item.path as string, item.signedUrl as string]),
  );
}
