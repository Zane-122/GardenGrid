import { useEffect, useRef, useState } from 'react';

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Follows `target`, easing from wherever it currently is. The value lives in
 * React state so layout that depends on it (not just styles) can animate.
 */
export function useTweenedNumber(target: number, duration = 260) {
  const [value, setValue] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const from = current.current;
    if (from === target) {
      return;
    }

    const start = Date.now();
    let frame = requestAnimationFrame(function tick() {
      const progress = Math.min(1, (Date.now() - start) / duration);
      current.current = from + (target - from) * easeInOutCubic(progress);
      setValue(current.current);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}
