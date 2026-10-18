import * as Location from 'expo-location';

import { supabase } from '@/utils/supabase';

export type GardenCoordinates = {
  latitude: number;
  longitude: number;
};

export async function requestGardenLocationPermission() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getGardenCoordinates(): Promise<GardenCoordinates | null> {
  const permission = await Location.getForegroundPermissionsAsync();
  const granted =
    permission.status === 'granted' || (await requestGardenLocationPermission());

  if (!granted) {
    return null;
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

export async function saveGardenLocation(coordinates: GardenCoordinates) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) {
    throw sessionError;
  }
  if (!session?.access_token) {
    return;
  }

  const { error } = await supabase.functions.invoke('save-garden-location', {
    body: coordinates,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    throw error;
  }
}
