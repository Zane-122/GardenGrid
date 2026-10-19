import { notifyCurrencyChanged } from '@/utils/plants';
import { supabase } from '@/utils/supabase';

const SHOP_ITEMS_BUCKET = 'shop-items';

export type ShopItem = {
  id: string;
  slug: string;
  name: string;
  description: string;
  oxygen_cost: number;
  image_path: string;
  footprint_cols: number;
  footprint_rows: number;
};

export type ItemRotation = 0 | 90 | 180 | 270;

export type OwnedShopItem = {
  id: string;
  user_id: string;
  shop_item_id: string;
  garden_tile_id: string | null;
  col: number | null;
  row: number | null;
  name: string;
  slug: string;
  image_path: string;
  footprint_cols: number;
  footprint_rows: number;
  rotation: ItemRotation;
};

export function itemSpan(item: {
  footprint_cols: number;
  footprint_rows: number;
  rotation: number;
}) {
  const turned = item.rotation === 90 || item.rotation === 270;
  return {
    cols: turned ? item.footprint_rows : item.footprint_cols,
    rows: turned ? item.footprint_cols : item.footprint_rows,
  };
}

export function itemCells(
  anchorCol: number,
  anchorRow: number,
  item: { footprint_cols: number; footprint_rows: number; rotation: number },
) {
  const span = itemSpan(item);
  const cells: { col: number; row: number }[] = [];
  for (let rowOffset = 0; rowOffset < span.rows; rowOffset += 1) {
    for (let colOffset = 0; colOffset < span.cols; colOffset += 1) {
      cells.push({ col: anchorCol + colOffset, row: anchorRow + rowOffset });
    }
  }
  return cells;
}

export function itemCovers(item: OwnedShopItem, col: number, row: number) {
  if (item.col == null || item.row == null) {
    return false;
  }
  const span = itemSpan(item);
  return (
    col >= item.col &&
    col < item.col + span.cols &&
    row >= item.row &&
    row < item.row + span.rows
  );
}

export function shopItemImageUrl(imagePath: string) {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!base) {
    return null;
  }
  return `${base}/storage/v1/object/public/${SHOP_ITEMS_BUCKET}/${imagePath}`;
}

export async function listShopItems() {
  const { data, error } = await supabase
    .from('shop_items')
    .select('id, slug, name, description, oxygen_cost, image_path, footprint_cols, footprint_rows')
    .order('oxygen_cost', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description),
    oxygen_cost: Number(row.oxygen_cost),
    image_path: String(row.image_path),
    footprint_cols: Number(row.footprint_cols ?? 1),
    footprint_rows: Number(row.footprint_rows ?? 1),
  })) satisfies ShopItem[];
}

export async function listOwnedShopItems() {
  const { data, error } = await supabase
    .from('user_shop_items')
    .select('id, user_id, shop_item_id, garden_tile_id, rotation, item:shop_items(slug, name, image_path, footprint_cols, footprint_rows), tile:garden_tiles!user_shop_items_garden_tile_id_fkey(col, row)')
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => {
    const item = Array.isArray(row.item) ? row.item[0] : row.item;
    const tile = Array.isArray(row.tile) ? row.tile[0] : row.tile;
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      shop_item_id: String(row.shop_item_id),
      garden_tile_id: row.garden_tile_id ? String(row.garden_tile_id) : null,
      col: tile?.col == null ? null : Number(tile.col),
      row: tile?.row == null ? null : Number(tile.row),
      name: String(item?.name ?? 'Item'),
      slug: String(item?.slug ?? ''),
      image_path: String(item?.image_path ?? ''),
      footprint_cols: Number(item?.footprint_cols ?? 1),
      footprint_rows: Number(item?.footprint_rows ?? 1),
      rotation: (Number(row.rotation ?? 0) % 360) as ItemRotation,
    };
  }) satisfies OwnedShopItem[];
}

export async function buyShopItem(shopItemId: string, copies = 1) {
  const { error } = await supabase.rpc('buy_shop_item', { target_item: shopItemId, copies });
  if (error) {
    throw error;
  }
  notifyCurrencyChanged();
}

export async function placeOwnedShopItem(ownedId: string, col: number, row: number) {
  const { error } = await supabase.rpc('place_user_shop_item', {
    owned_item_id: ownedId,
    target_col: col,
    target_row: row,
  });
  if (error) {
    throw error;
  }
}

export async function rotateOwnedShopItem(ownedId: string) {
  const { error } = await supabase.rpc('rotate_user_shop_item', { owned_item_id: ownedId });
  if (error) {
    throw error;
  }
}

export async function clearOwnedShopItem(ownedId: string) {
  const { error } = await supabase.rpc('clear_user_shop_item', { owned_item_id: ownedId });
  if (error) {
    throw error;
  }
}
