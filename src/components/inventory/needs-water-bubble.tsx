import { SymbolView } from 'expo-symbols';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type NeedsWaterBubbleProps = {
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function NeedsWaterBubble({ compact = false, style }: NeedsWaterBubbleProps) {
  const theme = useTheme();
  const size = compact ? 22 : 28;

  return (
    <View
      accessibilityLabel="Needs water"
      style={[
        styles.bubble,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.info,
          borderColor: theme.surface,
        },
        style,
      ]}>
      <SymbolView
        name={{ ios: 'drop.fill', android: 'water_drop', web: 'water_drop' }}
        tintColor={theme.onInfo}
        size={compact ? 12 : 14}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});
