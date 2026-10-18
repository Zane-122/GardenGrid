import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { GardenPalette, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { gardenMix, useGardenHalfway, useGardenMixDriver } from '@/hooks/use-garden-mix';
import { useTheme } from '@/hooks/use-theme';
import { getCurrencyBalances, onCurrencyChanged } from '@/utils/plants';

export const CURRENCY_BAR_BODY = 48;

function formatAmount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  if (value >= 10) {
    return Math.round(value).toString();
  }
  return value.toFixed(1);
}

export function CurrencyBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  useGardenMixDriver();
  const garden = useGardenHalfway();
  const textColor = garden ? { color: GardenPalette.barText } : null;
  const mutedColor = garden ? { color: GardenPalette.barTextMuted } : null;
  const barStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(gardenMix.value, [0, 1], [theme.surface, GardenPalette.bar]),
    borderBottomColor: interpolateColor(gardenMix.value, [0, 1], [theme.border, GardenPalette.barBorder]),
  }));
  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(gardenMix.value, [0, 1], [theme.backgroundElement, GardenPalette.barPill]),
  }));
  const [balances, setBalances] = useState<{ pollen: number; oxygen: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setBalances(await getCurrencyBalances());
    } catch {
      setBalances(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => onCurrencyChanged(() => void load()), [load]);

  const pollenAmount = balances == null ? '…' : `${formatAmount(balances.pollen)} mg`;
  const oxygenAmount = balances == null ? '…' : `${formatAmount(balances.oxygen)} mL`;

  return (
    <Animated.View style={[styles.bar, { paddingTop: insets.top }, barStyle]}>
      <StatusBar style={garden ? 'light' : 'auto'} />
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void signOut()}
          hitSlop={8}
          style={({ pressed }) => [pressed && styles.pressed]}>
          <ThemedText type="small" themeColor="textSecondary" style={mutedColor}>
            Log out
          </ThemedText>
        </Pressable>
        <View style={styles.currencies}>
          <Animated.View style={[styles.pill, pillStyle]}>
            <View style={[styles.dot, { backgroundColor: theme.oxygen }]} />
            <ThemedText type="smallBold" numberOfLines={1} style={textColor}>
              Oxygen: {oxygenAmount}
            </ThemedText>
          </Animated.View>
          <Animated.View style={[styles.pill, pillStyle]}>
            <View style={[styles.dot, { backgroundColor: theme.pollen }]} />
            <ThemedText type="smallBold" numberOfLines={1} style={textColor}>
              Pollen: {pollenAmount}
            </ThemedText>
          </Animated.View>
        </View>
      </View>
    </Animated.View>
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
  currencies: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  pill: {
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
