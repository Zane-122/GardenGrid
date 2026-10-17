import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { getPollenBalance } from '@/utils/plants';

export const CURRENCY_BAR_BODY = 48;

function formatPollen(value: number) {
  if (value >= 10) {
    return Math.round(value).toLocaleString();
  }
  return value.toFixed(1);
}

export function CurrencyBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const [pollenCm3, setPollenCm3] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setPollenCm3(await getPollenBalance());
    } catch {
      setPollenCm3(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const amount = pollenCm3 == null ? '…' : `${formatPollen(pollenCm3)} cm³`;

  return (
    <View
      style={[
        styles.bar,
        {
          paddingTop: insets.top,
          backgroundColor: theme.surface,
          borderBottomColor: theme.border,
        },
      ]}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void signOut()}
          hitSlop={8}
          style={({ pressed }) => [pressed && styles.pressed]}>
          <ThemedText type="small" themeColor="textSecondary">
            Log out
          </ThemedText>
        </Pressable>
        <View style={[styles.pollen, { backgroundColor: theme.backgroundElement }]}>
          <View style={[styles.dot, { backgroundColor: theme.primary }]} />
          <ThemedText type="smallBold" numberOfLines={1}>
            Pollen {amount}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: 1,
  },
  row: {
    height: CURRENCY_BAR_BODY,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  pollen: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    height: 32,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pressed: {
    opacity: 0.6,
  },
});
