import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

import type { GrowthChartProps } from './growth-curve-chart';

// Skia binds CanvasKit when its module is first imported. On web that has to
// happen after LoadSkiaWeb, or matchFont/useFont crash on TypefaceFontProvider.
export function GrowthChart(props: GrowthChartProps) {
  return (
    <WithSkiaWeb
      opts={{ locateFile: (file) => `/${file}` }}
      getComponent={() =>
        import('./growth-curve-chart').then((mod) => ({ default: mod.GrowthChart }))
      }
      componentProps={props}
      fallback={null}
    />
  );
}
