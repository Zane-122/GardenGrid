import * as Location from 'expo-location';

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
