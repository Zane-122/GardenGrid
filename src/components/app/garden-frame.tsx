import { type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type GardenFrameProps = {
  children: ReactNode;
  variant?: 'bed' | 'plot';
  padded?: boolean;
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

export function GardenFrame({
  children,
  variant = 'plot',
  padded = true,
  fill = false,
  style,
  contentStyle,
}: GardenFrameProps) {
  const theme = useTheme();

  if (variant === 'bed') {
    return (
      <View
        style={[
          styles.bedOuter,
          { backgroundColor: theme.woodOuter, borderColor: theme.woodEdge },
          bedShadow(theme.shadow),
          style,
        ]}>
        <View
          style={[
            styles.bedWood,
            fill && styles.fill,
            { backgroundColor: theme.wood, borderColor: theme.woodEdge },
          ]}>
          <View
            style={[
              styles.inner,
              fill && styles.fill,
              padded && styles.padded,
              { backgroundColor: theme.surface, borderColor: theme.plotLine },
              contentStyle,
            ]}>
            {children}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.plotOuter, { backgroundColor: theme.woodOuter, borderColor: theme.woodEdge }, style]}>
      <View
        style={[
          styles.inner,
          padded && styles.padded,
          { backgroundColor: theme.surface, borderColor: theme.wood },
          contentStyle,
        ]}>
        {children}
      </View>
    </View>
  );
}

function bedShadow(color: string): ViewStyle {
  return (
    Platform.select({
      web: { boxShadow: `0px 4px 10px ${color}` },
      default: {
        shadowColor: color,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 10,
        elevation: 4,
      },
    }) ?? {}
  );
}

const styles = StyleSheet.create({
  bedOuter: {
    padding: 3,
    borderWidth: 1,
    borderRadius: 12,
  },
  bedWood: {
    padding: 8,
    borderWidth: 1,
    borderRadius: 9,
  },
  plotOuter: {
    padding: 2,
    borderWidth: 1,
    borderRadius: 10,
  },
  inner: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  padded: {
    padding: Spacing.three,
  },
  fill: {
    flex: 1,
  },
});
