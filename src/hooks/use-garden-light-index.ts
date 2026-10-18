import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

import { getGardenCoordinates, saveGardenLocation, type GardenCoordinates } from "@/utils/location";
import { estimatedSunlightIndex, resolveSunlightIndex } from "@/utils/sunlight";

const REFRESH_MS = 10 * 60 * 1000;

/** Live 0–1 sunlight index for the garden, matching the oxygen weather reading. */
export function useGardenLightIndex() {
  const [index, setIndex] = useState(() => estimatedSunlightIndex(new Date(), null, null));
  const coordinates = useRef<GardenCoordinates | null>(null);
  const asked = useRef(false);

  const load = useCallback(async () => {
    if (!asked.current) {
      asked.current = true;
      try {
        const next = await getGardenCoordinates();
        coordinates.current = next;
        if (next) {
          void saveGardenLocation(next).catch(() => undefined);
        }
      } catch {
        coordinates.current = null;
      }
    }

    const now = new Date();
    const place = coordinates.current;
    const nextIndex = await resolveSunlightIndex(now, place?.latitude ?? null, place?.longitude ?? null);
    setIndex(nextIndex);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => {
        void load();
      }, REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  return index;
}
