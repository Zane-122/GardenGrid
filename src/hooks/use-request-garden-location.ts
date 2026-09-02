import { useEffect } from 'react';

import { requestGardenLocationPermission } from '@/utils/location';

export function useRequestGardenLocation() {
  useEffect(() => {
    void requestGardenLocationPermission();
  }, []);
}
