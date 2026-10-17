import { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

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
  padded = true,
  fill = false,
  style,
  contentStyle,
}: GardenFrameProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.frame,
        fill && styles.fill,
        { backgroundColor: theme.surface, borderColor: theme.border },
        style,
      ]}>
      <View style={[fill && styles.fill, padded && styles.padded, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  padded: {
    padding: Spacing.three,
  },
  fill: {
    flex: 1,
  },
});
