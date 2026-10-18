import { useEffect } from 'react';

import { getGardenCoordinates, saveGardenLocation } from '@/utils/location';

export function useRequestGardenLocation() {
  useEffect(() => {
    void (async () => {
      try {
        const coordinates = await getGardenCoordinates();
        if (coordinates) {
          await saveGardenLocation(coordinates);
        }
      } catch (error) {
        console.warn('Could not save garden location', error);
      }
    })();
  }, []);
}
