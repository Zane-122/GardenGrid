import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type SoilPanelProps = {
  soilType?: string | null;
};

export function SoilPanel({ soilType }: SoilPanelProps) {
  const theme = useTheme();
  const text = soilType?.trim();

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <SymbolView
          tintColor={theme.wood}
          name={{ ios: 'square.grid.2x2.fill', android: 'grid_view', web: 'grid_view' }}
          size={18}
        />
        <ThemedText type="smallBold">Soil</ThemedText>
      </View>
      <ThemedText themeColor={text ? 'text' : 'textSecondary'}>
        {text || 'No soil information for this plant yet.'}
      </ThemedText>
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
});
