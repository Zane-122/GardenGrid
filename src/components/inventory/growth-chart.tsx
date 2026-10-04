import { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { matchFont } from '@shopify/react-native-skia';
import { CartesianChart, Line, Scatter } from 'victory-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { evaluateGrowthCurve, type GrowthCurveParams } from '@/utils/growth-curve';
import type { PlantAgeAnchor } from '@/utils/plants';

type GrowthChartProps = {
  params: GrowthCurveParams | null;
  /** When this plant was added — fallback age reference if there's no ageAnchor yet. */
  createdAt: string | null | undefined;
  /**
   * The plant's most recent AI-estimated age (from its latest photo), if any.
   * The AI only estimates age at upload time; between uploads the current
   * age is derived by advancing this anchor with real elapsed time, not by
   * re-estimating.
   */
  ageAnchor: PlantAgeAnchor | null;
};

type ChartDatum = {
  x: number;
  y: number;
  marker: number | null;
};

const CHART_HEIGHT = 220;
const WINDOW_DAYS = 30;
const SAMPLE_COUNT = 60;

const GROWTH_MODE_LABEL: Record<GrowthCurveParams['growth_mode'], string> = {
  annual_bounded: 'Grows to a stable size and holds',
  woody_residual: 'Keeps slowly growing over time',
  cyclical: 'Dies back and regrows each cycle',
};

function plantAgeInDays(createdAt: string | null | undefined, ageAnchor: PlantAgeAnchor | null): number | null {
  if (ageAnchor) {
    const observed = new Date(ageAnchor.observedAt);
    if (!Number.isNaN(observed.getTime())) {
      return (Date.now() - observed.getTime()) / 86_400_000 + ageAnchor.resolvedXPosition;
    }
  }

  // No AI-estimated anchor yet (no photo uploaded) — assume it's fresh as of adding it.
  if (!createdAt) {
    return null;
  }
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) {
    return null;
  }
  return (Date.now() - created.getTime()) / 86_400_000;
}

const Y_HEADROOM = 20;

function buildChartData(
  params: GrowthCurveParams,
  ageDays: number
): { data: ChartDatum[]; xDomain: [number, number]; yDomain: [number, number] } {
  const domainStart = Math.max(0, ageDays - WINDOW_DAYS);
  const domainEnd = ageDays + WINDOW_DAYS;

  const xs = new Set<number>();
  for (let i = 0; i <= SAMPLE_COUNT; i += 1) {
    xs.add(domainStart + (i / SAMPLE_COUNT) * (domainEnd - domainStart));
  }
  xs.add(ageDays);

  const currentY = evaluateGrowthCurve(params, ageDays);

  const data = [...xs]
    .sort((a, b) => a - b)
    .map((x) => ({
      x,
      y: evaluateGrowthCurve(params, x),
      marker: Math.abs(x - ageDays) < 1e-6 ? currentY : null,
    }));

  return { data, xDomain: [domainStart, domainEnd], yDomain: [0, currentY + Y_HEADROOM] };
}

export function GrowthChart({ params, createdAt, ageAnchor }: GrowthChartProps) {
  const theme = useTheme();

  const font = useMemo(
    () =>
      matchFont({
        fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }),
        fontSize: 11,
      }),
    []
  );

  const ageDays = useMemo(() => plantAgeInDays(createdAt, ageAnchor), [createdAt, ageAnchor]);

  const chart = useMemo(() => {
    if (!params || ageDays == null) {
      return null;
    }
    return buildChartData(params, ageDays);
  }, [params, ageDays]);

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <SymbolView
          tintColor={theme.wood}
          name={{ ios: 'chart.xyaxis.line', android: 'show_chart', web: 'show_chart' }}
          size={18}
        />
        <ThemedText type="smallBold">Growth curve</ThemedText>
      </View>

      {!params || !chart || ageDays == null ? (
        <ThemedText themeColor="textSecondary">
          Still figuring out this plant&rsquo;s growth curve. Add a photo to help estimate it.
        </ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {GROWTH_MODE_LABEL[params.growth_mode]}
          </ThemedText>

          <View style={styles.chart}>
            <CartesianChart
              data={chart.data}
              xKey="x"
              yKeys={['y', 'marker']}
              domainPadding={{ left: 8, right: 8, top: 12, bottom: 0 }}
              domain={{ x: chart.xDomain, y: chart.yDomain }}
              axisOptions={{
                font,
                labelColor: theme.textSecondary,
                lineColor: theme.border,
                formatXLabel: (value) => `d${Math.round(Number(value))}`,
                formatYLabel: (value) => `${Math.round(Number(value))}`,
              }}>
              {({ points }) => (
                <>
                  <Line points={points.y} color={theme.primary} strokeWidth={3} curveType="natural" animate={{ type: 'timing', duration: 300 }} />
                  <Scatter points={points.marker} color={theme.accent} radius={6} style="fill" />
                </>
              )}
            </CartesianChart>
          </View>

          <ThemedText type="small" themeColor="textSecondary">
            Today (day {Math.round(ageDays)}): ~{Math.round(evaluateGrowthCurve(params, ageDays))} cm² of leaf area.
          </ThemedText>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  chart: {
    height: CHART_HEIGHT,
    width: '100%',
  },
});
