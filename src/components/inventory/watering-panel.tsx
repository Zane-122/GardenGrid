import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { wateringRange, type PlantBasicInfo } from '@/utils/plants';

const WATERING_STEPS = [
  { value: 1, label: 'Dry', hint: 'Let the soil dry out between waterings.' },
  { value: 2, label: 'Medium', hint: 'Keep the soil evenly moist, not soggy.' },
  { value: 3, label: 'Wet', hint: 'Keep the soil consistently wet.' },
] as const;

function wateringHint(min: number, max: number) {
  if (min === max) {
    return WATERING_STEPS.find((step) => step.value === min)?.hint ?? null;
  }
  if (min === 1 && max === 2) {
    return 'Water when the soil is mostly dry, then moisten it through.';
  }
  if (min === 2 && max === 3) {
    return 'Keep the soil moist to wet. Do not let it dry out completely.';
  }
  return 'Water needs range from dry to wet. Watch the soil and adjust.';
}

type WateringPanelProps = {
  watering: PlantBasicInfo['watering'] | undefined;
};

export function WateringPanel({ watering }: WateringPanelProps) {
  const theme = useTheme();
  const range = wateringRange(watering);

  if (!range) {
    return (
      <ThemedText themeColor="textSecondary">No watering information for this plant yet.</ThemedText>
    );
  }

  return (
    <>
      <View style={styles.header}>
        <SymbolView
          tintColor={theme.wood}
          name={{ ios: 'drop.fill', android: 'water_drop', web: 'water_drop' }}
          size={18}
        />
        <ThemedText type="smallBold">Watering</ThemedText>
      </View>

      <ThemedText type="heading" style={styles.label}>
        {range.label}
      </ThemedText>

      <View style={styles.meter}>
        {WATERING_STEPS.map((step) => {
          const active = step.value >= range.min && step.value <= range.max;
          return (
            <View key={step.value} style={styles.step}>
              <View
                style={[
                  styles.bar,
                  { backgroundColor: active ? theme.wood : theme.backgroundElement },
                ]}
              />
              <ThemedText
                type="small"
                themeColor={active ? 'text' : 'textSecondary'}
                style={styles.caption}>
                {step.label}
              </ThemedText>
            </View>
          );
        })}
      </View>

      <ThemedText themeColor="textSecondary">{wateringHint(range.min, range.max)}</ThemedText>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  label: {
    textTransform: 'capitalize',
  },
  meter: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  step: {
    flex: 1,
    gap: Spacing.one,
  },
  bar: {
    height: 8,
    borderRadius: Radius.pill,
  },
  caption: {
    textAlign: 'center',
  },
});
