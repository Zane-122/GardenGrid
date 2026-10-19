import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type PlantTab = 'details' | 'ai';

const TABS: { key: PlantTab; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'ai', label: 'AI' },
];

type PlantTabsProps = {
  value: PlantTab;
  onChange: (tab: PlantTab) => void;
};

export function PlantTabs({ value, onChange }: PlantTabsProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.row, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {TABS.map((tab) => {
        const selected = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [
              styles.tab,
              selected && { backgroundColor: theme.primary },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold" style={{ color: selected ? theme.onPrimary : theme.text }}>
              {tab.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.one,
    gap: Spacing.one,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
});
