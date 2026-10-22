import { notifyCurrencyChanged, PLANT_PHOTOS_BUCKET } from '@/utils/plants';
import { supabase } from '@/utils/supabase';

export type CommunityGardenTile = {
  id: string;
  col: number;
  row: number;
};

export type CommunityGardenPlant = {
  id: string;
  name: string;
  col: number;
  row: number;
  ownerId: string;
  ownerName: string;
  photoPath: string | null;
  imageUrl: string | null;
  photoUrl: string | null;
};

export type CommunityGardenItem = {
  id: string;
  name: string;
  slug: string;
  imagePath: string;
  col: number;
  row: number;
  rotation: number;
  footprintCols: number;
  footprintRows: number;
  ownerId: string;
  ownerName: string;
};

export type CommunityGardenContribution = {
  userId: string;
  displayName: string;
  oxygenMl: number;
};

export type CommunityKitPlant = {
  id: string;
  name: string;
  photoPath: string | null;
  imageUrl: string | null;
  photoUrl: string | null;
};

export type CommunityKitItem = {
  id: string;
  name: string;
  slug: string;
  imagePath: string;
  rotation: number;
  footprintCols: number;
  footprintRows: number;
};

export type CommunityGarden = {
  name: string;
  totalOxygen: number;
  tiles: CommunityGardenTile[];
  plants: CommunityGardenPlant[];
  items: CommunityGardenItem[];
  contributions: CommunityGardenContribution[];
  kitPlants: CommunityKitPlant[];
  kitItems: CommunityKitItem[];
};

const PHOTO_TTL_SECONDS = 60 * 60;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getCommunityGarden(communityId: string): Promise<CommunityGarden> {
  const { data, error } = await supabase.rpc('get_community_garden', {
    target_community: communityId,
  });
  if (error) {
    throw error;
  }

  const payload = asRecord(data);
  const plants = asArray(payload.plants).map(parsePlant);
  const kitPlants = asArray(payload.kitPlants).map(parseKitPlant);
  const signed = await signPhotos(
    [...plants, ...kitPlants]
      .map((plant) => plant.photoPath)
      .filter((path): path is string => Boolean(path)),
  );

  return {
    name: text(payload.name, 'Community garden'),
    totalOxygen: numberValue(payload.totalOxygen),
    tiles: asArray(payload.tiles).map((entry) => {
      const row = asRecord(entry);
      return { id: text(row.id), col: numberValue(row.col), row: numberValue(row.row) };
    }),
    plants: plants.map((plant) => ({
      ...plant,
      photoUrl: plant.photoPath ? (signed.get(plant.photoPath) ?? null) : null,
    })),
    items: asArray(payload.items).map(parseItem),
    contributions: asArray(payload.contributions).map((entry) => {
      const row = asRecord(entry);
      return {
        userId: text(row.userId),
        displayName: text(row.displayName, 'Member'),
        oxygenMl: numberValue(row.oxygenMl),
      };
    }),
    kitPlants: kitPlants.map((plant) => ({
      ...plant,
      photoUrl: plant.photoPath ? (signed.get(plant.photoPath) ?? null) : null,
    })),
    kitItems: asArray(payload.kitItems).map((entry) => {
      const row = asRecord(entry);
      return {
        id: text(row.id),
        name: text(row.name, 'Item'),
        slug: text(row.slug),
        imagePath: text(row.imagePath),
        rotation: numberValue(row.rotation),
        footprintCols: Math.max(1, numberValue(row.footprintCols) || 1),
        footprintRows: Math.max(1, numberValue(row.footprintRows) || 1),
      };
    }),
  };
}

export async function buyCommunityPlots(communityId: string, targets: { col: number; row: number }[]) {
  const { error } = await supabase.rpc('buy_community_plots', {
    target_community: communityId,
    targets,
  });
  if (error) {
    throw error;
  }
  notifyCurrencyChanged();
}

export async function donateItemToCommunity(itemId: string, communityId: string, col: number, row: number) {
  const { error } = await supabase.rpc('donate_item_to_community', {
    owned_item_id: itemId,
    target_community: communityId,
    target_col: col,
    target_row: row,
  });
  if (error) {
    throw error;
  }
}

export async function removeItemFromCommunity(itemId: string, communityId: string) {
  const { error } = await supabase.rpc('remove_item_from_community', {
    owned_item_id: itemId,
    target_community: communityId,
  });
  if (error) {
    throw error;
  }
}

export async function moveItemInCommunity(itemId: string, communityId: string, col: number, row: number) {
  const { error } = await supabase.rpc('move_item_in_community', {
    owned_item_id: itemId,
    target_community: communityId,
    target_col: col,
    target_row: row,
  });
  if (error) {
    throw error;
  }
}

export async function placePlantInCommunityGarden(plantId: string, communityId: string, col: number, row: number) {
  const { error } = await supabase.rpc('place_plant_in_community_garden', {
    target_plant_id: plantId,
    target_community: communityId,
    target_col: col,
    target_row: row,
  });
  if (error) {
    throw error;
  }
}

function parsePlant(entry: unknown): CommunityGardenPlant {
  const row = asRecord(entry);
  return {
    id: text(row.id),
    name: text(row.name, 'Plant'),
    col: numberValue(row.col),
    row: numberValue(row.row),
    ownerId: text(row.ownerId),
    ownerName: text(row.ownerName, 'Member'),
    photoPath: typeof row.photoPath === 'string' ? row.photoPath : null,
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : null,
    photoUrl: null,
  };
}

function parseKitPlant(entry: unknown): CommunityKitPlant {
  const row = asRecord(entry);
  return {
    id: text(row.id),
    name: text(row.name, 'Plant'),
    photoPath: typeof row.photoPath === 'string' ? row.photoPath : null,
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : null,
    photoUrl: null,
  };
}

function parseItem(entry: unknown): CommunityGardenItem {
  const row = asRecord(entry);
  return {
    id: text(row.id),
    name: text(row.name, 'Item'),
    slug: text(row.slug),
    imagePath: text(row.imagePath),
    col: numberValue(row.col),
    row: numberValue(row.row),
    rotation: numberValue(row.rotation),
    footprintCols: Math.max(1, numberValue(row.footprintCols) || 1),
    footprintRows: Math.max(1, numberValue(row.footprintRows) || 1),
    ownerId: text(row.ownerId),
    ownerName: text(row.ownerName, 'Member'),
  };
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
