import { notifyCurrencyChanged } from '@/utils/plants';
import { supabase } from '@/utils/supabase';

const SHOP_ITEMS_BUCKET = 'shop-items';

/** Decoration art bundled with the app, keyed by shop_items.image_path. Edit the files in assets/images/decoritems. */
const BUNDLED_ITEM_IMAGES: Record<string, number> = {
  'stone-path.jpg': require('@/assets/images/decoritems/stone-path.jpg'),
  'bench.png': require('@/assets/images/decoritems/bench.png'),
  'light.png': require('@/assets/images/decoritems/light.png'),
  'crate.png': require('@/assets/images/decoritems/crate.png'),
  'barrel.png': require('@/assets/images/decoritems/barrel.png'),
  'sign.png': require('@/assets/images/decoritems/sign.png'),
  'redflower.png': require('@/assets/images/decoritems/redflower.png'),
  'blueflower.png': require('@/assets/images/decoritems/blueflower.png'),
  'fireplace.png': require('@/assets/images/decoritems/fireplace.png'),
  'fountain.png': require('@/assets/images/decoritems/fountain.png'),
};

export type ShopItemImage = number | { uri: string };

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

/** Everything except the paving stone stands on a stone ground tile as free-standing art. */
export function isStandingItem(slug: string) {
  return slug !== 'stone-path';
}

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

export function shopItemImageUrl(imagePath: string): ShopItemImage | null {
  const bundled = BUNDLED_ITEM_IMAGES[imagePath];
  if (bundled != null) {
    return bundled;
  }
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!base) {
    return null;
  }
  return { uri: `${base}/storage/v1/object/public/${SHOP_ITEMS_BUCKET}/${imagePath}` };
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
    .from('user_shop_items')
    .select('id, user_id, shop_item_id, garden_tile_id, rotation, item:shop_items(slug, name, image_path, footprint_cols, footprint_rows), tile:garden_tiles!user_shop_items_garden_tile_id_fkey(col, row, garden:gardens(kind))')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => {
    const item = Array.isArray(row.item) ? row.item[0] : row.item;
    const tile = Array.isArray(row.tile) ? row.tile[0] : row.tile;
    const garden = Array.isArray(tile?.garden) ? tile.garden[0] : tile?.garden;
    const onPersonalGarden = garden?.kind === 'personal';
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      shop_item_id: String(row.shop_item_id),
      garden_tile_id: row.garden_tile_id ? String(row.garden_tile_id) : null,
      col: onPersonalGarden && tile?.col != null ? Number(tile.col) : null,
      row: onPersonalGarden && tile?.row != null ? Number(tile.row) : null,
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
