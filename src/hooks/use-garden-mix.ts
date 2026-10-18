import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Easing,
  makeMutable,
  runOnJS,
  useAnimatedReaction,
  withTiming,
} from 'react-native-reanimated';

const DURATION = 320;

/** 0 on every page but the grid, 1 on the grid; tweened as you move between them. */
export const gardenMix = makeMutable(0);

/** Call once from a component that is always mounted. */
export function useGardenMixDriver() {
  const garden = usePathname() === '/grid';

  useEffect(() => {
    gardenMix.value = withTiming(garden ? 1 : 0, {
      duration: DURATION,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [garden]);
}

/**
 * True once the transition is past halfway. For values that cannot be
 * interpolated (icon tint, status bar style).
 */
export function useGardenHalfway() {
  const [garden, setGarden] = useState(false);

  useAnimatedReaction(
    () => gardenMix.value > 0.5,
    (next, previous) => {
      if (next !== previous) {
        runOnJS(setGarden)(next);
      }
    },
  );

  return garden;
}
